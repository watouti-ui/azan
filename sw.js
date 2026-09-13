/* Offline cache for the Azan app. Bump CACHE when files change. */
const CACHE = 'azan-v2.0.0';
const ASSETS = [
  './',
  './index.html',
  './app.js',
  './manifest.webmanifest',
  './data/timetable.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first for the app shell so updates land, cache as the offline fallback.
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(req)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(cache => cache.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then(hit => hit || caches.match('./index.html')))
  );
});


// ---------------------------------------------------------------- push -----
// Delivered by a push service, so it works with the page closed. Without a
// backend sending them nothing arrives here; the handler is the app side of
// that contract and is used by the test push too.
self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch (e) {
    payload = { title: 'Prayer time', body: event.data ? event.data.text() : '' };
  }
  const title = payload.title || 'Prayer time';
  event.waitUntil(self.registration.showNotification(title, {
    body: payload.body || '',
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    tag: payload.tag || 'azan',
    renotify: true,
    timestamp: payload.at || Date.now(),
    data: { url: payload.url || './index.html', key: payload.key || null, at: payload.at || null }
  }));
});

// A subscription can be rotated by the browser; tell every open page so it can
// be registered again.
self.addEventListener('pushsubscriptionchange', event => {
  event.waitUntil(self.clients.matchAll({ includeUncontrolled: true })
    .then(list => list.forEach(c => c.postMessage({ type: 'pushsubscriptionchange' }))));
});

// Lets a page ask the worker to raise a notification, which is the path that
// works on iOS where page-created Notification objects are unavailable.
self.addEventListener('message', event => {
  const d = event.data || {};
  if (d.type !== 'show-notification') return;
  event.waitUntil(self.registration.showNotification(d.title || 'Prayer time', {
    body: d.body || '', icon: './icons/icon-192.png', badge: './icons/icon-192.png',
    tag: d.tag || 'azan', renotify: true, data: { url: './index.html' }
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) if ('focus' in client) return client.focus();
      const url = (event.notification.data && event.notification.data.url) || './index.html';
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
