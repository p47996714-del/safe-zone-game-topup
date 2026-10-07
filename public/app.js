let games=JSON.parse(localStorage.getItem("sz_games")||"null")||[
{name:"Mobile Legends",icon:"⚔️",items:[["86 Diamonds",2500],["172 Diamonds",4800],["257 Diamonds",7000],["Weekly Pass",6500]]},
{name:"PUBG Mobile",icon:"🔫",items:[["60 UC",2500],["325 UC",12000],["660 UC",23000],["1800 UC",60000]]},
{name:"Clash of Clans",icon:"🏰",items:[["Gold Pass",18000],["Gems Pack",8500],["Builder Pack",15000]]},
{name:"Roblox",icon:"🧱",items:[["400 Robux",8000],["800 Robux",15000],["1700 Robux",30000]]}];
let user=JSON.parse(localStorage.getItem("sz_user")||"null"),pick=null,payMethod=null;
const money=n=>Number(n).toLocaleString()+" MMK", orders=()=>JSON.parse(localStorage.getItem("sz_orders")||"[]");
function render(){gamesGrid.innerHTML=games.map((g,i)=>`<div class=card onclick="shop(${i})"><div class=icon>${g.icon}</div><h3>${g.name}</h3><p class=muted>${g.items.length} Packages</p></div>`).join("");renderOrders()}
function renderOrders(){if(!user){ordersList.innerHTML="Login ဝင်ပြီးမှ Order history ကိုကြည့်နိုင်ပါတယ်။";return}let a=orders().filter(x=>x.user===user.email);ordersList.innerHTML=a.length?a.reverse().map(x=>`<div class=order><b>${x.game}</b> — ${x.item}<br><small>UID: ${x.uid} • ${x.method||"-"} • ${x.date}<span class=badge>${x.status}</span></small></div>`).join(""):"Order မရှိသေးပါ။"}
function account(){modal.classList.remove("hidden");body.innerHTML=user?`<h2>My Account</h2><p>👤 ${user.name}</p><p class=muted>${user.email}</p><button onclick="logout()">Logout</button>`:`<h2>Login / Register</h2><input id=n placeholder="Name"><input id=e placeholder="Email"><input id=p type=password placeholder="Password"><button class=full onclick="login()">Continue</button>`}
function login(){if(!n.value.trim()||!e.value.trim()||p.value.length<4)return alert("အချက်အလက်တွေ ပြည့်စုံစွာထည့်ပါ။");user={name:n.value.trim(),email:e.value.trim()};localStorage.setItem("sz_user",JSON.stringify(user));closeM();renderOrders()}
function logout(){user=null;localStorage.removeItem("sz_user");closeM();renderOrders()}
function shop(i){let g=games[i];pick=null;payMethod=null;modal.classList.remove("hidden");body.innerHTML=`<h2>${g.name}</h2><input id=uid placeholder="Player ID / UID"><div class=pkgs>${g.items.map((x,j)=>`<div class=pkg onclick="choose(${j},this)"><b>${x[0]}</b><br><small>${money(x[1])}</small></div>`).join("")}</div><h3>Payment Method</h3><div class=pay>
<div onclick="payment('KPay',this)">💙 <b>KPay</b><br><small>09763442881<br>Mg Pyae Phyo Kyaw</small></div>
<div onclick="payment('WavePay',this)">💜 <b>WavePay</b><br><small>09763442881<br>Mg Pyae Phyo Kyaw</small></div>
<div onclick="payment('UAB Bank',this)">🏦 <b>UAB Bank</b><br><small>09763442881<br>Mg Pyae Phyo Kyaw</small></div>
<div onclick="payment('AYA Bank',this)">🏦 <b>AYA Bank</b><br><small>09763442881<br>Mg Pyae Phyo Kyaw</small></div>
</div><input id=ref placeholder="Payment reference / transaction note"><button class=full onclick="order(${i})">Submit Order</button>`}
function choose(j,el){pick=j;document.querySelectorAll(".pkg").forEach(x=>x.classList.remove("sel"));el.classList.add("sel")}
function payment(x,el){payMethod=x;document.querySelectorAll(".pay div").forEach(x=>x.classList.remove("sel"));el.classList.add("sel")}
function order(i){if(!user){closeM();account();return}if(!uid.value.trim()||pick===null||!payMethod)return alert("Player ID, Package နဲ့ Payment Method အားလုံးရွေးပါ။");let o=orders();o.push({user:user.email,game:games[i].name,item:games[i].items[pick][0],price:games[i].items[pick][1],uid:uid.value.trim(),method:payMethod,reference:ref.value.trim(),status:"Payment Pending",date:new Date().toLocaleString()});localStorage.setItem("sz_orders",JSON.stringify(o));alert("Order တင်ပြီးပါပြီ။ Admin က payment စစ်ပြီး top-up လုပ်ပေးပါမယ်။");closeM();renderOrders()}
function wallet(){modal.classList.remove("hidden");body.innerHTML=`<h2>Wallet</h2><p class=muted>Wallet balance ကို Admin အတည်ပြုပြီးမှ ထည့်ပေးမယ့် secure flow အတွက် ပြင်ဆင်ထားပါတယ်။</p><h3>KPay / WavePay</h3><div class=pay>
<div>💙 KPay<br><small>09763442881<br>Mg Pyae Phyo Kyaw</small></div>
<div>💜 WavePay<br><small>09763442881<br>Mg Pyae Phyo Kyaw</small></div>
<div>🏦 UAB Bank<br><small>09763442881<br>Mg Pyae Phyo Kyaw</small></div>
<div>🏦 AYA Bank<br><small>09763442881<br>Mg Pyae Phyo Kyaw</small></div>
</div><p class=muted>လက်ရှိ V3 မှာ payment ကို manual verification နဲ့ထားထားပါတယ်။</p>`}
function closeM(){modal.classList.add("hidden")}render();
/* ================= V6 ADD-ONS ================= */
const V6_PROMOS = JSON.parse(localStorage.getItem("sz_promos") || JSON.stringify([
  {code:"WELCOME5", type:"percent", value:5, active:true},
  {code:"SAFE10", type:"fixed", value:100, active:true}
]));
function v6SavePromos(){localStorage.setItem("sz_promos",JSON.stringify(V6_PROMOS));}
function v6Wallet(){
  const u=JSON.parse(localStorage.getItem("sz_user")||"null");
  const balance=Number((u&&u.wallet)||0);
  return balance;
}
function v6Receipt(order){
  if(!order) return;
  const lines=[
    "SAFE ZONE GAME TOPUP",
    "------------------------------",
    "Order ID: "+(order.id||"-"),
    "Game: "+(order.game||"-"),
    "Package: "+(order.package||"-"),
    "Player ID: "+(order.playerId||order.uid||"-"),
    "Payment: "+(order.payment||"-"),
    "Promo: "+(order.promo||"None"),
    "Total: "+(order.total??order.price??"-")+" MMK",
    "Status: "+(order.status||"Pending"),
    "------------------------------",
    "Thank you for your order!"
  ];
  const blob=new Blob([lines.join("\n")],{type:"text/plain;charset=utf-8"});
  const a=document.createElement("a"); a.href=URL.createObjectURL(blob);
  a.download=(order.id||"order")+"_receipt.txt"; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}
