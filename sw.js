// Network first (always fresh when online), cache as the offline fallback.
// Requests skip the browser's HTTP cache (GitHub Pages allows 10 minutes),
// so a new version shows up on the very next open.
const CACHE = 'lapse-v4';
const SHELL = [
  './',
  'index.html',
  'css/app.css',
  'js/app.js',
  'js/lapse.js',
  'js/store.js',
  'js/camera.js',
  'js/wake.js',
  'js/export.js',
  'js/timelog.js',
  'js/charts.js',
  'js/dash.js',
  'vendor/mp4-muxer.mjs',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
  'icons/favicon-32.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Same approach as Nook's (works on iPhone): page loads can't take extra fetch options,
// so those are fetched by URL.
const fresh = (req) =>
  req.mode === 'navigate'
    ? fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' })
    : fetch(req, { cache: 'no-cache' });

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fresh(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true })),
  );
});
