/* Service worker — offline cache for the app shell.
   Strategy: network-first for the app shell (HTML/CSS/JS) so new deploys are
   picked up immediately, falling back to cache when offline. Bump CACHE on
   every release to evict stale assets. */
const CACHE = 'nfc-studio-v3';
const ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/records.js',
  './js/nfc.js',
  './js/app.js',
  './manifest.json'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  // Network-first: always try the live version, cache it, fall back when offline.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then((cached) => cached || caches.match('./index.html')))
  );
});