window.v6Receipt=v6Receipt;
window.v6Wallet=v6Wallet;
window.v6Promos=V6_PROMOS;
v6SavePromos();


/* ================= SAFE ZONE V7 API INTEGRATION ================= */
(function(){
  const API="/api";
  const tokenKey="sz_v7_token";
  const getToken=()=>localStorage.getItem(tokenKey)||"";
  const api=async(path,opts={})=>{
    const headers={"Content-Type":"application/json",...(opts.headers||{})};
    if(getToken()) headers.Authorization="Bearer "+getToken();
    const r=await fetch(API+path,{...opts,headers});
    const data=await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(data.error||"Request failed");
    return data;
  };
  window.SafeZoneV7={api,login:async(u,p)=>{
    const d=await api("/login",{method:"POST",body:JSON.stringify({username:u,password:p})});
    localStorage.setItem(tokenKey,d.token); return d;
  },register:async(u,p)=>{
    const d=await api("/register",{method:"POST",body:JSON.stringify({username:u,password:p})});
    localStorage.setItem(tokenKey,d.token); return d;
  },logout:()=>{localStorage.removeItem(tokenKey);location.reload();},
  me:()=>api("/me"),games:()=>api("/games"),packages:()=>api("/packages"),orders:()=>api("/orders"),
  promo:(code)=>api("/promos/check",{method:"POST",body:JSON.stringify({code})}),
  order:(body)=>api("/orders",{method:"POST",body:JSON.stringify(body)})
  };
  window.addEventListener("DOMContentLoaded",async()=>{
    try{
      const me=await window.SafeZoneV7.me();
      document.documentElement.dataset.v7="connected";
      window.SafeZoneCurrentUser=me;
      document.querySelectorAll("[data-v7-user]").forEach(e=>e.textContent=me.username||"Account");
      document.querySelectorAll("[data-v7-wallet]").forEach(e=>e.textContent=(me.wallet_balance||0).toLocaleString()+" MMK");
    }catch(_){}
  });
})();
