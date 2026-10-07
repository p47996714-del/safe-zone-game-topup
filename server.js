import "dotenv/config";
import express from "express";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

const PORT = Number(process.env.PORT || 3000);

const JWT_SECRET =
  process.env.JWT_SECRET || "CHANGE_THIS_SECRET";

const ADMIN_USERNAME =
  process.env.ADMIN_USERNAME || "admin";

const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD || "CHANGE_THIS_PASSWORD";

const TELEGRAM_BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN || "";

const TELEGRAM_CHAT_ID =
  process.env.TELEGRAM_CHAT_ID || "";

/* =========================
   DATABASE
========================= */

const dataDir = path.join(__dirname, "data");

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(
  path.join(dataDir, "safezone.db")
);

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

/* =========================
   DEFAULT ADMIN
========================= */

const existingAdmin = db
  .prepare(
    "SELECT id FROM admins WHERE username = ?"
  )
  .get(ADMIN_USERNAME);

if (!existingAdmin) {
  const passwordHash = bcrypt.hashSync(
    ADMIN_PASSWORD,
    12
  );

  db.prepare(
    "INSERT INTO admins(username,password_hash) VALUES(?,?)"
  ).run(
    ADMIN_USERNAME,
    passwordHash
  );
}

/* =========================
   DEFAULT GAMES
========================= */

const existingGame = db
  .prepare("SELECT id FROM games LIMIT 1")
  .get();

if (!existingGame) {
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
}

/* =========================
   MIDDLEWARE
========================= */

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

/* =========================
   AUTH
========================= */

