const CACHE_NAME = 'dinkly-shell-v3';
const APP_SHELL = [
  '/',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png',
  '/icons/favicon-32.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => (
      Promise.allSettled(APP_SHELL.map((url) => cache.add(url)))
    ))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys
        .filter((key) => key !== CACHE_NAME)
        .map((key) => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }

  const requestUrl = new URL(event.request.url);
  const isSameOrigin = requestUrl.origin === self.location.origin;

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(async () => {
        const cache = await caches.open(CACHE_NAME);
        return cache.match('/') || Response.error();
      })
    );
    return;
  }

  if (!isSameOrigin) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then(async (cached) => {
      if (cached) {
        event.waitUntil(
          fetch(event.request)
            .then(async (response) => {
              if (!response || response.status !== 200) return;
              const cache = await caches.open(CACHE_NAME);
              await cache.put(event.request, response.clone());
            })
            .catch(() => undefined)
        );
        return cached;
      }

      const response = await fetch(event.request);
      if (!response || response.status !== 200) {
        return response;
      }
      const cache = await caches.open(CACHE_NAME);
      cache.put(event.request, response.clone());
      return response;
    })
  );
});
