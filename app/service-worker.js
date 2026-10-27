const CACHE = 'ble-mouse-v9';

// Derive base path from the SW location so it works under any subpath
// e.g. if served at /mouse/, BASE = '/mouse/'
const BASE = new URL('./', self.location.href).pathname;

const ASSETS = [
  BASE,
  BASE + 'index.html',
  BASE + 'app.js',
  BASE + 'voice.js',
  BASE + 'updates.js',
  BASE + 'layouts.json',
  BASE + 'manifest.json',
  BASE + 'icon-192.png',
  BASE + 'icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // Only same-origin GETs are cached: the Cache API rejects POST (the speech
  // upload), and worker responses must never be served from cache.
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== self.location.origin) return;
  // version.json and firmware/ are fetched with cache: 'no-store' by the page
  // and must never be answered from (or stored in) the cache.
  const path = new URL(e.request.url).pathname;
  if (path === BASE + 'version.json' || path.startsWith(BASE + 'firmware/')) return;
  // Network-first: always try server, update cache, fall back to cache when offline.
  // 'no-cache' revalidates with the server (a cheap 304 when nothing changed)
  // instead of trusting the HTTP cache's max-age after a deploy.
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then(response => {
        const clone = response.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return response;
      })
      .catch(() => caches.match(e.request))
  );
});
