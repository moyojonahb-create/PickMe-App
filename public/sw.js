// Bump cache name to force clients to pick up fresh assets after updates
const CACHE_NAME = 'voyex-v9';
const TILE_CACHE = 'voyex-tiles-v1';
const STATIC_ASSETS = [
  '/',
  '/ride',
  '/manifest.json',
  '/favicon.ico',
  '/icons/pickme-app-icon.png',
];

// Map tile domains to cache for offline use
const TILE_DOMAINS = [
  'tile.openstreetmap.org',
  'maps.googleapis.com',
  'maps.gstatic.com',
  'khms0.googleapis.com',
  'khms1.googleapis.com',
];

const MAX_TILE_CACHE_SIZE = 500;

// Install event - cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[PickMe SW] Caching static assets');
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME && name !== TILE_CACHE)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// Push notification handler
self.addEventListener('push', (event) => {
  let data = { title: 'PickMe', body: 'You have a new notification', url: '/' };

  try {
    if (event.data) {
      const parsed = event.data.json();
      data = {
        title: parsed.title || data.title,
        body: parsed.body || data.body,
        url: parsed.url || data.url,
      };
    }
  } catch (e) {
    if (event.data) {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body,
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-96x96.png',
    image: data.image || undefined,
    vibrate: data.type === 'ride_request'
      ? [200, 100, 200, 100, 400]
      : [200, 100, 200],
    tag: data.tag || 'voyex-push-' + Date.now(),
    renotify: true,
    data: { url: data.url, rideId: data.rideId || null, type: data.type || 'general' },
    requireInteraction: data.type === 'ride_request',
    actions: data.type === 'ride_request'
      ? [
          { action: 'view', title: '🚗 View Ride' },
          { action: 'dismiss', title: 'Dismiss' },
        ]
      : [
          { action: 'open', title: 'Open' },
          { action: 'dismiss', title: 'Dismiss' },
        ],
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

// Notification click handler
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  const { url, rideId } = event.notification.data || {};
  let targetUrl = url || '/';

  if (event.action === 'view' && rideId) {
    targetUrl = `/ride-detail/${rideId}`;
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      return clients.openWindow(targetUrl);
    })
  );
});

// Helper: trim tile cache to max size
async function trimTileCache() {
  const cache = await caches.open(TILE_CACHE);
  const keys = await cache.keys();
  if (keys.length > MAX_TILE_CACHE_SIZE) {
    const toDelete = keys.slice(0, keys.length - MAX_TILE_CACHE_SIZE);
    await Promise.all(toDelete.map((k) => cache.delete(k)));
  }
}

// Fetch event - network first, fallback to cache; cache map tiles
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Cache map tiles (stale-while-revalidate)
  const isTile = TILE_DOMAINS.some((d) => url.hostname.includes(d));
  if (isTile) {
    event.respondWith(
      caches.open(TILE_CACHE).then(async (cache) => {
        const cached = await cache.match(event.request);
        const fetchPromise = fetch(event.request).then((response) => {
          if (response.ok) {
            cache.put(event.request, response.clone());
            trimTileCache();
          }
          return response;
        }).catch(() => cached || new Response('', { status: 503 }));

        return cached || fetchPromise;
      })
    );
    return;
  }

  // Skip non-origin, API, OAuth, dev assets
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api')) return;
  if (url.pathname.startsWith('/~oauth')) return;
  if (
    url.pathname.startsWith('/src/') ||
    url.pathname.startsWith('/node_modules/') ||
    url.pathname.startsWith('/@vite/') ||
    url.pathname.startsWith('/@react-refresh')
  ) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const responseClone = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseClone);
        });
        return response;
      })
      .catch(() => {
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) return cachedResponse;
          if (event.request.mode === 'navigate') return caches.match('/');
          return new Response('Offline', { status: 503 });
        });
      })
  );
});

// Sync event — process queued offline ride requests
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-rides') {
    event.waitUntil(syncPendingRides());
  }
});

async function syncPendingRides() {
  const allClients = await clients.matchAll({ type: 'window' });
  for (const client of allClients) {
    client.postMessage({ type: 'SYNC_OFFLINE_RIDES' });
  }
}
