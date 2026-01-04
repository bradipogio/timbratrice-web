const CACHE_NAME = "timbratrice-cache-v2";
const CORE_ASSETS = [
  "./",
  "index.html",
  "admin.html",
  "style.css",
  "manifest.json",
  "icon-192.png",
  "icon-512.png",
  "favicon-32.png",
  "favicon-16.png",
  "apple-touch-icon.png",
  "A_flat_digital_vector_illustration_in_the_form_of_.png"
];
const EXTERNAL_ASSETS = [
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2",
  "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const assets = CORE_ASSETS.concat(EXTERNAL_ASSETS);
    await Promise.all(
      assets.map((asset) => cache.add(asset).catch(() => null))
    );
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.map((key) => (key === CACHE_NAME ? null : caches.delete(key)))
    );
    self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (req.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res && res.ok) {
          const cache = await caches.open(CACHE_NAME);
          cache.put("./", res.clone());
        }
        return res;
      } catch {
        const cache = await caches.open(CACHE_NAME);
        return (await cache.match(req)) ||
          (await cache.match("./")) ||
          (await cache.match("index.html"));
      }
    })());
    return;
  }

  const isSameOrigin = url.origin === self.location.origin;
  const isExternalScript = url.origin === "https://cdn.jsdelivr.net" &&
    url.pathname.startsWith("/npm/@supabase/supabase-js@2");
  if (!isSameOrigin && !isExternalScript) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req);
    if (cached) return cached;
    try {
      const res = await fetch(req);
      if (res) cache.put(req, res.clone());
      return res;
    } catch {
      return cached || new Response("", { status: 503, statusText: "Offline" });
    }
  })());
});
