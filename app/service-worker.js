const CACHE = 'ble-mouse-v8';

// Derive base path from the SW location so it works under any subpath
// e.g. if served at /mouse/, BASE = '/mouse/'
const BASE = new URL('./', self.location.href).pathname;

const ASSETS = [
  BASE,
  BASE + 'index.html',
  BASE + 'app.js',
  BASE + 'voice.js',
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
  // Network-first: always try server, update cache, fall back to cache when offline
  e.respondWith(
    fetch(e.request)
      .then(response => {
        const clone = response.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return response;
      })
      .catch(() => caches.match(e.request))
  );
});
