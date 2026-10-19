// vissointan service worker (spec 2026-10-19 §8).
//
// What it does:
//   - caches the app shell only: the content-hashed bundle under /assets/ and
//     the offline page. These are code, not plant data.
//   - shows push notifications and opens the app when one is tapped.
// What it never does:
//   - touch /api/*, /ws, the Keycloak realm or anything not same-origin GET.
//     Those requests are not intercepted at all, so nothing about the plant is
//     ever stored on the device by this worker.
//   - show an old page as if it were current: a navigation with no network gets
//     the offline page, not a cached copy of the app with stale numbers.

const SHELL = 'wds-shell-v1';
const OFFLINE = '/offline.html';
const PRECACHE = [OFFLINE, '/logo-192.png', '/logo-64.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // hashed, immutable build output: cache-first
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.open(SHELL).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  // page loads: always the network; offline page when there is none
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.open(SHELL).then((c) => c.match(OFFLINE))),
    );
  }
  // everything else (api, ws, realms, camera frames, ...) is left to the browser
});

// ── push ───────────────────────────────────────────────────────────────────

self.addEventListener('push', (event) => {
  let msg = {};
  try { msg = event.data ? event.data.json() : {}; } catch { /* plain-text or empty push */ }
  const title = typeof msg.title === 'string' ? msg.title : 'Alarm';
  const options = {
    body: typeof msg.body === 'string' ? msg.body : '',
    icon: '/logo-192.png',
    badge: '/logo-64.png',
    tag: typeof msg.tag === 'string' ? msg.tag : undefined,
    renotify: !!msg.tag,
    requireInteraction: msg.kind === 'raised' || msg.kind === 'escalation',
    data: { url: typeof msg.url === 'string' && msg.url.startsWith('/') ? msg.url : '/alarms' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/alarms', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (new URL(w.url).origin === self.location.origin && 'focus' in w) {
          return w.focus().then((c) => (c && 'navigate' in c ? c.navigate(target) : c));
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});

// the page asks for a wipe on sign-out
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'CLEAR') {
    event.waitUntil(caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))));
  }
});
