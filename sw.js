// ResortHub service worker – caches only the static app shell.
// Never caches Firebase / Firestore / Auth / Functions traffic or any guest data.
const CACHE = "resorthub-shell-v4";
const SHELL = ["./", "./index.html", "./app.js?v=2.2.0", "./manifest.json", "./icon.svg", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return; // APIs/CDNs go straight to network
  // network-first so staff always get the latest build; fall back to cache when offline
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && SHELL.some((p) => url.pathname.endsWith(p.replace("./", "/")) || (p === "./" && url.pathname.endsWith("/")))) {
          const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || (req.mode === "navigate" ? caches.match("./index.html") : Response.error())))
  );
});