function auth(req, res, next) {
  const header =
    req.headers.authorization || "";

  if (!header.startsWith("Bearer ")) {
    return res
      .status(401)
      .json({
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
    return res
      .status(401)
      .json({
        error: "Invalid token"
      });
  }
}

function adminOnly(req, res, next) {
  if (req.user?.role !== "admin") {
    return res
      .status(403)
      .json({
        error: "Admin only"
      });
  }

  next();
}

/* =========================
   HELPERS
========================= */

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

/* =========================
   TELEGRAM
========================= */

async function telegramCall(
  method,
  body
) {
  if (!TELEGRAM_BOT_TOKEN) {
    console.log(
      "Telegram disabled: TELEGRAM_BOT_TOKEN is missing."
    );

    return null;
  }

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`,
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

async function notifyTelegram(message) {
  if (!TELEGRAM_CHAT_ID) {
    console.log(
      "Telegram notification skipped: TELEGRAM_CHAT_ID is missing."
    );

    return;
  }

  await telegramCall(
    "sendMessage",
    {
      chat_id: TELEGRAM_CHAT_ID,
      text: message
    }
  );
}

/* =========================
   ADMIN LOGIN
========================= */

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
      return res
        .status(401)
        .json({
          error:
            "Invalid admin login"
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

/* =========================
   USER REGISTER
========================= */

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
      return res
        .status(400)
        .json({
          error:
            "Username and password (6+ chars) required"
        });
    }

    try {
      const passwordHash =
        bcrypt.hashSync(
          password,
          12
        );

      const result = db
        .prepare(
          "INSERT INTO users(username,password_hash) VALUES(?,?)"
        )
        .run(
          username,
          passwordHash
        );

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
      res
        .status(409)
        .json({
          error:
            "Username already exists"
        });
    }
  }
);

/* =========================
   USER LOGIN
========================= */

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
      return res
        .status(401)
        .json({
          error:
            "Invalid login"
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

/* =========================
   GAMES
========================= */

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

/* =========================
   PACKAGES
========================= */

app.get(
  "/api/packages",
  (req, res) => {
    const packages = db
      .prepare(`
        SELECT
          p.id,
          p.name,
          p.price,
          g.name AS game
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

/* =========================
   CURRENT USER
========================= */

app.get(
  "/api/me",
  auth,
  (req, res) => {
    if (
      req.user.role === "admin"
    ) {
      return res.json({
        username:
          req.user.username,
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
      return res
        .status(404)
        .json({
          error: "User not found"
        });
    }

    res.json({
      ...user,
      role: "user"
    });
  }
);

/* =========================
   ORDERS
========================= */

app.get(
  "/api/orders",
  auth,
  (req, res) => {
    const orders =
      req.user.role === "admin"
        ? db
            .prepare(
              "SELECT * FROM orders ORDER BY id DESC"
            )
            .all()
        : db
            .prepare(
              "SELECT * FROM orders WHERE user_id=? ORDER BY id DESC"
            )
            .all(req.user.id);

    res.json(orders);
  }
);

/* =========================
   PROMO CHECK
========================= */

app.post(
  "/api/promos/check",
  (req, res) => {
    const code = String(
      req.body?.code || ""
    )
      .trim()
      .toUpperCase();

    if (!code) {
      return res
        .status(400)
        .json({
          error:
            "Promo code required"
        });
    }

    const promo = db
      .prepare(
        "SELECT * FROM promos WHERE code=? AND active=1"
      )
      .get(code);

    if (!promo) {
      return res
        .status(404)
        .json({
          error:
            "Promo code not found"
        });
    }

    res.json(promo);
  }
);

/* =========================
   CREATE ORDER
========================= */

app.post(
  "/api/orders",
  auth,
  async (req, res) => {
    if (
      req.user.role !== "user"
    ) {
      return res
        .status(403)
        .json({
          error:
            "Customer account required"
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

    const base = Number(
      subtotal
    );

    if (
      !game ||
      !packageName ||
      !playerId ||
      !paymentMethod ||
      !Number.isFinite(base) ||
      base <= 0
    ) {
      return res
        .status(400)
        .json({
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
          String(
            promoCode
          ).toUpperCase()
        );

      if (promo) {
        if (
          promo.type ===
          "percent"
        ) {
          discount = Math.floor(
            base *
              promo.value /
              100
          );
        } else {
          discount =
            promo.value;
        }

        discount = Math.max(
          0,
          Math.min(
            discount,
            base
          )
        );
      }
    }

    const total =
      base - discount;

    const orderCode =
      makeOrderCode();

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
        paymentReference ||
          null,
        promo?.code ||
          null,
        base,
        discount,
        total
      );

    await notifyTelegram(
`🧾 Safe Zone Order

Order: ${orderCode}
Game: ${game}
Package: ${packageName}
Player ID: ${playerId}

Payment: ${paymentMethod}
Total: ${total} MMK

Status: Pending`
    );

    res.json({
      id:
        result.lastInsertRowid,
      orderCode,
      total,
      discount,
      status:
        "Pending"
    });
  }
);

/* =========================
   ADMIN ORDER STATUS
========================= */

app.post(
  "/api/admin/orders/:id/status",
  auth,
  adminOnly,
  async (req, res) => {
    const allowed = [
      "Pending",
      "Processing",
      "Completed",
      "Rejected"
    ];

    const status =
      req.body?.status;

    if (
      !allowed.includes(
        status
      )
    ) {
      return res
        .status(400)
        .json({
          error:
            "Invalid status"
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
      return res
        .status(404)
        .json({
          error:
            "Order not found"
        });
    }

    const order = db
      .prepare(
        "SELECT * FROM orders WHERE id=?"
      )
      .get(req.params.id);

    await notifyTelegram(
`🔔 Safe Zone Order Update

Order: ${order.order_code}
Game: ${order.game}
Package: ${order.package}

Status: ${status}`
    );

    res.json({
      ok: true
    });
  }
);

/* =========================
   ADMIN WALLET
========================= */

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
      !Number.isInteger(
        amount
      ) ||
      amount === 0
    ) {
      return res
        .status(400)
        .json({
          error:
            "Integer amount required"
        });
    }

    const transaction =
      db.transaction(() => {
        const user = db
          .prepare(
            "SELECT id FROM users WHERE id=?"
          )
          .get(
            req.params.userId
          );

        if (!user) {
          throw new Error(
            "USER_NOT_FOUND"
          );
        }

        db.prepare(
          "UPDATE users SET wallet_balance=wallet_balance+? WHERE id=?"
        ).run(
          amount,
          req.params.userId
        );

        db.prepare(
          "INSERT INTO wallet_ledger(user_id,amount,type,note) VALUES(?,?,?,?)"
        ).run(
          req.params.userId,
          amount,
          amount > 0
            ? "credit"
            : "debit",
          note
        );
      });

    try {
      transaction();

      res.json({
        ok: true
      });
    } catch (error) {
      if (
        error.message ===
        "USER_NOT_FOUND"
      ) {
        return res
          .status(404)
          .json({
            error:
              "User not found"
          });
      }

      res
        .status(500)
        .json({
          error:
            "Wallet update failed"
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

/* =========================
   ADMIN GAMES
========================= */

app.post(
  "/api/admin/games",
  auth,
  adminOnly,
  (req, res) => {
    const name = String(
      req.body?.name || ""
    ).trim();

    if (!name) {
      return res
        .status(400)
        .json({
          error:
            "Game name required"
        });
    }

    const result = db
      .prepare(
        "INSERT INTO games(name) VALUES(?)"
      )
      .run(name);

    res.json({
      id:
        result.lastInsertRowid,
      name
    });
  }
);

/* =========================
   ADMIN PACKAGES
========================= */

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

    const numericPrice =
      Number(price);

    if (
      !gameId ||
      !name ||
      !Number.isInteger(
        numericPrice
      )
    ) {
      return res
        .status(400)
        .json({
          error:
            "Invalid package"
        });
    }

    const game = db
      .prepare(
        "SELECT id FROM games WHERE id=?"
      )
      .get(gameId);

    if (!game) {
      return res
        .status(404)
        .json({
          error:
            "Game not found"
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
        numericPrice
      );

    res.json({
      id:
        result.lastInsertRowid
    });
  }
);

/* =========================
   ADMIN PROMOS
========================= */

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

    const numericValue =
      Number(value);

    if (
      !code ||
      !["percent", "fixed"]
        .includes(type) ||
      !Number.isInteger(
        numericValue
      )
    ) {
      return res
        .status(400)
        .json({
          error:
            "Invalid promo"
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
          String(code)
            .trim()
            .toUpperCase(),
          type,
          numericValue
        );

      res.json({
        id:
          result.lastInsertRowid
      });

    } catch {
      res
        .status(409)
        .json({
          error:
            "Promo already exists"
        });
    }
  }
);

/* =========================
   TELEGRAM BOT POLLING
========================= */

async function telegramBotLoop() {
  if (!TELEGRAM_BOT_TOKEN) {
    console.log(
      "Telegram bot disabled: TELEGRAM_BOT_TOKEN is missing."
    );

    return;
  }

  console.log(
    "Telegram bot polling enabled."
  );

  let offset = 0;

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

      for (
        const update of
          data?.result || []
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

        if (
          text === "/start"
        ) {
          await telegramCall(
            "sendMessage",
            {
              chat_id:
                chatId,
              text:
`🛡️ Safe Zone Game Topup

Welcome! 🎮

Commands:

/status - Check recent order
/help - Show commands

Please use the Safe Zone website to place an order.`
            }
          );

        } else if (
          text === "/help"
        ) {
          await telegramCall(
            "sendMessage",
            {
              chat_id:
                chatId,
              text:
`📌 Safe Zone Bot

/status — Recent order status
/help — Help

For ordering, please use the Safe Zone Game Topup website.`
            }
          );

        } else {
          await telegramCall(
            "sendMessage",
            {
              chat_id:
                chatId,
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
        resolve =>
          setTimeout(
            resolve,
            3000
          )
      );
    }
  }
}

/* =========================
   HEALTH CHECK
========================= */

app.get(
  "/health",
  (req, res) => {
    res.json({
      ok: true,
      service:
        "Safe Zone Game Topup",
      telegram:
        Boolean(
          TELEGRAM_BOT_TOKEN
        )
    });
  }
);

/* =========================
   WEBSITE FALLBACK
========================= */

app.get(
  "/*splat",
  (req, res) => {
    if (
      req.path.startsWith(
        "/api/"
      )
    ) {
      return res
        .status(404)
        .json({
          error:
            "Not found"
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

/* =========================
   START SERVER
========================= */

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `Safe Zone V7 running on port ${PORT}`
    );

    if (
      TELEGRAM_BOT_TOKEN
    ) {
      console.log(
        "Telegram token loaded."
      );
    } else {
      console.log(
        "WARNING: TELEGRAM_BOT_TOKEN is missing."
      );
    }

    if (
      TELEGRAM_CHAT_ID
    ) {
      console.log(
        "Telegram chat ID loaded."
      );
    } else {
      console.log(
        "WARNING: TELEGRAM_CHAT_ID is missing."
      );
    }

    telegramBotLoop();
  }
);
