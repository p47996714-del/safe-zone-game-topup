import "dotenv/config";
import express from "express";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || "CHANGE_ME_IN_PRODUCTION";
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "CHANGE_ME";

const db = new Database(path.join(__dirname,"data","safezone.db"));
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

if (!db.prepare("SELECT id FROM admins WHERE username=?").get(ADMIN_USERNAME)) {
  db.prepare("INSERT INTO admins(username,password_hash) VALUES(?,?)")
    .run(ADMIN_USERNAME, bcrypt.hashSync(ADMIN_PASSWORD, 12));
}
if (!db.prepare("SELECT id FROM games LIMIT 1").get()) {
  const games = ["MLBB","PUBG","COC","Roblox","App Premium"];
  const ins = db.prepare("INSERT INTO games(name) VALUES(?)");
  const tx = db.transaction(()=>games.forEach(g=>ins.run(g))); tx();
}

app.use(express.json({limit:"1mb"}));
app.use(express.static(path.join(__dirname,"public")));

function auth(req,res,next){
  const h=req.headers.authorization||"";
  if(!h.startsWith("Bearer ")) return res.status(401).json({error:"Unauthorized"});
  try { req.user=jwt.verify(h.slice(7),JWT_SECRET); next(); }
  catch { res.status(401).json({error:"Invalid token"}); }
}
function adminOnly(req,res,next){
  if(req.user?.role!=="admin") return res.status(403).json({error:"Admin only"});
  next();
}
function makeOrderCode(){
  return "SZ"+Date.now().toString(36).toUpperCase()+Math.random().toString(36).slice(2,6).toUpperCase();
}

app.post("/api/admin/login",(req,res)=>{
  const {username,password}=req.body||{};
  const a=db.prepare("SELECT * FROM admins WHERE username=?").get(username);
  if(!a || !bcrypt.compareSync(password||"",a.password_hash))
    return res.status(401).json({error:"Invalid admin login"});
  const token=jwt.sign({id:a.id,username:a.username,role:"admin"},JWT_SECRET,{expiresIn:"12h"});
  res.json({token});
});

app.post("/api/register",(req,res)=>{
  const {username,password}=req.body||{};
  if(!username || !password || password.length<6) return res.status(400).json({error:"Username and password (6+ chars) required"});
  try{
    const hash=bcrypt.hashSync(password,12);
    const r=db.prepare("INSERT INTO users(username,password_hash) VALUES(?,?)").run(username,hash);
    const token=jwt.sign({id:r.lastInsertRowid,username,role:"user"},JWT_SECRET,{expiresIn:"7d"});
    res.json({token,username});
  }catch(e){res.status(409).json({error:"Username already exists"});}
});

app.post("/api/login",(req,res)=>{
  const {username,password}=req.body||{};
  const u=db.prepare("SELECT * FROM users WHERE username=?").get(username);
  if(!u || !bcrypt.compareSync(password||"",u.password_hash)) return res.status(401).json({error:"Invalid login"});
  const token=jwt.sign({id:u.id,username:u.username,role:"user"},JWT_SECRET,{expiresIn:"7d"});
  res.json({token,username});
});

app.get("/api/games",(req,res)=>res.json(db.prepare("SELECT * FROM games WHERE active=1 ORDER BY id").all()));
app.get("/api/packages",(req,res)=>res.json(db.prepare(`
SELECT p.id,p.name,p.price,g.name game FROM packages p JOIN games g ON g.id=p.game_id
WHERE p.active=1 AND g.active=1 ORDER BY p.id`).all()));

app.get("/api/me",auth,(req,res)=>{
  if(req.user.role==="admin") return res.json({username:req.user.username,role:"admin"});
  const u=db.prepare("SELECT id,username,wallet_balance,created_at FROM users WHERE id=?").get(req.user.id);
  res.json({...u,role:"user"});
});

app.get("/api/orders",auth,(req,res)=>{
  const rows=req.user.role==="admin"
    ? db.prepare("SELECT * FROM orders ORDER BY id DESC").all()
    : db.prepare("SELECT * FROM orders WHERE user_id=? ORDER BY id DESC").all(req.user.id);
  res.json(rows);
});

app.post("/api/promos/check",(req,res)=>{
  const code=String(req.body?.code||"").trim().toUpperCase();
  const p=db.prepare("SELECT * FROM promos WHERE code=? AND active=1").get(code);
  if(!p) return res.status(404).json({error:"Promo code not found"});
  res.json(p);
});

