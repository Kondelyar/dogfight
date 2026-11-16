// Мінімальний service worker: робить гру встановлюваною (PWA) і кешує оболонку.
// Мережеву гру офлайн він не замінює: сокет і API завжди йдуть у мережу.
const CACHE = 'dogfight-shell-v1';
const NEVER_CACHE = ['/api/', '/ws', '/health', '/ready', '/metrics'];

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (NEVER_CACHE.some((p) => url.pathname.startsWith(p))) return;

  // спершу мережа (свіжа версія гри), кеш - запасний варіант, якщо мережі нема
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request).then((hit) => hit || Response.error())),
  );
});
