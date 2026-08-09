// Who's The Most, service worker. Caches only the static app shell (HTML/CSS/JS/icons/manifest)
// so a repeat visit loads instantly and the PWA install check passes. Never touches the
// WebSocket connection (a service worker cannot intercept ws:// anyway) and never claims the
// game works offline, it structurally can't: real-time voting needs the live server.
// v2: fixes a real bug found live (2026-08-09) — the fetch handler below used to cache ANY
// response including a 404/500, so a transient server error got permanently served from cache
// afterward even once the server was healthy again. The version bump also flushes that
// already-poisoned v1 cache via the activate handler's cleanup below.
const CACHE_NAME = 'whosmost-shell-v2';
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
          // Only cache a genuinely good response. Caching a transient 404/500 here was the
          // real bug: it made a server hiccup stick around forever, served from cache, even
          // after the origin was healthy again.
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return res;
        })
        .catch(() => caches.match(event.request))
    );
  }
});
