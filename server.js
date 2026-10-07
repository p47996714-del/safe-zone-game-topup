// server.js

import express from "express";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config();

const app = express();

const PORT = Number(process.env.PORT || 10000);
const JWT_SECRET =
  process.env.JWT_SECRET || "CHANGE_THIS_SECRET_IN_RENDER";

const ADMIN_USERNAME =
  process.env.ADMIN_USERNAME || "admin";

const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD || "admin12345";

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({
  extended: true,
  limit: "10mb"
}));

/* =========================
   DATABASE
========================= */

const db = new Database("safe-zone.db");

db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  balance REAL NOT NULL DEFAULT 0,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game TEXT NOT NULL,
  name TEXT NOT NULL,
  price REAL NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  player_id TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  total REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  amount REAL NOT NULL,
  method TEXT NOT NULL,
  transaction_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

/* =========================
   ADMIN SETUP
========================= */

const adminExists = db
  .prepare(
    "SELECT id FROM users WHERE username = ?"
  )
  .get(ADMIN_USERNAME);

if (!adminExists) {
  const hash = bcrypt.hashSync(
    ADMIN_PASSWORD,
    10
  );

  db.prepare(`
    INSERT INTO users
    (username, password_hash, balance, is_admin)
    VALUES (?, ?, 0, 1)
  `).run(
    ADMIN_USERNAME,
    hash
  );
}

/* =========================
   DEFAULT PRODUCTS
========================= */

const productCount = db
  .prepare(
    "SELECT COUNT(*) AS count FROM products"
  )
  .get().count;

if (!productCount) {

  const products = [
    ["Free Fire", "100 Diamonds", 3500],
    ["Free Fire", "310 Diamonds", 9500],
    ["Free Fire", "520 Diamonds", 15000],
    ["Free Fire", "1060 Diamonds", 29000],

    ["PUBG Mobile", "60 UC", 4500],
    ["PUBG Mobile", "325 UC", 22000],
    ["PUBG Mobile", "660 UC", 43000],

    ["Mobile Legends", "86 Diamonds", 4500],
    ["Mobile Legends", "172 Diamonds", 8500],
    ["Mobile Legends", "257 Diamonds", 12500],

    ["Clash of Clans", "Gold Pass", 18000],
    ["Roblox", "400 Robux", 15000],
    ["Roblox", "800 Robux", 29000]
  ];

  const insert = db.prepare(`
    INSERT INTO products
    (game, name, price)
    VALUES (?, ?, ?)
  `);

  const tx = db.transaction(() => {
    for (const product of products) {
      insert.run(...product);
    }
  });

  tx();
}

/* =========================
   AUTH
========================= */

function auth(req, res, next) {

  try {

    const header =
      req.headers.authorization || "";

    if (!header.startsWith("Bearer ")) {
      return res.status(401).json({
        error: "Unauthorized"
      });
    }

    const token =
      header.substring(7);

    req.user =
      jwt.verify(token, JWT_SECRET);

    next();

  } catch (error) {

    return res.status(401).json({
      error: "Invalid or expired token"
    });
  }
}

/* =========================
   ADMIN AUTH
========================= */

function admin(req, res, next) {

  if (!req.user?.is_admin) {
    return res.status(403).json({
      error: "Admin only"
    });
  }

  next();
}

/* =========================
   TELEGRAM
========================= */

async function telegram(message) {

  const token =
    process.env.BOT_TOKEN;

  const chatId =
    process.env.CHAT_ID;

  if (!token || !chatId) {

    console.log(
      "Telegram disabled: BOT_TOKEN or CHAT_ID missing"
    );

    return false;
  }

  try {

    const response =
      await fetch(
        `https://api.telegram.org/bot${token}/sendMessage`,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json"
          },

          body: JSON.stringify({
            chat_id: chatId,
            text: message
          })
        }
      );

    const data =
      await response.json();

    if (!data.ok) {

      console.error(
        "Telegram API error:",
        data.description
      );

      return false;
    }

    console.log(
      "Telegram notification sent"
    );

    return true;

  } catch (error) {

    console.error(
      "Telegram error:",
      error.message
    );

    return false;
  }
}

/* =========================
   HEALTH CHECK
========================= */

