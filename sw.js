const V="soluna-v25";
const SHELL=["./","index.html","manifest.webmanifest","vendor/astronomy.browser.min.js","vendor/lunar.js","vendor/iztro.min.js","icons/icon-192.png","icons/icon-512.png","icons/apple-touch-icon.png"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(V).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()))});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==V).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener("fetch",e=>{
  const u=new URL(e.request.url);if(e.request.method!=="GET")return;
  if(u.hostname==="api.anthropic.com")return;
  if(u.hostname.endsWith("googleapis.com")||u.hostname.endsWith("gstatic.com")){
    e.respondWith(caches.open(V+"-fonts").then(async c=>{const hit=await c.match(e.request);const net=fetch(e.request).then(r=>{if(r.ok||r.type==="opaque")c.put(e.request,r.clone());return r}).catch(()=>hit);return hit||net}));return}
  if(u.origin!==location.origin)return;
  if(e.request.mode==="navigate"){e.respondWith(fetch(e.request).then(r=>{caches.open(V).then(c=>c.put("index.html",r.clone()));return r}).catch(()=>caches.match("index.html")));return}
  e.respondWith(caches.match(e.request).then(h=>h||fetch(e.request)));
});
