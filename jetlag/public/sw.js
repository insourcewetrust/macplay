// Offline cache: network first for navigations, cache first for static assets.
const CACHE = "fuseau-v1";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["./", "./index.html", "./manifest.webmanifest", "./icon.svg"])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET") return;
  const sameOrigin = url.origin === location.origin;
  if (!sameOrigin) return; // flight APIs: always live
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((r) => {
          caches.open(CACHE).then((c) => c.put("./index.html", r.clone()));
          return r;
        })
        .catch(() => caches.match("./index.html")),
    );
    return;
  }
  e.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((r) => {
          if (r.ok || r.type === "opaque") caches.open(CACHE).then((c) => c.put(req, r.clone()));
          return r;
        }),
    ),
  );
});
