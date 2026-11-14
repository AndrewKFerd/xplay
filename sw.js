// XPLAY service worker — only used when XPLAY runs as a web app (phones / tablets / any browser),
// never under tools/serve.py (the desktop app has its own disk cache and updater).
//   app files (html/js/css/data): network first, so a new release shows up on the next launch;
//                                 the cached copy is used offline.
//   card art + fonts:             cache first — they never change, and each is downloaded once.
const APP = 'xplay-app';
const ART = 'xplay-art';
const ART_HOSTS = ['assets.xross-stars.com', 'fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net', 'unpkg.com'];

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    if (/\/(api\/|img$|events)/.test(url.pathname)) return;
    e.respondWith(networkFirst(req));
  } else if (ART_HOSTS.includes(url.hostname)) {
    e.respondWith(cacheFirst(req));
  }
});

async function networkFirst(req) {
  const cache = await caches.open(APP);
  try {
    const res = await fetch(req, { cache: 'no-cache' }); // revalidate with the server (ETag), no stale HTTP cache
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === 'navigate') { const home = await cache.match('./'); if (home) return home; }
    throw err;
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(ART);
  const hit = await cache.match(req.url);
  if (hit) return hit;
  // CORS fetch: the image hosts allow it, and unlike an opaque response it doesn't eat ~7 MB of quota each
  let res;
  try { res = await fetch(req.url, { mode: 'cors', credentials: 'omit' }); } catch { res = await fetch(req); }
  if (res.ok) cache.put(req.url, res.clone());
  return res;
}