app.get("/api/health", (req, res) => {

  res.json({
    ok: true,
    service: "Safe Zone Game Topup",
    time: new Date().toISOString()
  });

});

/* =========================
   REGISTER
========================= */

app.post(
  "/api/register",
  async (req, res) => {

    try {

      const {
        username,
        password
      } = req.body || {};

      const cleanUsername =
        String(username || "").trim();

      if (
        !cleanUsername ||
        !password
      ) {

        return res.status(400).json({
          error:
            "Username and password required"
        });
      }

      if (password.length < 6) {

        return res.status(400).json({
          error:
            "Password must be at least 6 characters"
        });
      }

      const exists =
        db.prepare(
          "SELECT id FROM users WHERE username = ?"
        ).get(cleanUsername);

      if (exists) {

        return res.status(409).json({
          error:
            "Username already exists"
        });
      }

      const hash =
        await bcrypt.hash(
          password,
          10
        );

      const result =
        db.prepare(`
          INSERT INTO users
          (username, password_hash)
          VALUES (?, ?)
        `).run(
          cleanUsername,
          hash
        );

      const user =
        db.prepare(`
          SELECT
            id,
            username,
            balance,
            is_admin
          FROM users
          WHERE id = ?
        `).get(
          result.lastInsertRowid
        );

      const token =
        jwt.sign(
          user,
          JWT_SECRET,
          { expiresIn: "7d" }
        );

      res.json({
        token,
        user
      });

    } catch (error) {

      console.error(error);

      res.status(500).json({
        error:
          "Registration failed"
      });
    }
  }
);

/* =========================
   LOGIN
========================= */

app.post(
  "/api/login",
  async (req, res) => {

    try {

      const {
        username,
        password
      } = req.body || {};

      const user =
        db.prepare(`
          SELECT *
          FROM users
          WHERE username = ?
        `).get(
          String(username || "").trim()
        );

      if (!user) {

        return res.status(401).json({
          error:
            "Invalid username or password"
        });
      }

      const valid =
        await bcrypt.compare(
          password || "",
          user.password_hash
        );

      if (!valid) {

        return res.status(401).json({
          error:
            "Invalid username or password"
        });
      }

      const safeUser = {
        id: user.id,
        username: user.username,
        balance: user.balance,
        is_admin: user.is_admin
      };

      const token =
        jwt.sign(
          safeUser,
          JWT_SECRET,
          { expiresIn: "7d" }
        );

      res.json({
        token,
        user: safeUser
      });

    } catch (error) {

      console.error(error);

      res.status(500).json({
        error:
          "Login failed"
      });
    }
  }
);

/* =========================
   ME
========================= */

app.get(
  "/api/me",
  auth,
  (req, res) => {

    const user =
      db.prepare(`
        SELECT
          id,
          username,
          balance,
          is_admin,
          created_at
        FROM users
        WHERE id = ?
      `).get(req.user.id);

    if (!user) {

      return res.status(404).json({
        error: "User not found"
      });
    }

    res.json(user);
  }
);

/* =========================
   PRODUCTS
========================= */

app.get(
  "/api/products",
  (req, res) => {

    const products =
      db.prepare(`
        SELECT
          id,
          game,
          name,
          price
        FROM products
        WHERE active = 1
        ORDER BY game, id
      `).all();

    res.json(products);
  }
);

/* =========================
   CREATE ORDER
========================= */

