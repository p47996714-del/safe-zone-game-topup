let currentUser = null;
let walletBalance = 0;

// ၁။ App စဖွင့်ချိန် Splash Logo အရင်ပြပြီး Logic စစ်ဆေးမည်
window.addEventListener("DOMContentLoaded", () => {
  setTimeout(() => {
    document.getElementById("splash-screen").classList.add("hidden");
    
    // သိမ်းထားသော User Login ရှိမရှိစစ်ပါ
    const savedUser = JSON.parse(localStorage.getItem("sz_user"));
    if (savedUser) {
      currentUser = savedUser;
      walletBalance = Number(localStorage.getItem("sz_wallet") || 0);
      showApp();
    } else {
      document.getElementById("auth-screen").classList.remove("hidden");
    }
  }, 2200); // 2.2 စက္ကန့်အကြာ Splash ပျောက်မည်
});

// Auth Screen Toggle Logic
function showRegister() {
  document.getElementById("login-box").classList.add("hidden");
  document.getElementById("register-box").classList.remove("hidden");
}

function showLogin() {
  document.getElementById("register-box").classList.add("hidden");
  document.getElementById("login-box").classList.remove("hidden");
}

// ၂။ Account Register လုပ်ခြင်း
function doRegister() {
  const name = document.getElementById("reg-name").value.trim();
  const phone = document.getElementById("reg-phone").value.trim();
  const pass = document.getElementById("reg-pass").value;
  const terms = document.getElementById("terms").checked;

  if (!name || !phone || pass.length < 4) {
    alert("အချက်အလက်များကို ပြည့်စုံစွာ ဖြည့်စွက်ပါ။");
    return;
  }
  if (!terms) {
    alert("Terms & Privacy ကို သဘောတူညီရန် အမှန်ခြစ်ပါ။");
    return;
  }

  currentUser = { name, phone };
  localStorage.setItem("sz_user", JSON.stringify(currentUser));
  localStorage.setItem("sz_wallet", "0");
  walletBalance = 0;
  
  showApp();
}

// Login ဝင်ခြင်း
function doLogin() {
  const phone = document.getElementById("login-phone").value.trim();
  if (!phone) return alert("ဖုန်းနံပါတ် ထည့်သွင်းပါ။");

  currentUser = { name: "SafeZone User", phone };
  localStorage.setItem("sz_user", JSON.stringify(currentUser));
  walletBalance = Number(localStorage.getItem("sz_wallet") || 0);
  showApp();
}

// ၃။ Login ဝင်ပြီးပါက Main Dashboard ပေါ်စေခြင်း
function showApp() {
  document.getElementById("auth-screen").classList.add("hidden");
  document.getElementById("main-app").classList.remove("hidden");
  
  document.getElementById("user-display-name").textContent = currentUser.name;
  document.getElementById("user-display-phone").textContent = currentUser.phone;
  updateWalletUI();
}

function updateWalletUI() {
  document.getElementById("wallet-balance").textContent = walletBalance.toLocaleString();
}

// ၄။ Wallet ငွေဖြည့်ရန် Modal Logic
function openTopupModal() {
  document.getElementById("topup-modal").classList.remove("hidden");
}

function closeTopupModal() {
  document.getElementById("topup-modal").classList.add("hidden");
}

function setAmount(amt) {
  document.getElementById("topup-amount").value = amt;
}

function submitDeposit() {
  const amt = Number(document.getElementById("topup-amount").value);
  if (amt <= 0) return alert("မှန်ကန်သော ပမာဏ ထည့်ပါ။");

  walletBalance += amt;
  localStorage.setItem("sz_wallet", walletBalance);
  updateWalletUI();
  
  alert(`${amt.toLocaleString()} Ks ငွေဖြည့်တောင်းဆိုမှု အောင်မြင်ပါသည်။ (Wallet balance ထဲသို့ ထည့်သွင်းပြီးပါပြီ)`);
  closeTopupModal();
}

// ၅။ Wallet Balance စစ်ဆေးပြီး ဂိမ်းပစ္စည်း ဝယ်ယူခြင်း
function buyGame(gameName, price) {
  if (walletBalance < price) {
    alert(`လက်ကျန်ငွေ မလုံလောက်ပါ။\n\nလိုအပ်သောငွေ: ${price.toLocaleString()} MMK\nလက်ရှိ Balance: ${walletBalance.toLocaleString()} MMK\n\nကျေးဇူးပြု၍ အရင်ဆုံး ငွေဖြည့်ပါ!`);
    openTopupModal();
  } else {
    if (confirm(`${gameName} အတွက် ${price.toLocaleString()} MMK ကို Wallet Balance ထဲမှ နှုတ်ယူ၍ ဝယ်ယူမည်မှာ သေချာပါသလား?`)) {
      walletBalance -= price;
      localStorage.setItem("sz_wallet", walletBalance);
      updateWalletUI();
      alert("ဝယ်ယူမှု အောင်မြင်ပါသည်။ ကျေးဇူးတင်ပါသည်။!");
    }
  }
}
