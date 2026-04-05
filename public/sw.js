const CACHE_NAME = 'lovesync-offline-v1';
const OFFLINE_URLS = [
  '/home',
  '/chat',
  '/discover',
  '/insights',
  'https://cdn.tailwindcss.com',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('📦 PWA: Pre-caching offline pages...');
      return cache.addAll(OFFLINE_URLS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Only handle GET requests
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((response) => {
      // Return cached version if found
      if (response) return response;

      // Otherwise try network
      return fetch(event.request).then((networkResponse) => {
        // Don't cache API or Socket calls
        if (!event.request.url.includes('/api/') && !event.request.url.includes('socket.io')) {
          return caches.open(CACHE_NAME).then((cache) => {
             cache.put(event.request, networkResponse.clone());
             return networkResponse;
          });
        }
        return networkResponse;
      }).catch(() => {
        // Fallback for key pages if network fails & not in cache
        if (event.request.mode === 'navigate') {
          return caches.match('/home');
        }
      });
    })
  );
});