app.post(
  "/api/orders",
  auth,
  async (req, res) => {

    try {

      const {
        product_id,
        player_id,
        quantity = 1
      } = req.body || {};

      if (
        !product_id ||
        !player_id
      ) {

        return res.status(400).json({
          error:
            "Product and Player ID required"
        });
      }

      const product =
        db.prepare(`
          SELECT *
          FROM products
          WHERE id = ?
          AND active = 1
        `).get(product_id);

      if (!product) {

        return res.status(404).json({
          error:
            "Product not found"
        });
      }

      const qty =
        Math.max(
          1,
          Math.floor(
            Number(quantity) || 1
          )
        );

      const total =
        product.price * qty;

      const user =
        db.prepare(`
          SELECT *
          FROM users
          WHERE id = ?
        `).get(req.user.id);

      if (!user) {

        return res.status(404).json({
          error:
            "User not found"
        });
      }

      if (user.balance < total) {

        return res.status(400).json({
          error:
            "Insufficient balance"
        });
      }

      const transaction =
        db.transaction(() => {

          db.prepare(`
            UPDATE users
            SET balance = balance - ?
            WHERE id = ?
          `).run(
            total,
            user.id
          );

          return db.prepare(`
            INSERT INTO orders
            (
              user_id,
              product_id,
              player_id,
              quantity,
              total,
              status
            )
            VALUES (?, ?, ?, ?, ?, 'pending')
          `).run(
            user.id,
            product.id,
            String(player_id).trim(),
            qty,
            total
          );
        });

      const result =
        transaction();

      await telegram(
`🛒 NEW ORDER

Order ID: #${result.lastInsertRowid}
User: ${user.username}
Game: ${product.game}
Product: ${product.name}
Player ID: ${player_id}
Quantity: ${qty}
Total: ${total.toLocaleString()} MMK
Status: Pending`
      );

      res.json({
        success: true,
        order_id:
          result.lastInsertRowid,
        total
      });

    } catch (error) {

      console.error(error);

      res.status(500).json({
        error:
          "Could not create order"
      });
    }
  }
);

/* =========================
   USER ORDERS
========================= */

app.get(
  "/api/orders",
  auth,
  (req, res) => {

    const orders =
      db.prepare(`
        SELECT
          o.id,
          o.player_id,
          o.quantity,
          o.total,
          o.status,
          o.created_at,
          p.game,
          p.name
        FROM orders o
        JOIN products p
          ON p.id = o.product_id
        WHERE o.user_id = ?
        ORDER BY o.id DESC
      `).all(req.user.id);

    res.json(orders);
  }
);

/* =========================
   PAYMENT
========================= */

app.post(
  "/api/payments",
  auth,
  async (req, res) => {

    try {

      const {
        amount,
        method,
        transaction_id
      } = req.body || {};

      const paymentAmount =
        Number(amount);

      if (
        !Number.isFinite(
          paymentAmount
        ) ||
        paymentAmount <= 0 ||
        !method
      ) {

        return res.status(400).json({
          error:
            "Valid amount and payment method required"
        });
      }

      const result =
        db.prepare(`
          INSERT INTO payments
          (
            user_id,
            amount,
            method,
            transaction_id,
            status
          )
          VALUES (?, ?, ?, ?, 'pending')
        `).run(
          req.user.id,
          paymentAmount,
          String(method),
          String(
            transaction_id || ""
          ).trim()
        );

      const user =
        db.prepare(
          "SELECT username FROM users WHERE id = ?"
        ).get(req.user.id);

      await telegram(
`💰 NEW PAYMENT

Payment ID: #${result.lastInsertRowid}
User: ${user.username}
Amount: ${paymentAmount.toLocaleString()} MMK
Method: ${method}
Transaction ID: ${transaction_id || "-"}
Status: Pending`
      );

      res.json({
        success: true,
        payment_id:
          result.lastInsertRowid
      });

    } catch (error) {

      console.error(error);

      res.status(500).json({
        error:
          "Payment submission failed"
      });
    }
  }
);

/* =========================
   ADMIN ORDERS
========================= */

app.get(
  "/api/admin/orders",
  auth,
  admin,
  (req, res) => {

    const orders =
      db.prepare(`
        SELECT
          o.*,
          u.username,
          p.game,
          p.name
        FROM orders o
        JOIN users u
          ON u.id = o.user_id
        JOIN products p
          ON p.id = o.product_id
        ORDER BY o.id DESC
      `).all();

    res.json(orders);
  }
);

/* =========================
   ADMIN UPDATE ORDER
========================= */

app.patch(
  "/api/admin/orders/:id",
  auth,
  admin,
  async (req, res) => {

    try {

      const {
        status
      } = req.body || {};

      const allowed = [
        "pending",
        "processing",
        "completed",
        "cancelled"
      ];

      if (!allowed.includes(status)) {

        return res.status(400).json({
          error:
            "Invalid status"
        });
      }

      const order =
        db.prepare(`
          SELECT
            o.*,
            u.username
          FROM orders o
          JOIN users u
            ON u.id = o.user_id
          WHERE o.id = ?
        `).get(
          req.params.id
        );

      if (!order) {

        return res.status(404).json({
          error:
            "Order not found"
        });
      }

      db.prepare(`
        UPDATE orders
        SET status = ?
        WHERE id = ?
      `).run(
        status,
        req.params.id
      );

      await telegram(
`📦 ORDER UPDATE

Order: #${order.id}
User: ${order.username}
Status: ${status}`
      );

      res.json({
        success: true
      });

    } catch (error) {

      console.error(error);

      res.status(500).json({
        error:
          "Could not update order"
      });
    }
  }
);

