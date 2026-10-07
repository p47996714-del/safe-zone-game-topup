import "dotenv/config";
import express from "express";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

const PORT = Number(process.env.PORT || 3000);

const JWT_SECRET =
  process.env.JWT_SECRET || "CHANGE_ME_IN_PRODUCTION";

const ADMIN_USERNAME =
  process.env.ADMIN_USERNAME || "admin";

const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD || "CHANGE_ME";

/* =========================================
   DATABASE
========================================= */

const dataDir = path.join(__dirname, "data");

fs.mkdirSync(dataDir, {
  recursive: true
});

const dbPath = path.join(dataDir, "safezone.db");

const db = new Database(dbPath);

db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  wallet_balance INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS packages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  price INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY(game_id) REFERENCES games(id)
);

CREATE TABLE IF NOT EXISTS promos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('percent','fixed')),
  value INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_code TEXT UNIQUE NOT NULL,
  user_id INTEGER,
  game TEXT NOT NULL,
  package TEXT NOT NULL,
  player_id TEXT NOT NULL,
  payment_method TEXT NOT NULL,
  payment_reference TEXT,
  promo_code TEXT,
  subtotal INTEGER NOT NULL,
  discount INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'Pending',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS wallet_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  type TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);

/* =========================================
   DEFAULT ADMIN
========================================= */

if (
  !db
    .prepare("SELECT id FROM admins WHERE username = ?")
    .get(ADMIN_USERNAME)
) {
  db.prepare(
    "INSERT INTO admins(username,password_hash) VALUES(?,?)"
  ).run(
    ADMIN_USERNAME,
    bcrypt.hashSync(ADMIN_PASSWORD, 12)
  );

  console.log(`Admin created: ${ADMIN_USERNAME}`);
}

/* =========================================
   DEFAULT GAMES
========================================= */

if (!db.prepare("SELECT id FROM games LIMIT 1").get()) {
  const games = [
    "MLBB",
    "PUBG",
    "COC",
    "Roblox",
    "App Premium"
  ];

  const insertGame = db.prepare(
    "INSERT INTO games(name) VALUES(?)"
  );

  const transaction = db.transaction(() => {
    for (const game of games) {
      insertGame.run(game);
    }
  });

  transaction();

  console.log("Default games created.");
}

/* =========================================
   MIDDLEWARE
========================================= */

app.use(
  express.json({
    limit: "1mb"
  })
);

app.use(
  express.urlencoded({
    extended: true
  })
);

app.use(
  express.static(
    path.join(__dirname, "public")
  )
);

/* =========================================
   AUTH
========================================= */

function auth(req, res, next) {
  const header =
    req.headers.authorization || "";

  if (!header.startsWith("Bearer ")) {
    return res.status(401).json({
      error: "Unauthorized"
    });
  }

  const token = header.slice(7);

  try {
    req.user = jwt.verify(
      token,
      JWT_SECRET
    );

    next();
  } catch {
    return res.status(401).json({
      error: "Invalid token"
    });
  }
}

function adminOnly(req, res, next) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({
      error: "Admin only"
    });
  }

  next();
}

/* =========================================
   ORDER CODE
========================================= */

function makeOrderCode() {
  return (
    "SZ" +
    Date.now()
      .toString(36)
      .toUpperCase() +
    Math.random()
      .toString(36)
      .slice(2, 6)
      .toUpperCase()
  );
}

/* =========================================
   ADMIN LOGIN
========================================= */

app.post(
  "/api/admin/login",
  (req, res) => {
    const {
      username,
      password
    } = req.body || {};

    const admin = db
      .prepare(
        "SELECT * FROM admins WHERE username=?"
      )
      .get(username);

    if (
      !admin ||
      !bcrypt.compareSync(
        password || "",
        admin.password_hash
      )
    ) {
      return res.status(401).json({
        error: "Invalid admin login"
      });
    }

    const token = jwt.sign(
      {
        id: admin.id,
        username: admin.username,
        role: "admin"
      },
      JWT_SECRET,
      {
        expiresIn: "12h"
      }
    );

    res.json({
      token
    });
  }
);

/* =========================================
   USER REGISTER
========================================= */

app.post(
  "/api/register",
  (req, res) => {
    const {
      username,
      password
    } = req.body || {};

    if (
      !username ||
      !password ||
      password.length < 6
    ) {
      return res.status(400).json({
        error:
          "Username and password (6+ chars) required"
      });
    }

    try {
      const hash = bcrypt.hashSync(
        password,
        12
      );

      const result = db
        .prepare(
          "INSERT INTO users(username,password_hash) VALUES(?,?)"
        )
        .run(username, hash);

      const token = jwt.sign(
        {
          id: result.lastInsertRowid,
          username,
          role: "user"
        },
        JWT_SECRET,
        {
          expiresIn: "7d"
        }
      );

      res.json({
        token,
        username
      });
    } catch {
      res.status(409).json({
        error: "Username already exists"
      });
    }
  }
);

