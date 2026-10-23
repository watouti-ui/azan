/* Offline cache for the Azan app. Bump CACHE when files change. */
const CACHE = 'azan-v2.2.0';
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

// How long the network gets before a cached copy is served instead. A dead
// connection never makes fetch() reject - it just hangs - so without this the
// app waits on the browser's own timeout and appears frozen on one bar of
// signal, even with everything already cached. Full offline was always fine;
// this is for the case between.
const NET_TIMEOUT_MS = 1500;

// The static shell never changes without the cache name changing with it, so a
// cached copy is always the right copy for this load: serve it immediately and
// refresh it in the background. A new deploy still lands promptly, because that
// path is the worker update (updateViaCache:'none' + controllerchange reload),
// not per-asset revalidation. Three assets fetched network-first in sequence
// cost three timeouts on a dead connection; this makes the shell cost nothing.
const SHELL = ['/', '/index.html', '/app.js', '/manifest.webmanifest',
               '/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-512.png'];

function isShell(url) {
  const path = new URL(url).pathname;
  return SHELL.some(suffix => path === suffix || path.endsWith(suffix));
}

// Network-first so updates land, with a timeout so a hanging connection can
// never delay startup by more than NET_TIMEOUT_MS. A late network response
// still refreshes the cache for next time.
async function respond(event) {
  const req = event.request;
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req);

  const network = fetch(req).then(res => {
    // Only store successes: a cached 404 would outlive the thing that caused it.
    if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
    return res;
  });

  if (!cached) {
    // Nothing saved for this request, so the network is the only option.
    try {
      const res = await network;
      if (res) return res;
    } catch (e) {}
    // Only a page navigation falls back to the shell. Handing index.html to a
    // request for timetable.json would fail later, as a JSON parse error.
    if (req.mode === 'navigate') {
      const shell = await cache.match('./index.html');
      if (shell) return shell;
    }
    return new Response('', { status: 504, statusText: 'Offline' });
  }

  // Static shell: answer from cache at once, refresh for next time.
  if (isShell(req.url)) {
    event.waitUntil(network.catch(() => {}));
    return cached;
  }

  // Everything else - data above all - still prefers the network, so a
  // corrected timetable lands on this load rather than the next one. The
  // timeout is what stops a hanging connection turning that into a stall.
  const raced = await Promise.race([
    network.catch(() => null),
    new Promise(resolve => setTimeout(() => resolve(null), NET_TIMEOUT_MS))
  ]);
  if (raced && raced.ok) return raced;

  // Keep the worker alive long enough for a slow response to refresh the cache.
  event.waitUntil(network.catch(() => {}));
  return cached;
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(respond(event));
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