app.post("/api/orders",auth,(req,res)=>{
  if(req.user.role!=="user") return res.status(403).json({error:"Customer account required"});
  const {game,packageName,playerId,paymentMethod,paymentReference,promoCode,subtotal}=req.body||{};
  const base=Number(subtotal);
  if(!game||!packageName||!playerId||!paymentMethod||!Number.isFinite(base)||base<=0)
    return res.status(400).json({error:"Missing or invalid order data"});
  let discount=0, promo=null;
  if(promoCode){
    promo=db.prepare("SELECT * FROM promos WHERE code=? AND active=1").get(String(promoCode).toUpperCase());
    if(promo) discount=promo.type==="percent" ? Math.floor(base*promo.value/100) : promo.value;
    discount=Math.max(0,Math.min(discount,base));
  }
  const total=base-discount;
  const code=makeOrderCode();
  const r=db.prepare(`INSERT INTO orders(order_code,user_id,game,package,player_id,payment_method,payment_reference,promo_code,subtotal,discount,total)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(code,req.user.id,game,packageName,playerId,paymentMethod,paymentReference||null,promo?.code||null,base,discount,total);
  notifyTelegram(`🧾 Safe Zone Order ${code}\nGame: ${game}\nPackage: ${packageName}\nTotal: ${total} MMK\nStatus: Pending`);
  res.json({id:r.lastInsertRowid,orderCode:code,total,discount,status:"Pending"});
});

app.post("/api/admin/orders/:id/status",auth,adminOnly,(req,res)=>{
  const allowed=["Pending","Processing","Completed","Rejected"];
  const status=req.body?.status;
  if(!allowed.includes(status)) return res.status(400).json({error:"Invalid status"});
  const r=db.prepare("UPDATE orders SET status=? WHERE id=?").run(status,req.params.id);
  if(!r.changes) return res.status(404).json({error:"Order not found"});
  const o=db.prepare("SELECT * FROM orders WHERE id=?").get(req.params.id);
  notifyTelegram(`🔔 Order ${o.order_code}\nStatus: ${status}`);
  res.json({ok:true});
});

app.post("/api/admin/wallet/:userId",auth,adminOnly,(req,res)=>{
  const amount=Number(req.body?.amount), note=String(req.body?.note||"Admin adjustment");
  if(!Number.isInteger(amount)||amount===0) return res.status(400).json({error:"Integer amount required"});
  const tx=db.transaction(()=>{
    db.prepare("UPDATE users SET wallet_balance=wallet_balance+? WHERE id=?").run(amount,req.params.userId);
    db.prepare("INSERT INTO wallet_ledger(user_id,amount,type,note) VALUES(?,?,?,?)")
      .run(req.params.userId,amount,amount>0?"credit":"debit",note);
  });
  tx(); res.json({ok:true});
});

app.get("/api/admin/users",auth,adminOnly,(req,res)=>res.json(
  db.prepare("SELECT id,username,wallet_balance,created_at FROM users ORDER BY id DESC").all()
));
app.post("/api/admin/games",auth,adminOnly,(req,res)=>{
  const name=String(req.body?.name||"").trim();
  if(!name) return res.status(400).json({error:"Game name required"});
  const r=db.prepare("INSERT INTO games(name) VALUES(?)").run(name);
  res.json({id:r.lastInsertRowid,name});
});
app.post("/api/admin/packages",auth,adminOnly,(req,res)=>{
  const {gameId,name,price}=req.body||{};
  if(!gameId||!name||!Number.isInteger(Number(price))) return res.status(400).json({error:"Invalid package"});
  const r=db.prepare("INSERT INTO packages(game_id,name,price) VALUES(?,?,?)").run(gameId,name,Number(price));
  res.json({id:r.lastInsertRowid});
});
app.post("/api/admin/promos",auth,adminOnly,(req,res)=>{
  const {code,type,value}=req.body||{};
  if(!code||!["percent","fixed"].includes(type)||!Number.isInteger(Number(value))) return res.status(400).json({error:"Invalid promo"});
  try{
    const r=db.prepare("INSERT INTO promos(code,type,value) VALUES(?,?,?)").run(String(code).toUpperCase(),type,Number(value));
    res.json({id:r.lastInsertRowid});
  }catch{res.status(409).json({error:"Promo already exists"});}
});

async function telegramCall(method, body){
  const token=process.env.TELEGRAM_BOT_TOKEN;
  if(!token) return null;
  const r=await fetch(`https://api.telegram.org/bot${token}/${method}`,{
    method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)
  });
  return r.json().catch(()=>null);
}
async function notifyTelegram(message){
  const chat=process.env.TELEGRAM_CHAT_ID;
  if(!chat) return;
  await telegramCall("sendMessage",{chat_id:chat,text:message});
}
async function telegramBotLoop(){
  if(!process.env.TELEGRAM_BOT_TOKEN) return;
  let offset=0;
  console.log("Telegram bot polling enabled.");
  while(true){
    try{
      const data=await telegramCall("getUpdates",{offset,timeout:25,allowed_updates:["message"]});
      for(const u of (data?.result||[])){
        offset=u.update_id+1;
        const m=u.message;
        if(!m?.text) continue;
        const chatId=String(m.chat.id);
        const text=m.text.trim();
        if(text==="/start"){
          await telegramCall("sendMessage",{chat_id:chatId,text:
`🛡️ Safe Zone Game Topup

Welcome! 🎮

Commands:
/status - Check your recent order
/help - Show commands

Website: Safe Zone Game Topup`});
        } else if(text==="/help"){
          await telegramCall("sendMessage",{chat_id:chatId,text:
`📌 Safe Zone Bot

/status — recent order status
/help — help

For ordering, please use the Safe Zone Game Topup website.`});
        } else if(text==="/status"){
          const orders=db.prepare(
            "SELECT order_code,game,package,total,status,created_at FROM orders WHERE user_id IS NULL ORDER BY id DESC LIMIT 1"
          ).all();
          await telegramCall("sendMessage",{chat_id:chatId,text:
orders.length
? `🧾 Latest shop order\n\nOrder: ${orders[0].order_code}\nGame: ${orders[0].game}\nPackage: ${orders[0].package}\nTotal: ${orders[0].total} MMK\nStatus: ${orders[0].status}`
: "No recent order found. Please use the website to place an order."});
        } else {
          await telegramCall("sendMessage",{chat_id:chatId,text:"Use /help to see available commands."});
        }
      }
    }catch(e){
      console.error("Telegram polling error:",e.message);
      await new Promise(r=>setTimeout(r,3000));
    }
  }
}

app.get("*",(req,res)=>{
  if(req.path.startsWith("/api/")) return res.status(404).json({error:"Not found"});
  res.sendFile(path.join(__dirname,"public","index.html"));
});
app.listen(PORT,()=>{ console.log(`Safe Zone V7 running on http://localhost:${PORT}`); telegramBotLoop(); });