/* =========================================
   USER LOGIN
========================================= */

app.post(
  "/api/login",
  (req, res) => {
    const {
      username,
      password
    } = req.body || {};

    const user = db
      .prepare(
        "SELECT * FROM users WHERE username=?"
      )
      .get(username);

    if (
      !user ||
      !bcrypt.compareSync(
        password || "",
        user.password_hash
      )
    ) {
      return res.status(401).json({
        error: "Invalid login"
      });
    }

    const token = jwt.sign(
      {
        id: user.id,
        username: user.username,
        role: "user"
      },
      JWT_SECRET,
      {
        expiresIn: "7d"
      }
    );

    res.json({
      token,
      username
    });
  }
);

/* =========================================
   GAMES
========================================= */

app.get(
  "/api/games",
  (req, res) => {
    const games = db
      .prepare(
        "SELECT * FROM games WHERE active=1 ORDER BY id"
      )
      .all();

    res.json(games);
  }
);

/* =========================================
   PACKAGES
========================================= */

app.get(
  "/api/packages",
  (req, res) => {
    const packages = db
      .prepare(`
        SELECT
          p.id,
          p.name,
          p.price,
          g.name game
        FROM packages p
        JOIN games g
          ON g.id = p.game_id
        WHERE
          p.active=1
          AND g.active=1
        ORDER BY p.id
      `)
      .all();

    res.json(packages);
  }
);

/* =========================================
   CURRENT USER
========================================= */

app.get(
  "/api/me",
  auth,
  (req, res) => {
    if (req.user.role === "admin") {
      return res.json({
        username: req.user.username,
        role: "admin"
      });
    }

    const user = db
      .prepare(`
        SELECT
          id,
          username,
          wallet_balance,
          created_at
        FROM users
        WHERE id=?
      `)
      .get(req.user.id);

    if (!user) {
      return res.status(404).json({
        error: "User not found"
      });
    }

    res.json({
      ...user,
      role: "user"
    });
  }
);

/* =========================================
   ORDERS
========================================= */

app.get(
  "/api/orders",
  auth,
  (req, res) => {
    let rows;

    if (req.user.role === "admin") {
      rows = db
        .prepare(
          "SELECT * FROM orders ORDER BY id DESC"
        )
        .all();
    } else {
      rows = db
        .prepare(
          "SELECT * FROM orders WHERE user_id=? ORDER BY id DESC"
        )
        .all(req.user.id);
    }

    res.json(rows);
  }
);

/* =========================================
   CHECK PROMO
========================================= */

app.post(
  "/api/promos/check",
  (req, res) => {
    const code = String(
      req.body?.code || ""
    )
      .trim()
      .toUpperCase();

    const promo = db
      .prepare(
        "SELECT * FROM promos WHERE code=? AND active=1"
      )
      .get(code);

    if (!promo) {
      return res.status(404).json({
        error: "Promo code not found"
      });
    }

    res.json(promo);
  }
);

/* =========================================
   CREATE ORDER
========================================= */

app.post(
  "/api/orders",
  auth,
  (req, res) => {
    if (req.user.role !== "user") {
      return res.status(403).json({
        error: "Customer account required"
      });
    }

    const {
      game,
      packageName,
      playerId,
      paymentMethod,
      paymentReference,
      promoCode,
      subtotal
    } = req.body || {};

    const base = Number(subtotal);

    if (
      !game ||
      !packageName ||
      !playerId ||
      !paymentMethod ||
      !Number.isFinite(base) ||
      base <= 0
    ) {
      return res.status(400).json({
        error:
          "Missing or invalid order data"
      });
    }

    let discount = 0;
    let promo = null;

    if (promoCode) {
      promo = db
        .prepare(
          "SELECT * FROM promos WHERE code=? AND active=1"
        )
        .get(
          String(promoCode).toUpperCase()
        );

      if (promo) {
        if (promo.type === "percent") {
          discount = Math.floor(
            (base * promo.value) / 100
          );
        } else {
          discount = promo.value;
        }

        discount = Math.max(
          0,
          Math.min(discount, base)
        );
      }
    }

    const total = base - discount;

    const orderCode = makeOrderCode();

    const result = db
      .prepare(`
        INSERT INTO orders(
          order_code,
          user_id,
          game,
          package,
          player_id,
          payment_method,
          payment_reference,
          promo_code,
          subtotal,
          discount,
          total
        )
        VALUES(
          ?,?,?,?,?,?,?,?,?,?,?
        )
      `)
      .run(
        orderCode,
        req.user.id,
        game,
        packageName,
        playerId,
        paymentMethod,
        paymentReference || null,
        promo?.code || null,
        base,
        discount,
        total
      );

    notifyTelegram(
      `🧾 Safe Zone Order ${orderCode}

Game: ${game}
Package: ${packageName}
Player ID: ${playerId}
Total: ${total} MMK
Payment: ${paymentMethod}
Status: Pending`
    );

    res.json({
      id: result.lastInsertRowid,
      orderCode,
      total,
      discount,
      status: "Pending"
    });
  }
);

