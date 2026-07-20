const CACHE_NAME = "filedrop-shell-v3";
const SHELL_FILES = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./peerjs.min.js",
  "./qrcode.min.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  // only handle same-origin shell requests; let PeerJS/CDN/signaling traffic pass through
  if (url.origin !== location.origin) return;

  // opening the app: always prefer a fresh network copy, and only fall back
  // to the cached shell if the network truly fails (offline / no connection)
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() => caches.match("./index.html"))
    );
    return;
  }

  // other assets (js/css/icons): serve from cache (ignoring query strings so
  // install-time URL params don't cause a false cache miss), else go to network
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((cached) => {
      if (cached) return cached;
      return fetch(req).catch(() => cached);
    })
  );
});

