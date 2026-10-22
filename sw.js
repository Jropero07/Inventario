/* Service worker: permite instalar la app y abrirla rápido.
   Estrategia "red primero" para los archivos propios (siempre la versión más reciente si hay internet)
   y copia de respaldo para abrir la interfaz sin conexión. Los datos de Firebase NO se guardan aquí. */
const CACHE = "invti-v44";
const SHELL = ["./", "index.html", "css/styles.css", "js/app.js", "js/auth.js", "js/theme.js", "manifest.webmanifest",
  "assets/logo_colegio_160.png", "assets/favicon.png", "assets/icon-192.png", "assets/logo_efqm.png", "assets/logo_colegio.png"];
const CDN_HOSTS = ["cdnjs.cloudflare.com", "unpkg.com", "www.gstatic.com"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const cdn = CDN_HOSTS.includes(url.hostname);
  if (!sameOrigin && !cdn) return; // Firebase Database / Auth / APIs: siempre directo a la red
  if (sameOrigin) {
    e.respondWith(fetch(req).then(res => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return res; })
      .catch(() => caches.match(req).then(r => r || caches.match("index.html"))));
  } else {
    e.respondWith(caches.match(req).then(cached => {
      const net = fetch(req).then(res => { if (res.ok || res.type === "opaque") { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return res; }).catch(() => cached);
      return cached || net;
    }));
  }
});
