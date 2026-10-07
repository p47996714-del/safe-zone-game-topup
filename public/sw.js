
const CACHE='safe-zone-v9';
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(['/','/index.html','/style.css','/app.js','/v9-pro-enhancement.js','/manifest.webmanifest']))));
self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;e.respondWith(caches.match(e.request).then(x=>x||fetch(e.request).catch(()=>caches.match('/'))));});
