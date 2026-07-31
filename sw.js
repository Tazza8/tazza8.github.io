const CACHE_NAME = 'evolv-v8';
const ASSETS = [
  '.',
  'index.html',
  'styles.css',
  'app.js',
  'auth.js',
  'exercises.js',
  'brand.js',
  'supabase-config.js',
  'vendor/supabase.js',
  'register-sw.js',
  'manifest.webmanifest',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  // cache.addAll() doesn't bypass the browser's own HTTP cache, so a stale
  // response sitting there could get copied straight into this brand-new
  // named cache. { cache: 'reload' } forces each of these through the
  // network for real.
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(ASSETS.map((url) =>
        fetch(url, { cache: 'reload' }).then((response) => cache.put(url, response))
      ))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Cache-first for the app's own files, so the shell opens instantly and works
// with no connection at all; every request also refreshes the cache in the
// background for next time. Cross-origin requests (Supabase auth/rest calls)
// bypass the cache entirely — those must always hit the network live, never
// serve a stale/cached response.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  if (new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request, { cache: 'reload' })
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