/* =========================================
   ADMIN UPDATE ORDER STATUS
========================================= */

app.post(
  "/api/admin/orders/:id/status",
  auth,
  adminOnly,
  (req, res) => {
    const allowed = [
      "Pending",
      "Processing",
      "Completed",
      "Rejected"
    ];

    const status =
      req.body?.status;

    if (!allowed.includes(status)) {
      return res.status(400).json({
        error: "Invalid status"
      });
    }

    const result = db
      .prepare(
        "UPDATE orders SET status=? WHERE id=?"
      )
      .run(
        status,
        req.params.id
      );

    if (!result.changes) {
      return res.status(404).json({
        error: "Order not found"
      });
    }

    const order = db
      .prepare(
        "SELECT * FROM orders WHERE id=?"
      )
      .get(req.params.id);

    notifyTelegram(
      `🔔 Order ${order.order_code}

Game: ${order.game}
Package: ${order.package}
Status: ${status}`
    );

    res.json({
      ok: true
    });
  }
);

/* =========================================
   ADMIN WALLET
========================================= */

app.post(
  "/api/admin/wallet/:userId",
  auth,
  adminOnly,
  (req, res) => {
    const amount = Number(
      req.body?.amount
    );

    const note = String(
      req.body?.note ||
        "Admin adjustment"
    );

    if (
      !Number.isInteger(amount) ||
      amount === 0
    ) {
      return res.status(400).json({
        error:
          "Integer amount required"
      });
    }

    const transaction =
      db.transaction(() => {
        db.prepare(
          "UPDATE users SET wallet_balance=wallet_balance+? WHERE id=?"
        ).run(
          amount,
          req.params.userId
        );

        db.prepare(`
          INSERT INTO wallet_ledger(
            user_id,
            amount,
            type,
            note
          )
          VALUES(?,?,?,?)
        `).run(
          req.params.userId,
          amount,
          amount > 0
            ? "credit"
            : "debit",
          note
        );
      });

    transaction();

    res.json({
      ok: true
    });
  }
);

/* =========================================
   ADMIN USERS
========================================= */

app.get(
  "/api/admin/users",
  auth,
  adminOnly,
  (req, res) => {
    const users = db
      .prepare(`
        SELECT
          id,
          username,
          wallet_balance,
          created_at
        FROM users
        ORDER BY id DESC
      `)
      .all();

    res.json(users);
  }
);

/* =========================================
   ADMIN ADD GAME
========================================= */

app.post(
  "/api/admin/games",
  auth,
  adminOnly,
  (req, res) => {
    const name = String(
      req.body?.name || ""
    ).trim();

    if (!name) {
      return res.status(400).json({
        error: "Game name required"
      });
    }

    const result = db
      .prepare(
        "INSERT INTO games(name) VALUES(?)"
      )
      .run(name);

    res.json({
      id: result.lastInsertRowid,
      name
    });
  }
);

/* =========================================
   ADMIN ADD PACKAGE
========================================= */

app.post(
  "/api/admin/packages",
  auth,
  adminOnly,
  (req, res) => {
    const {
      gameId,
      name,
      price
    } = req.body || {};

    if (
      !gameId ||
      !name ||
      !Number.isInteger(
        Number(price)
      )
    ) {
      return res.status(400).json({
        error: "Invalid package"
      });
    }

    const result = db
      .prepare(`
        INSERT INTO packages(
          game_id,
          name,
          price
        )
        VALUES(?,?,?)
      `)
      .run(
        gameId,
        name,
        Number(price)
      );

    res.json({
      id: result.lastInsertRowid
    });
  }
);

/* =========================================
   ADMIN ADD PROMO
========================================= */

app.post(
  "/api/admin/promos",
  auth,
  adminOnly,
  (req, res) => {
    const {
      code,
      type,
      value
    } = req.body || {};

    if (
      !code ||
      !["percent", "fixed"].includes(
        type
      ) ||
      !Number.isInteger(
        Number(value)
      )
    ) {
      return res.status(400).json({
        error: "Invalid promo"
      });
    }

    try {
      const result = db
        .prepare(`
          INSERT INTO promos(
            code,
            type,
            value
          )
          VALUES(?,?,?)
        `)
        .run(
          String(code).toUpperCase(),
          type,
          Number(value)
        );

      res.json({
        id: result.lastInsertRowid
      });
    } catch {
      res.status(409).json({
        error: "Promo already exists"
      });
    }
  }
);

