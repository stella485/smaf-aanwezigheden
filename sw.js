// Zorgt dat de app ook opent zonder internet (bv. in het bos).
// Eerst het netwerk proberen, anders de laatst bewaarde versie gebruiken.
const CACHE = "smaf-aanwezigheden-v1";
const SHELL = ["./", "index.html", "app.js", "config.js", "manifest.webmanifest", "icon-192.png", "icon-512.png", "apple-touch-icon.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const ours = url.origin === location.origin;
  const lib = url.hostname === "www.gstatic.com" || url.hostname.endsWith("fonts.googleapis.com") || url.hostname === "fonts.gstatic.com";
  if (!ours && !lib) return; // Firebase-verkeer zelf niet aanraken
  e.respondWith(
    fetch(req).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res; })
      .catch(() => caches.match(req).then(r => r || caches.match("index.html")))
  );
});
