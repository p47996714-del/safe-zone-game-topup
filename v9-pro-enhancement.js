
/* Safe Zone Game Topup V9 PRO enhancement layer */
(function(){
  const $ = (s,r=document)=>r.querySelector(s);
  const $$ = (s,r=document)=>[...r.querySelectorAll(s)];

  function toast(msg){
    let t=document.querySelector('#v9-toast');
    if(!t){ t=document.createElement('div'); t.id='v9-toast'; document.body.appendChild(t); }
    t.textContent=msg; t.classList.add('show');
    clearTimeout(window.__v9toast); window.__v9toast=setTimeout(()=>t.classList.remove('show'),2600);
  }

  function inject(){
    if(document.querySelector('#v9-pro')) return;
    const wrap=document.createElement('div');
    wrap.id='v9-pro';
    wrap.innerHTML=`
      <div class="v9-hero">
        <div class="v9-glow"></div>
        <div class="v9-hero-copy">
          <span class="v9-pill">⚡ SAFE ZONE V9 PRO</span>
          <h1>Top Up Fast. Play More.<br><span>Stay Safe.</span></h1>
          <p>MLBB • PUBG • COC • Roblox • App Premium</p>
          <div class="v9-actions">
            <button data-v9="games">🎮 Browse Games</button>
            <button data-v9="orders" class="ghost">📦 My Orders</button>
          </div>
        </div>
        <div class="v9-orb"><b>SAFE</b><small>ZONE</small><i>GAME TOPUP</i></div>
      </div>

      <div class="v9-grid">
        <div class="v9-card"><strong>⚡ Fast</strong><span>Quick order flow</span></div>
        <div class="v9-card"><strong>🔒 Secure</strong><span>Protected accounts</span></div>
        <div class="v9-card"><strong>🎁 Rewards</strong><span>Points & promos</span></div>
        <div class="v9-card"><strong>🤖 Telegram</strong><span>Instant notifications</span></div>
      </div>

      <section class="v9-section" id="v9-rewards">
        <div class="v9-section-head"><div><span class="v9-kicker">LOYALTY</span><h2>Rewards Center</h2></div>
        <button class="v9-mini" id="v9-refresh-points">↻ Refresh</button></div>
        <div class="v9-reward-box">
          <div class="v9-points"><small>YOUR POINTS</small><b id="v9-points">0</b><span>points</span></div>
          <div class="v9-progress"><div><span id="v9-progress-fill"></span></div><p><b id="v9-next">100</b> points to next reward</p></div>
          <button id="v9-claim">🎁 Claim Reward</button>
        </div>
      </section>

      <section class="v9-section" id="v9-status">
        <div class="v9-section-head"><div><span class="v9-kicker">TRACKING</span><h2>Order Tracker</h2></div></div>
        <div class="v9-track">
          <input id="v9-order-code" placeholder="Enter Order ID e.g. SZ-123456">
          <button id="v9-track-btn">Track Order</button>
        </div>
        <div id="v9-track-result" class="v9-result">Enter an Order ID to check your order.</div>
      </section>
    `;
    const target=document.body;
    target.insertBefore(wrap, target.firstChild);

    const style=document.createElement('style');
    style.textContent=`
      #v9-pro{font-family:inherit}
      .v9-hero{position:relative;overflow:hidden;margin:16px auto;max-width:1180px;border:1px solid rgba(0,229,255,.18);border-radius:28px;padding:42px;display:flex;justify-content:space-between;align-items:center;background:radial-gradient(circle at 75% 30%,rgba(0,229,255,.16),transparent 35%),linear-gradient(135deg,#0b1020,#101a2d);box-shadow:0 20px 60px rgba(0,0,0,.28)}
      .v9-glow{position:absolute;width:280px;height:280px;border-radius:50%;right:120px;top:-100px;background:rgba(0,229,255,.13);filter:blur(40px)}
      .v9-hero-copy{position:relative;z-index:2}.v9-pill,.v9-kicker{font-size:11px;letter-spacing:2px;font-weight:800;color:#67e8f9}
      .v9-hero h1{font-size:clamp(34px,5vw,64px);line-height:1.02;margin:14px 0 12px}.v9-hero h1 span{color:#67e8f9}.v9-hero p{opacity:.72}
      .v9-actions{display:flex;gap:10px;margin-top:22px}.v9-actions button,.v9-track button,.v9-reward-box button{border:0;border-radius:12px;padding:12px 18px;font-weight:800;cursor:pointer;background:#67e8f9;color:#061018}.v9-actions .ghost{background:rgba(255,255,255,.07);color:inherit;border:1px solid rgba(255,255,255,.1)}
      .v9-orb{position:relative;z-index:2;width:190px;height:190px;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;border:1px solid rgba(103,232,249,.35);background:radial-gradient(circle,#17314a,#08111e 68%);box-shadow:0 0 60px rgba(0,229,255,.12),inset 0 0 35px rgba(103,232,249,.08);transform:rotate(-6deg)}
      .v9-orb b{font-size:38px;letter-spacing:2px}.v9-orb small{font-size:14px;letter-spacing:6px;color:#67e8f9}.v9-orb i{font-size:9px;letter-spacing:2px;opacity:.6;margin-top:10px;font-style:normal}
      .v9-grid{max-width:1180px;margin:18px auto;display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.v9-card{padding:18px;border-radius:18px;background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.08)}.v9-card strong,.v9-card span{display:block}.v9-card span{font-size:12px;opacity:.55;margin-top:5px}
      .v9-section{max-width:1180px;margin:22px auto;padding:22px;border-radius:22px;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.08)}.v9-section-head{display:flex;justify-content:space-between;align-items:center}.v9-section h2{margin:5px 0 18px}.v9-mini{border:1px solid rgba(255,255,255,.1);background:transparent;color:inherit;padding:8px 12px;border-radius:10px;cursor:pointer}
      .v9-reward-box{display:grid;grid-template-columns:160px 1fr auto;gap:22px;align-items:center}.v9-points b{display:block;font-size:42px;color:#67e8f9}.v9-points small{opacity:.5}.v9-points span{font-size:12px;opacity:.55}.v9-progress>div{height:10px;background:rgba(255,255,255,.08);border-radius:99px;overflow:hidden}.v9-progress span{display:block;height:100%;width:0;background:#67e8f9;border-radius:99px;transition:.4s}.v9-progress p{font-size:12px;opacity:.6}.v9-track{display:flex;gap:10px}.v9-track input{flex:1;min-width:0;padding:13px 14px;border-radius:12px;border:1px solid rgba(255,255,255,.1);background:rgba(0,0,0,.2);color:inherit}.v9-result{margin-top:12px;padding:14px;border-radius:12px;background:rgba(255,255,255,.04);font-size:13px;opacity:.8}
      #v9-toast{position:fixed;right:18px;bottom:18px;z-index:99999;padding:13px 16px;border-radius:13px;background:#101827;color:#fff;border:1px solid rgba(103,232,249,.25);box-shadow:0 15px 40px rgba(0,0,0,.35);transform:translateY(20px);opacity:0;pointer-events:none;transition:.25s}#v9-toast.show{transform:none;opacity:1}
      @media(max-width:760px){.v9-hero{padding:28px 20px}.v9-orb{width:125px;height:125px}.v9-orb b{font-size:25px}.v9-grid{grid-template-columns:repeat(2,1fr);padding:0 10px}.v9-section{margin:16px 10px}.v9-reward-box{grid-template-columns:1fr}.v9-track{flex-direction:column}.v9-actions{flex-wrap:wrap}}
    `;
    document.head.appendChild(style);

    function getToken(){ return localStorage.getItem('safezone_token') || localStorage.getItem('token') || ''; }
    async function api(path, opts={}){
      try{
        const r=await fetch(path,{...opts,headers:{'Content-Type':'application/json',...(opts.headers||{}),...(getToken()?{Authorization:'Bearer '+getToken()}: {})}});
        const d=await r.json().catch(()=>({}));
        return {ok:r.ok,data:d};
      }catch(e){return {ok:false,data:{error:e.message}}}
    }

    function localPoints(){
      const p=parseInt(localStorage.getItem('safezone_points')||'0',10);
      $('#v9-points').textContent=p;
      const next=100-(p%100); $('#v9-next').textContent=next;
      $('#v9-progress-fill').style.width=((p%100))+'%';
    }
    localPoints();

    $$('[data-v9]').forEach(b=>b.onclick=()=>{
      const id=b.dataset.v9;
      const el=id==='games'?document.querySelector('#games, .games, [data-section="games"]'):document.querySelector('#orders, .orders, [data-section="orders"]');
      if(el) el.scrollIntoView({behavior:'smooth',block:'start'}); else toast(id==='games'?'Game catalog is below':'Login to view your orders');
    });
    $('#v9-refresh-points').onclick=localPoints;
    $('#v9-claim').onclick=()=>{
      let p=parseInt(localStorage.getItem('safezone_points')||'0',10);
      if(p<100){toast('100 points ပြည့်မှ Reward Claim လုပ်နိုင်ပါတယ်။');return;}
      p-=100; localStorage.setItem('safezone_points',p); localPoints(); toast('🎁 Reward claimed!');
    };
    $('#v9-track-btn').onclick=async()=>{
      const code=$('#v9-order-code').value.trim();
      if(!code){toast('Order ID ထည့်ပါ');return;}
      const r=await api('/api/orders?mine=true');
      if(r.ok && Array.isArray(r.data)){
        const found=r.data.find(o=>String(o.order_code||o.code||'').toLowerCase()===code.toLowerCase());
        $('#v9-track-result').textContent=found?`📦 ${found.order_code||found.code} — ${found.status||'pending'}`:'Order မတွေ့ပါ။ ID ကိုပြန်စစ်ပါ။';
      }else $('#v9-track-result').textContent='Login ဝင်ပြီးမှ Order Track လုပ်နိုင်ပါတယ်။';
    };
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',inject); else inject();
})();