/* =========================================
   TELEGRAM
========================================= */

async function telegramCall(
  method,
  body
) {
  const token =
    process.env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    console.log(
      "Telegram disabled: TELEGRAM_BOT_TOKEN missing"
    );

    return null;
  }

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${token}/${method}`,
      {
        method: "POST",
        headers: {
          "content-type":
            "application/json"
        },
        body: JSON.stringify(body)
      }
    );

    return await response
      .json()
      .catch(() => null);
  } catch (error) {
    console.error(
      "Telegram API error:",
      error.message
    );

    return null;
  }
}

/* =========================================
   TELEGRAM NOTIFICATION
========================================= */

async function notifyTelegram(
  message
) {
  const chat =
    process.env.TELEGRAM_CHAT_ID;

  if (!chat) {
    console.log(
      "Telegram notification skipped: TELEGRAM_CHAT_ID missing"
    );

    return;
  }

  await telegramCall(
    "sendMessage",
    {
      chat_id: chat,
      text: message
    }
  );
}

/* =========================================
   TELEGRAM BOT POLLING
========================================= */

async function telegramBotLoop() {
  const token =
    process.env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    console.log(
      "Telegram bot polling disabled."
    );

    return;
  }

  let offset = 0;

  console.log(
    "Telegram bot polling enabled."
  );

  while (true) {
    try {
      const data =
        await telegramCall(
          "getUpdates",
          {
            offset,
            timeout: 25,
            allowed_updates: [
              "message"
            ]
          }
        );

      if (!data?.ok) {
        console.error(
          "Telegram getUpdates failed:",
          data?.description ||
            "Unknown error"
        );

        await new Promise(
          (resolve) =>
            setTimeout(resolve, 5000)
        );

        continue;
      }

      for (
        const update of
          data.result || []
      ) {
        offset =
          update.update_id + 1;

        const message =
          update.message;

        if (!message?.text) {
          continue;
        }

        const chatId =
          String(
            message.chat.id
          );

        const text =
          message.text.trim();

        if (text === "/start") {
          await telegramCall(
            "sendMessage",
            {
              chat_id: chatId,
              text:
`🛡️ Safe Zone Game Topup

Welcome! 🎮

Commands:

/status - Check recent order
/help - Show commands

Website:
Safe Zone Game Topup`
            }
          );
        }

        else if (
          text === "/help"
        ) {
          await telegramCall(
            "sendMessage",
            {
              chat_id: chatId,
              text:
`📌 Safe Zone Bot

/status — Recent order status
/help — Help

For ordering, please use the Safe Zone Game Topup website.`
            }
          );
        }

        else if (
          text === "/status"
        ) {
          const orders =
            db.prepare(`
              SELECT
                order_code,
                game,
                package,
                total,
                status,
                created_at
              FROM orders
              ORDER BY id DESC
              LIMIT 1
            `).all();

          if (orders.length) {
            const order =
              orders[0];

            await telegramCall(
              "sendMessage",
              {
                chat_id: chatId,
                text:
`🧾 Latest Shop Order

Order: ${order.order_code}
Game: ${order.game}
Package: ${order.package}
Total: ${order.total} MMK
Status: ${order.status}`
              }
            );
          } else {
            await telegramCall(
              "sendMessage",
              {
                chat_id: chatId,
                text:
"No recent order found. Please use the website to place an order."
              }
            );
          }
        }

        else {
          await telegramCall(
            "sendMessage",
            {
              chat_id: chatId,
              text:
                "Use /help to see available commands."
            }
          );
        }
      }
    } catch (error) {
      console.error(
        "Telegram polling error:",
        error.message
      );

      await new Promise(
        (resolve) =>
          setTimeout(resolve, 3000)
      );
    }
  }
}

/* =========================================
   HEALTH CHECK
========================================= */

app.get(
  "/health",
  (req, res) => {
    res.json({
      ok: true,
      service: "Safe Zone Game Topup"
    });
  }
);

/* =========================================
   FRONTEND FALLBACK
========================================= */

app.get(
  "*",
  (req, res) => {
    if (
      req.path.startsWith("/api/")
    ) {
      return res.status(404).json({
        error: "Not found"
      });
    }

    res.sendFile(
      path.join(
        __dirname,
        "public",
        "index.html"
      )
    );
  }
);

/* =========================================
   ERROR HANDLER
========================================= */

app.use(
  (error, req, res, next) => {
    console.error(
      "Server error:",
      error
    );

    res.status(500).json({
      error: "Internal server error"
    });
  }
);

/* =========================================
   START SERVER
========================================= */

app.listen(
  PORT,
  () => {
    console.log(
      `Safe Zone V7 running on port ${PORT}`
    );

    telegramBotLoop();
  }
);