/* =========================
   ADMIN PAYMENTS
========================= */

app.get(
  "/api/admin/payments",
  auth,
  admin,
  (req, res) => {

    const payments =
      db.prepare(`
        SELECT
          p.*,
          u.username
        FROM payments p
        JOIN users u
          ON u.id = p.user_id
        ORDER BY p.id DESC
      `).all();

    res.json(payments);
  }
);

/* =========================
   ADMIN UPDATE PAYMENT
========================= */

app.patch(
  "/api/admin/payments/:id",
  auth,
  admin,
  async (req, res) => {

    try {

      const {
        status
      } = req.body || {};

      const allowed = [
        "pending",
        "approved",
        "rejected"
      ];

      if (!allowed.includes(status)) {

        return res.status(400).json({
          error:
            "Invalid payment status"
        });
      }

      const payment =
        db.prepare(`
          SELECT *
          FROM payments
          WHERE id = ?
        `).get(
          req.params.id
        );

      if (!payment) {

        return res.status(404).json({
          error:
            "Payment not found"
        });
      }

      const transaction =
        db.transaction(() => {

          db.prepare(`
            UPDATE payments
            SET status = ?
            WHERE id = ?
          `).run(
            status,
            payment.id
          );

          if (
            status === "approved" &&
            payment.status !== "approved"
          ) {

            db.prepare(`
              UPDATE users
              SET balance = balance + ?
              WHERE id = ?
            `).run(
              payment.amount,
              payment.user_id
            );
          }
        });

      transaction();

      const user =
        db.prepare(
          "SELECT username FROM users WHERE id = ?"
        ).get(payment.user_id);

      await telegram(
`💳 PAYMENT UPDATE

Payment: #${payment.id}
User: ${user?.username || "-"}
Amount: ${payment.amount.toLocaleString()} MMK
Status: ${status}`
      );

      res.json({
        success: true
      });

    } catch (error) {

      console.error(error);

      res.status(500).json({
        error:
          "Could not update payment"
      });
    }
  }
);

/* =========================
   ADMIN USERS
========================= */

app.get(
  "/api/admin/users",
  auth,
  admin,
  (req, res) => {

    const users =
      db.prepare(`
        SELECT
          id,
          username,
          balance,
          is_admin,
          created_at
        FROM users
        ORDER BY id DESC
      `).all();

    res.json(users);
  }
);

/* =========================
   WEBSITE
========================= */

