// 名片盒離線快取：打開時直接用手機裡存好的版本（很快），同時在背景檢查新版。改版時把版本號 +1。
const CACHE = "cardbox-v28";
const CORE = [
  "./", "./index.html", "./manifest.webmanifest",
  "./icons/logo.png", "./icons/favicon.png", "./icons/apple-touch-icon.png",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-maskable-512.png",
  "./lib/jsQR.min.js", "./lib/zxing/zxing-reader.js", "./lib/zxing/zxing_reader.wasm"
];

self.addEventListener("install", e => {
  // 繞過瀏覽器和 GitHub 的暫存，確保存到的是最新檔案
  const fresh = u => fetch(u + (u.includes("?") ? "&" : "?") + "v=" + Date.now(), { cache: "no-store" });
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(CORE.map(u => fresh(u).then(r => { if (r.ok) return c.put(u === "./" ? "./index.html" : u, r); }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function refreshPage(cache, cached) {
  try {
    const res = await fetch("./index.html?v=" + Date.now(), { cache: "no-store" });
    if (!res.ok) return;
    const fresh = await res.clone().text();
    const old = cached ? await cached.clone().text() : null;
    await cache.put("./index.html", res);
    if (old !== null && old !== fresh) {
      const list = await self.clients.matchAll({ type: "window" });
      list.forEach(c => c.postMessage("cardbox-updated"));
    }
  } catch (e) { /* 沒網路就用舊版 */ }
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // 打開 App：先給手機裡的版本，背景再抓新版
  if (req.mode === "navigate") {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match("./index.html", { ignoreSearch: true });
      const update = refreshPage(cache, cached);
      if (cached) { e.waitUntil(update); return cached; }
      await update;
      return (await cache.match("./index.html")) || fetch(req);
    })());
    return;
  }

  // 本站圖檔與 Firebase 程式庫：快取優先；雲端同步連線一律直接走網路
  const cacheable = url.origin === location.origin
    || (url.hostname === "www.gstatic.com" && url.pathname.startsWith("/firebasejs/"))
    || (url.hostname === "cdnjs.cloudflare.com" && url.pathname.includes("/cropperjs/"));
  if (cacheable) {
    e.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        if (res.ok || res.type === "opaque") { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
      }))
    );
  }
});
