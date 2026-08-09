// Who's The Most, service worker. Caches only the static app shell (HTML/CSS/JS/icons/manifest)
// so a repeat visit loads instantly and the PWA install check passes. Never touches the
// WebSocket connection (a service worker cannot intercept ws:// anyway) and never claims the
// game works offline, it structurally can't: real-time voting needs the live server.
const CACHE_NAME = 'whosmost-shell-v1';
const SHELL_FILES = ['/', '/style.css', '/script.js', '/manifest.json', '/assets/icon-192.png', '/assets/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin) return;
  // Network-first for the shell files (so a real code update is picked up on the next visit
  // that has connectivity), falling back to the cached copy only when the network fails.
  if (SHELL_FILES.includes(url.pathname)) {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return res;
        })
        .catch(() => caches.match(event.request))
    );
  }
});