app.use((req, res) => {

  res.send(`<!DOCTYPE html>

<html lang="en">

<head>

<meta charset="UTF-8">

<meta
  name="viewport"
  content="width=device-width, initial-scale=1.0"
>

<title>Safe Zone Game Topup</title>

<style>

*{
  box-sizing:border-box;
  margin:0;
  padding:0;
}

body{
  font-family:
    Arial,
    sans-serif;
  background:#08090d;
  color:#fff;
}

header{
  position:sticky;
  top:0;
  z-index:10;
  background:#10121a;
  border-bottom:
    1px solid #252936;
  padding:15px;
}

.container{
  max-width:1100px;
  margin:auto;
  padding:20px;
}

.logo{
  font-size:22px;
  font-weight:800;
}

.hero{
  background:
    linear-gradient(
      135deg,
      #151a31,
      #101018
    );
  border:
    1px solid #282d42;
  border-radius:20px;
  padding:30px;
  margin-bottom:20px;
}

.hero h1{
  font-size:34px;
  margin-bottom:10px;
}

.hero p{
  color:#aeb3c5;
}

.card{
  background:#11131b;
  border:
    1px solid #252936;
  border-radius:16px;
  padding:18px;
  margin-bottom:15px;
}

input,
select,
button{
  width:100%;
  padding:13px;
  margin-top:9px;
  border-radius:10px;
  border:
    1px solid #303443;
  background:#191c26;
  color:#fff;
}

button{
  background:#6d4aff;
  border:0;
  font-weight:bold;
  cursor:pointer;
}

button:hover{
  opacity:.9;
}

.grid{
  display:grid;
  grid-template-columns:
    repeat(
      auto-fit,
      minmax(220px,1fr)
    );
  gap:15px;
}

.product{
  cursor:pointer;
  transition:.2s;
}

.product:hover{
  transform:translateY(-3px);
  border-color:#6d4aff;
}

.price{
  color:#8f7aff;
  font-size:20px;
  font-weight:bold;
  margin-top:12px;
}

.hidden{
  display:none;
}

.nav{
  display:flex;
  gap:8px;
  flex-wrap:wrap;
  margin-bottom:20px;
}

.nav button{
  width:auto;
  padding:10px 16px;
}

.badge{
  display:inline-block;
  padding:5px 9px;
  border-radius:8px;
  background:#242938;
  font-size:12px;
}

.balance{
  font-size:24px;
  font-weight:bold;
}

.error{
  color:#ff6874;
  margin-top:10px;
}

.success{
  color:#55dc91;
  margin-top:10px;
}

table{
  width:100%;
  border-collapse:collapse;
}

th,
td{
  padding:10px;
  border-bottom:
    1px solid #282c39;
  text-align:left;
  font-size:13px;
}

@media(max-width:600px){

  .hero h1{
    font-size:27px;
  }

  .container{
    padding:12px;
  }

}

</style>

</head>

<body>

<header>

<div class="container">

<div class="logo">
🛡️ SAFE ZONE GAME TOPUP
</div>

</div>

</header>

<main class="container">

<section
  id="loginPage"
  class="card"
>

<h2>Login</h2>

<input
  id="loginUser"
  placeholder="Username"
>

<input
  id="loginPass"
  type="password"
  placeholder="Password"
>

<button onclick="login()">
LOGIN
</button>

<p id="loginMsg"></p>

<button onclick="showRegister()">
CREATE ACCOUNT
</button>

</section>

<section
  id="registerPage"
  class="card hidden"
>

<h2>Create Account</h2>

<input
  id="regUser"
  placeholder="Username"
>

<input
  id="regPass"
  type="password"
  placeholder="Password"
>

<button onclick="register()">
REGISTER
</button>

<p id="regMsg"></p>

<button onclick="showLogin()">
BACK TO LOGIN
</button>

</section>

<section
  id="appPage"
  class="hidden"
>

<div class="nav">

<button onclick="showHome()">
HOME
</button>

<button onclick="showOrders()">
ORDERS
</button>

<button onclick="showPayment()">
BALANCE
</button>

<button onclick="logout()">
LOGOUT
</button>

</div>

<div class="hero">

<h1>
Game Topup
</h1>

<p>
Fast and secure game topup service.
</p>

<br>

<div class="balance">

Balance:

<span id="balance">
0
</span>

MMK

</div>

</div>

<section id="homeSection">

<div class="card">

<h2>
Game Products
</h2>

</div>

<div
  id="products"
  class="grid"
></div>

<div
  id="buyBox"
  class="card hidden"
>

<h2 id="selectedName">
Product
</h2>

<input
  id="playerId"
  placeholder="Player ID / UID"
>

<input
  id="quantity"
  type="number"
  value="1"
  min="1"
>

<button onclick="buyProduct()">
CONFIRM ORDER
</button>

<p id="buyMsg"></p>

</div>

</section>

<section
  id="ordersSection"
  class="card hidden"
>

<h2>
My Orders
</h2>

<div id="orders"></div>

</section>

<section
  id="paymentSection"
  class="card hidden"
>

<h2>
Add Balance
</h2>

<input
  id="payAmount"
  type="number"
  placeholder="Amount"
>

<select id="payMethod">

<option value="KBZ Pay">
KBZ Pay
</option>

<option value="Wave Pay">
Wave Pay
</option>

<option value="AYA Pay">
AYA Pay
</option>

</select>

<input
  id="transactionId"
  placeholder="Transaction ID"
>

<button onclick="payment()">
SUBMIT PAYMENT
</button>

<p id="payMsg"></p>

</section>

</section>

</main>

<script>

let token =
  localStorage.getItem("token");

let products = [];

let selectedProduct = null;

function $(id){
  return document.getElementById(id);
}

function showRegister(){

  $("loginPage")
    .classList
    .add("hidden");

  $("registerPage")
    .classList
    .remove("hidden");
}

function showLogin(){

  $("registerPage")
    .classList
    .add("hidden");

  $("loginPage")
    .classList
    .remove("hidden");
}

async function register(){

  const username =
    $("regUser").value.trim();

  const password =
    $("regPass").value;

  if(!username || !password){

    $("regMsg").className =
      "error";

    $("regMsg").textContent =
      "Username နှင့် Password ထည့်ပါ";

    return;
  }

  const response =
    await fetch(
      "/api/register",
      {
        method:"POST",

        headers:{
          "Content-Type":
            "application/json"
        },

        body:JSON.stringify({
          username,
          password
        })
      }
    );

  const data =
    await response.json();

  if(!response.ok){

    $("regMsg").className =
      "error";

    $("regMsg").textContent =
      data.error ||
      "Registration failed";

    return;
  }

  token =
    data.token;

  localStorage.setItem(
    "token",
    token
  );

  startApp();
}

async function login(){

  const username =
    $("loginUser")
      .value
      .trim();

  const password =
    $("loginPass")
      .value;

  const response =
    await fetch(
      "/api/login",
      {
        method:"POST",

        headers:{
          "Content-Type":
            "application/json"
        },

        body:JSON.stringify({
          username,
          password
        })
      }
    );

  const data =
    await response.json();

  if(!response.ok){

    $("loginMsg").className =
      "error";

    $("loginMsg").textContent =
      data.error ||
      "Login failed";

    return;
  }

  token =
    data.token;

  localStorage.setItem(
    "token",
    token
  );

  startApp();
}

async function startApp(){

  $("loginPage")
    .classList
    .add("hidden");

  $("registerPage")
    .classList
    .add("hidden");

  $("appPage")
    .classList
    .remove("hidden");

  await loadMe();

  await loadProducts();
}

async function loadMe(){

  const response =
    await fetch(
      "/api/me",
      {
        headers:{
          Authorization:
            "Bearer " + token
        }
      }
    );

  if(!response.ok){

    logout();

    return;
  }

  const user =
    await response.json();

  $("balance")
    .textContent =
    Number(
      user.balance
    ).toLocaleString();
}

async function loadProducts(){

  const response =
    await fetch(
      "/api/products"
    );

  if(!response.ok){

    $("products").innerHTML =
      "<p>Products loading failed.</p>";

    return;
  }

  products =
    await response.json();

  $("products").innerHTML =
    "";

  products.forEach(
    product => {

      const div =
        document.createElement(
          "div"
        );

      div.className =
        "card product";

      div.innerHTML =
        "<h3>" +
        escapeHtml(
          product.game
        ) +
        "</h3>" +

        "<p>" +
        escapeHtml(
          product.name
        ) +
        "</p>" +

        "<div class='price'>" +
        Number(
          product.price
        ).toLocaleString() +
        " MMK</div>";

      div.onclick =
        () => {

          selectedProduct =
            product;

          $("selectedName")
            .textContent =
            product.game +
            " - " +
            product.name;

          $("buyBox")
            .classList
            .remove("hidden");

          $("buyBox")
            .scrollIntoView({
              behavior:"smooth"
            });
        };

      $("products")
        .appendChild(div);
    }
  );
}

async function buyProduct(){

  if(!selectedProduct)
    return;

  const playerId =
    $("playerId")
      .value
      .trim();

  const quantity =
    Math.max(
      1,
      Number(
        $("quantity").value || 1
      )
    );

  if(!playerId){

    $("buyMsg").className =
      "error";

    $("buyMsg").textContent =
      "Player ID ထည့်ပါ";

    return;
  }

  const response =
    await fetch(
      "/api/orders",
      {
        method:"POST",

        headers:{
          "Content-Type":
            "application/json",

          Authorization:
            "Bearer " + token
        },

        body:JSON.stringify({
          product_id:
            selectedProduct.id,

          player_id:
            playerId,

          quantity
        })
      }
    );

  const data =
    await response.json();

  if(!response.ok){

    $("buyMsg").className =
      "error";

    $("buyMsg").textContent =
      data.error ||
      "Order failed";

    return;
  }

  $("buyMsg").className =
    "success";

  $("buyMsg").textContent =
    "Order #" +
    data.order_id +
    " တင်ပြီးပါပြီ";

  await loadMe();

  await showOrders();
}

async function showOrders(){

  $("homeSection")
    .classList
    .add("hidden");

  $("paymentSection")
    .classList
    .add("hidden");

  $("ordersSection")
    .classList
    .remove("hidden");

  const response =
    await fetch(
      "/api/orders",
      {
        headers:{
          Authorization:
            "Bearer " + token
        }
      }
    );

  if(!response.ok){

    $("orders").innerHTML =
      "<p>Orders loading failed.</p>";

    return;
  }

  const orders =
    await response.json();

  if(!orders.length){

    $("orders").innerHTML =
      "<p>No orders yet.</p>";

    return;
  }

  $("orders").innerHTML =
    orders.map(
      order => `

<div class="card">

<b>
#${order.id}
</b>

<br>

${escapeHtml(order.game)}
-
${escapeHtml(order.name)}

<br>

Player ID:
${escapeHtml(order.player_id)}

<br>

Total:
${Number(
  order.total
).toLocaleString()}
MMK

<br>

Status:

<span class="badge">
${escapeHtml(
  order.status
)}
</span>

</div>

`
    ).join("");
}

function showHome(){

  $("ordersSection")
    .classList
    .add("hidden");

  $("paymentSection")
    .classList
    .add("hidden");

  $("homeSection")
    .classList
    .remove("hidden");
}

function showPayment(){

  $("homeSection")
    .classList
    .add("hidden");

  $("ordersSection")
    .classList
    .add("hidden");

  $("paymentSection")
    .classList
    .remove("hidden");
}

async function payment(){

  const amount =
    Number(
      $("payAmount").value
    );

  const method =
    $("payMethod").value;

  const transaction_id =
    $("transactionId")
      .value
      .trim();

  if(
    !amount ||
    amount <= 0
  ){

    $("payMsg").className =
      "error";

    $("payMsg").textContent =
      "Amount ထည့်ပါ";

    return;
  }

  const response =
    await fetch(
      "/api/payments",
      {
        method:"POST",

        headers:{
          "Content-Type":
            "application/json",

          Authorization:
            "Bearer " + token
        },

        body:JSON.stringify({
          amount,
          method,
          transaction_id
        })
      }
    );

  const data =
    await response.json();

  if(!response.ok){

    $("payMsg").className =
      "error";

    $("payMsg").textContent =
      data.error ||
      "Payment failed";

    return;
  }

  $("payMsg").className =
    "success";

  $("payMsg").textContent =
    "Payment တင်ပြီးပါပြီ။ Admin အတည်ပြုရန် စောင့်ပါ။";

  $("payAmount").value =
    "";

  $("transactionId").value =
    "";
}

function logout(){

  localStorage.removeItem(
    "token"
  );

  token = null;

  $("appPage")
    .classList
    .add("hidden");

  $("loginPage")
    .classList
    .remove("hidden");
}

function escapeHtml(value){

  return String(value)
    .replaceAll(
      "&",
      "&amp;"
    )
    .replaceAll(
      "<",
      "&lt;"
    )
    .replaceAll(
      ">",
      "&gt;"
    )
    .replaceAll(
      '"',
      "&quot;"
    )
    .replaceAll(
      "'",
      "&#039;"
    );
}

if(token){

  startApp();

}

</script>

</body>

</html>`);

});

/* =========================
   ERROR HANDLER
========================= */

app.use(
  (err, req, res, next) => {

    console.error(
      "Server error:",
      err
    );

    if(
      res.headersSent
    ) {
      return next(err);
    }

    res.status(500).json({
      error:
        "Internal server error"
    });
  }
);

/* =========================
   START SERVER
========================= */

app.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      `Safe Zone Website running on port ${PORT}`
    );

    console.log(
      `Port: ${PORT}`
    );

    console.log(
      `Telegram: ${
        process.env.BOT_TOKEN &&
        process.env.CHAT_ID
          ? "enabled"
          : "disabled"
      }`
    );

  }
);
