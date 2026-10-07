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

CREATE TABLE IF NOT EXISTS payment_credits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_id INTEGER UNIQUE NOT NULL,
  user_id INTEGER NOT NULL,
  amount REAL NOT NULL,
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
    (
      username,
      password_hash,
      balance,
      is_admin
    )
    VALUES (?, ?, 0, 1)
  `).run(
    ADMIN_USERNAME,
    hash
  );

  console.log(
    "Admin account created:",
    ADMIN_USERNAME
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
    (
      game,
      name,
      price
    )
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
      jwt.verify(
        token,
        JWT_SECRET
      );

    next();

  } catch (error) {

    return res.status(401).json({
      error:
        "Invalid or expired token"
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
      "Telegram disabled"
    );

    return false;
  }

  try {

    const response =
      await fetch(
        "https://api.telegram.org/bot" +
        token +
        "/sendMessage",
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
        "Telegram error:",
        data.description
      );

      return false;
    }

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
   HEALTH
========================= */

app.get(
  "/api/health",
  (req, res) => {

    res.json({
      ok: true,
      service:
        "Safe Zone Game Topup",
      time:
        new Date().toISOString()
    });

  }
);

/* =========================
   REGISTER
========================= */

app.post(
  "/api/register",
  async (req, res) => {

    try {

      const username =
        String(
          req.body?.username || ""
        ).trim();

      const password =
        String(
          req.body?.password || ""
        );

      if (!username || !password) {

        return res.status(400).json({
          error:
            "Username and password required"
        });
      }

      if (username.length < 3) {

        return res.status(400).json({
          error:
            "Username must be at least 3 characters"
        });
      }

      if (password.length < 6) {

        return res.status(400).json({
          error:
            "Password must be at least 6 characters"
        });
      }

      const exists =
        db.prepare(`
          SELECT id
          FROM users
          WHERE username = ?
        `).get(username);

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
          (
            username,
            password_hash
          )
          VALUES (?, ?)
        `).run(
          username,
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
          {
            expiresIn: "7d"
          }
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

      const username =
        String(
          req.body?.username || ""
        ).trim();

      const password =
        String(
          req.body?.password || ""
        );

      const user =
        db.prepare(`
          SELECT *
          FROM users
          WHERE username = ?
        `).get(username);

      if (!user) {

        return res.status(401).json({
          error:
            "Invalid username or password"
        });
      }

      const valid =
        await bcrypt.compare(
          password,
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

        username:
          user.username,

        balance:
          user.balance,

        is_admin:
          user.is_admin

      };

      const token =
        jwt.sign(
          safeUser,
          JWT_SECRET,
          {
            expiresIn: "7d"
          }
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
        error:
          "User not found"
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

      const productId =
        Number(
          req.body?.product_id
        );

      const playerId =
        String(
          req.body?.player_id || ""
        ).trim();

      const qty =
        Math.max(
          1,
          Math.min(
            100,
            Math.floor(
              Number(
                req.body?.quantity || 1
              )
            )
          )
        );

      if (!productId || !playerId) {

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
        `).get(productId);

      if (!product) {

        return res.status(404).json({
          error:
            "Product not found"
        });
      }

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

          const update =
            db.prepare(`
              UPDATE users
              SET balance =
                balance - ?
              WHERE id = ?
              AND balance >= ?
            `).run(
              total,
              user.id,
              total
            );

          if (update.changes !== 1) {

            throw new Error(
              "Insufficient balance"
            );
          }

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
            VALUES (
              ?, ?, ?, ?, ?, 'pending'
            )
          `).run(
            user.id,
            product.id,
            playerId,
            qty,
            total
          );

        });

      const result =
        transaction();

      await telegram(
        "🛒 NEW ORDER\n\n" +
        "Order ID: #" +
        result.lastInsertRowid +
        "\nUser: " +
        user.username +
        "\nGame: " +
        product.game +
        "\nProduct: " +
        product.name +
        "\nPlayer ID: " +
        playerId +
        "\nQuantity: " +
        qty +
        "\nTotal: " +
        total.toLocaleString() +
        " MMK\nStatus: Pending"
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
          error.message ===
          "Insufficient balance"
            ? "Insufficient balance"
            : "Could not create order"
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
   PAYMENT SUBMIT
========================= */

app.post(
  "/api/payments",
  auth,
  async (req, res) => {

    try {

      const amount =
        Number(
          req.body?.amount
        );

      const method =
        String(
          req.body?.method || ""
        ).trim();

      const transactionId =
        String(
          req.body?.transaction_id || ""
        ).trim();

      if (
        !Number.isFinite(amount) ||
        amount <= 0 ||
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
          VALUES (
            ?, ?, ?, ?, 'pending'
          )
        `).run(
          req.user.id,
          amount,
          method,
          transactionId
        );

      const user =
        db.prepare(`
          SELECT username
          FROM users
          WHERE id = ?
        `).get(req.user.id);

      await telegram(
        "💰 NEW PAYMENT\n\n" +
        "Payment ID: #" +
        result.lastInsertRowid +
        "\nUser: " +
        user.username +
        "\nAmount: " +
        amount.toLocaleString() +
        " MMK\nMethod: " +
        method +
        "\nTransaction ID: " +
        (transactionId || "-") +
        "\nStatus: Pending"
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
   ADMIN STATS
========================= */

app.get(
  "/api/admin/stats",
  auth,
  admin,
  (req, res) => {

    const users =
      db.prepare(`
        SELECT COUNT(*) AS count
        FROM users
        WHERE is_admin = 0
      `).get().count;

    const orders =
      db.prepare(`
        SELECT COUNT(*) AS count
        FROM orders
      `).get().count;

    const pendingOrders =
      db.prepare(`
        SELECT COUNT(*) AS count
        FROM orders
        WHERE status = 'pending'
      `).get().count;

    const pendingPayments =
      db.prepare(`
        SELECT COUNT(*) AS count
        FROM payments
        WHERE status = 'pending'
      `).get().count;

    const approvedPayments =
      db.prepare(`
        SELECT
          COALESCE(
            SUM(amount),
            0
          ) AS total
        FROM payments
        WHERE status = 'approved'
      `).get().total;

    res.json({
      users,
      orders,
      pendingOrders,
      pendingPayments,
      approvedPayments
    });
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

      const status =
        String(
          req.body?.status || ""
        );

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
          Number(req.params.id)
        );

      if (!order) {

        return res.status(404).json({
          error:
            "Order not found"
        });
      }

      if (
        order.status === "completed" &&
        status !== "completed"
      ) {

        return res.status(400).json({
          error:
            "Completed order cannot be changed"
        });
      }

      db.prepare(`
        UPDATE orders
        SET status = ?
        WHERE id = ?
      `).run(
        status,
        order.id
      );

      await telegram(
        "📦 ORDER UPDATE\n\n" +
        "Order: #" +
        order.id +
        "\nUser: " +
        order.username +
        "\nStatus: " +
        status
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

      const status =
        String(
          req.body?.status || ""
        );

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
          Number(req.params.id)
        );

      if (!payment) {

        return res.status(404).json({
          error:
            "Payment not found"
        });
      }

      if (
        payment.status === "approved" &&
        status !== "approved"
      ) {

        return res.status(400).json({
          error:
            "Approved payment cannot be changed"
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

            const credit =
              db.prepare(`
                INSERT OR IGNORE INTO payment_credits
                (
                  payment_id,
                  user_id,
                  amount
                )
                VALUES (?, ?, ?)
              `).run(
                payment.id,
                payment.user_id,
                payment.amount
              );

            if (credit.changes === 1) {

              db.prepare(`
                UPDATE users
                SET balance =
                  balance + ?
                WHERE id = ?
              `).run(
                payment.amount,
                payment.user_id
              );

            }

          }

        });

      transaction();

      const user =
        db.prepare(`
          SELECT username
          FROM users
          WHERE id = ?
        `).get(
          payment.user_id
        );

      await telegram(
        "💳 PAYMENT UPDATE\n\n" +
        "Payment: #" +
        payment.id +
        "\nUser: " +
        (user?.username || "-") +
        "\nAmount: " +
        payment.amount.toLocaleString() +
        " MMK\nStatus: " +
        status
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
   WEBSITE
========================= */

app.use(
  (req, res) => {

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
  font-family:Arial,sans-serif;
  background:#08090d;
  color:#fff;
}

header{
  position:sticky;
  top:0;
  z-index:10;
  background:#10121a;
  border-bottom:1px solid #252936;
  padding:15px;
}

.container{
  max-width:1200px;
  margin:auto;
  padding:20px;
}

.logo{
  font-size:22px;
  font-weight:800;
}

.hero{
  background:linear-gradient(
    135deg,
    #171d39,
    #101018
  );
  border:1px solid #282d42;
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
  border:1px solid #252936;
  border-radius:16px;
  padding:18px;
  margin-bottom:15px;
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

input,
select,
button{
  width:100%;
  padding:13px;
  margin-top:9px;
  border-radius:10px;
  border:1px solid #303443;
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

.balance{
  font-size:24px;
  font-weight:bold;
}

.price{
  color:#927dff;
  font-size:20px;
  font-weight:bold;
  margin-top:12px;
}

.hidden{
  display:none !important;
}

.error{
  color:#ff6874;
  margin-top:10px;
}

.success{
  color:#55dc91;
  margin-top:10px;
}

.badge{
  display:inline-block;
  padding:5px 9px;
  border-radius:8px;
  background:#242938;
  font-size:12px;
}

.admin-title{
  font-size:28px;
  margin-bottom:15px;
}

.stat-grid{
  display:grid;
  grid-template-columns:
    repeat(
      auto-fit,
      minmax(170px,1fr)
    );
  gap:12px;
  margin-bottom:20px;
}

.stat{
  background:#171a24;
  border:1px solid #292e3c;
  border-radius:14px;
  padding:18px;
}

.stat small{
  color:#aeb3c5;
}

.stat strong{
  display:block;
  font-size:26px;
  margin-top:8px;
}

.table-wrap{
  overflow-x:auto;
}

table{
  width:100%;
  border-collapse:collapse;
  min-width:750px;
}

th,
td{
  padding:10px;
  border-bottom:1px solid #282c39;
  text-align:left;
  font-size:13px;
}

.small-btn{
  width:auto;
  padding:7px 10px;
  margin:2px;
}

.green{
  background:#16834b;
}

.red{
  background:#a82b38;
}

.orange{
  background:#a16a13;
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

<button
  id="adminNav"
  class="hidden"
  onclick="showAdmin()"
>
ADMIN PANEL
</button>

<button onclick="logout()">
LOGOUT
</button>

</div>

<div class="hero">

<h1>
Safe Zone Game Topup
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

<section
  id="adminSection"
  class="hidden"
>

<h2 class="admin-title">
🛡️ Admin Panel
</h2>

<div class="stat-grid">

<div class="stat">
<small>Total Users</small>
<strong id="statUsers">0</strong>
</div>

<div class="stat">
<small>Total Orders</small>
<strong id="statOrders">0</strong>
</div>

<div class="stat">
<small>Pending Orders</small>
<strong id="statPendingOrders">0</strong>
</div>

<div class="stat">
<small>Pending Payments</small>
<strong id="statPendingPayments">0</strong>
</div>

<div class="stat">
<small>Approved Top-up</small>
<strong id="statApproved">0 MMK</strong>
</div>

</div>

<div class="card">

<button onclick="loadAdmin()">
🔄 REFRESH ADMIN DATA
</button>

</div>

<div class="card">

<h3>
👥 Users
</h3>

<br>

<div class="table-wrap">

<table>

<thead>

<tr>

<th>ID</th>
<th>Username</th>
<th>Balance</th>
<th>Admin</th>
<th>Created</th>

</tr>

</thead>

<tbody id="adminUsers"></tbody>

</table>

</div>

</div>

<div class="card">

<h3>
💳 Payment Requests
</h3>

<br>

<div class="table-wrap">

<table>

<thead>

<tr>

<th>ID</th>
<th>User</th>
<th>Amount</th>
<th>Method</th>
<th>Transaction</th>
<th>Status</th>
<th>Action</th>

</tr>

</thead>

<tbody id="adminPayments"></tbody>

</table>

</div>

</div>

<div class="card">

<h3>
🛒 Orders
</h3>

<br>

<div class="table-wrap">

<table>

<thead>

<tr>

<th>ID</th>
<th>User</th>
<th>Game</th>
<th>Product</th>
<th>Player ID</th>
<th>Total</th>
<th>Status</th>
<th>Action</th>

</tr>

</thead>

<tbody id="adminOrders"></tbody>

</table>

</div>

</div>

</section>

</section>

</main>

<script>

let token =
  localStorage.getItem("token");

let products = [];

let selectedProduct = null;

let currentUser = null;

function $(id){
  return document.getElementById(id);
}

function escapeHtml(value){

  return String(value)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
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
    $("regUser")
      .value
      .trim();

  const password =
    $("regPass").value;

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
    $("loginPass").value;

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

  const ok =
    await loadMe();

  if(!ok){
    return;
  }

  await loadProducts();

  showHome();
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

    return false;
  }

  currentUser =
    await response.json();

  $("balance")
    .textContent =
    Number(
      currentUser.balance
    ).toLocaleString();

  if(
    Number(
      currentUser.is_admin
    ) === 1
  ){

    $("adminNav")
      .classList
      .remove("hidden");

  }else{

    $("adminNav")
      .classList
      .add("hidden");

  }

  return true;
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
    function(product){

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
        function(){

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

  hideAllSections();

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

  let html = "";

  orders.forEach(
    function(order){

      html +=
        "<div class='card'>" +

        "<b>#"+
        order.id+
        "</b><br>" +

        escapeHtml(
          order.game
        ) +
        " - " +
        escapeHtml(
          order.name
        ) +

        "<br>Player ID: " +
        escapeHtml(
          order.player_id
        ) +

        "<br>Total: " +
        Number(
          order.total
        ).toLocaleString() +
        " MMK" +

        "<br>Status: " +

        "<span class='badge'>" +
        escapeHtml(
          order.status
        ) +
        "</span>" +

        "</div>";

    }
  );

  $("orders").innerHTML =
    html;
}

function showHome(){

  hideAllSections();

  $("homeSection")
    .classList
    .remove("hidden");
}

function showPayment(){

  hideAllSections();

  $("paymentSection")
    .classList
    .remove("hidden");
}

function hideAllSections(){

  $("homeSection")
    .classList
    .add("hidden");

  $("ordersSection")
    .classList
    .add("hidden");

  $("paymentSection")
    .classList
    .add("hidden");

  $("adminSection")
    .classList
    .add("hidden");
}

async function payment(){

  const amount =
    Number(
      $("payAmount").value
    );

  const method =
    $("payMethod").value;

  const transactionId =
    $("transactionId")
      .value
      .trim();

  if(
    !Number.isFinite(amount) ||
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
          transaction_id:
            transactionId
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

/* =========================
   ADMIN PANEL
========================= */

async function showAdmin(){

  if(
    !currentUser ||
    Number(
      currentUser.is_admin
    ) !== 1
  ){

    alert(
      "Admin access required"
    );

    return;
  }

  hideAllSections();

  $("adminSection")
    .classList
    .remove("hidden");

  await loadAdmin();
}

async function adminFetch(url){

  const response =
    await fetch(
      url,
      {
        headers:{
          Authorization:
            "Bearer " + token
        }
      }
    );

  if(
    response.status === 401 ||
    response.status === 403
  ){

    alert(
      "Admin session expired"
    );

    logout();

    return null;
  }

  return response;
}

async function loadAdmin(){

  const statsResponse =
    await adminFetch(
      "/api/admin/stats"
    );

  if(!statsResponse)
    return;

  const stats =
    await statsResponse.json();

  $("statUsers")
    .textContent =
    Number(
      stats.users
    ).toLocaleString();

  $("statOrders")
    .textContent =
    Number(
      stats.orders
    ).toLocaleString();

  $("statPendingOrders")
    .textContent =
    Number(
      stats.pendingOrders
    ).toLocaleString();

  $("statPendingPayments")
    .textContent =
    Number(
      stats.pendingPayments
    ).toLocaleString();

  $("statApproved")
    .textContent =
    Number(
      stats.approvedPayments
    ).toLocaleString() +
    " MMK";

  await loadAdminUsers();

  await loadAdminPayments();

  await loadAdminOrders();
}

async function loadAdminUsers(){

  const response =
    await adminFetch(
      "/api/admin/users"
    );

  if(!response)
    return;

  const users =
    await response.json();

  let html = "";

  users.forEach(
    function(user){

      html +=
        "<tr>" +

        "<td>" +
        user.id +
        "</td>" +

        "<td>" +
        escapeHtml(
          user.username
        ) +
        "</td>" +

        "<td>" +
        Number(
          user.balance
        ).toLocaleString() +
        " MMK</td>" +

        "<td>" +
        (
          Number(
            user.is_admin
          ) === 1
            ? "YES"
            : "NO"
        ) +
        "</td>" +

        "<td>" +
        escapeHtml(
          user.created_at
        ) +
        "</td>" +

        "</tr>";

    }
  );

  $("adminUsers").innerHTML =
    html ||
    "<tr><td colspan='5'>No users</td></tr>";
}

async function loadAdminPayments(){

  const response =
    await adminFetch(
      "/api/admin/payments"
    );

  if(!response)
    return;

  const payments =
    await response.json();

  let html = "";

  payments.forEach(
    function(payment){

      let action = "";

      if(
        payment.status ===
        "pending"
      ){

        action =
          "<button class='small-btn green' " +
          "onclick='updatePayment(" +
          payment.id +
          ", \"approved\")'>" +
          "APPROVE" +
          "</button>" +

          "<button class='small-btn red' " +
          "onclick='updatePayment(" +
          payment.id +
          ", \"rejected\")'>" +
          "REJECT" +
          "</button>";

      }else{

        action =
          "<span class='badge'>" +
          escapeHtml(
            payment.status
          ) +
          "</span>";

      }

      html +=
        "<tr>" +

        "<td>#"+
        payment.id+
        "</td>" +

        "<td>" +
        escapeHtml(
          payment.username
        ) +
        "</td>" +

        "<td>" +
        Number(
          payment.amount
        ).toLocaleString() +
        " MMK</td>" +

        "<td>" +
        escapeHtml(
          payment.method
        ) +
        "</td>" +

        "<td>" +
        escapeHtml(
          payment.transaction_id ||
          "-"
        ) +
        "</td>" +

        "<td>" +
        escapeHtml(
          payment.status
        ) +
        "</td>" +

        "<td>" +
        action +
        "</td>" +

        "</tr>";

    }
  );

  $("adminPayments").innerHTML =
    html ||
    "<tr><td colspan='7'>No payments</td></tr>";
}

async function loadAdminOrders(){

  const response =
    await adminFetch(
      "/api/admin/orders"
    );

  if(!response)
    return;

  const orders =
    await response.json();

  let html = "";

  orders.forEach(
    function(order){

      let action = "";

      if(
        order.status !==
        "completed"
      ){

        action =
          "<button class='small-btn orange' " +
          "onclick='updateOrder(" +
          order.id +
          ", \"processing\")'>" +
          "PROCESSING" +
          "</button>" +

          "<button class='small-btn green' " +
          "onclick='updateOrder(" +
          order.id +
          ", \"completed\")'>" +
          "COMPLETE" +
          "</button>" +

          "<button class='small-btn red' " +
          "onclick='updateOrder(" +
          order.id +
          ", \"cancelled\")'>" +
          "CANCEL" +
          "</button>";

      }else{

        action =
          "<span class='badge'>COMPLETED</span>";

      }

      html +=
        "<tr>" +

        "<td>#"+
        order.id+
        "</td>" +

        "<td>" +
        escapeHtml(
          order.username
        ) +
        "</td>" +

        "<td>" +
        escapeHtml(
          order.game
        ) +
        "</td>" +

        "<td>" +
        escapeHtml(
          order.name
        ) +
        "</td>" +

        "<td>" +
        escapeHtml(
          order.player_id
        ) +
        "</td>" +

        "<td>" +
        Number(
          order.total
        ).toLocaleString() +
        " MMK</td>" +

        "<td>" +
        escapeHtml(
          order.status
        ) +
        "</td>" +

        "<td>" +
        action +
        "</td>" +

        "</tr>";

    }
  );

  $("adminOrders").innerHTML =
    html ||
    "<tr><td colspan='8'>No orders</td></tr>";
}

async function updatePayment(
  id,
  status
){

  const ok =
    confirm(
      "Payment #" +
      id +
      " ကို " +
      status +
      " လုပ်မှာ သေချာပါသလား?"
    );

  if(!ok)
    return;

  const response =
    await fetch(
      "/api/admin/payments/" +
      id,
      {
        method:"PATCH",

        headers:{
          "Content-Type":
            "application/json",

          Authorization:
            "Bearer " + token
        },

        body:JSON.stringify({
          status
        })
      }
    );

  const data =
    await response.json();

  if(!response.ok){

    alert(
      data.error ||
      "Payment update failed"
    );

    return;
  }

  await loadMe();

  await loadAdmin();

  alert(
    "Payment updated successfully"
  );
}

async function updateOrder(
  id,
  status
){

  const ok =
    confirm(
      "Order #" +
      id +
      " ကို " +
      status +
      " လုပ်မှာ သေချာပါသလား?"
    );

  if(!ok)
    return;

  const response =
    await fetch(
      "/api/admin/orders/" +
      id,
      {
        method:"PATCH",

        headers:{
          "Content-Type":
            "application/json",

          Authorization:
            "Bearer " + token
        },

        body:JSON.stringify({
          status
        })
      }
    );

  const data =
    await response.json();

  if(!response.ok){

    alert(
      data.error ||
      "Order update failed"
    );

    return;
  }

  await loadAdmin();

  alert(
    "Order updated successfully"
  );
}

function logout(){

  localStorage.removeItem(
    "token"
  );

  token = null;

  currentUser = null;

  $("appPage")
    .classList
    .add("hidden");

  $("adminNav")
    .classList
    .add("hidden");

  $("loginPage")
    .classList
    .remove("hidden");
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

    if(res.headersSent){

      return next(err);
    }

    res.status(500).json({
      error:
        "Internal server error"
    });
  }
);

/* =========================
   START
========================= */

app.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      "================================"
    );

    console.log(
      "Safe Zone Game Topup Started"
    );

    console.log(
      "Port:",
      PORT
    );

    console.log(
      "Admin:",
      ADMIN_USERNAME
    );

    console.log(
      "Telegram:",
      process.env.BOT_TOKEN &&
      process.env.CHAT_ID
        ? "Enabled"
        : "Disabled"
    );

    console.log(
      "================================"
    );

  }
);
