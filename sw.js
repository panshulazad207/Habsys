// Habsys offline worker. Bump CACHE when releasing a new version.
const CACHE = 'habsys-v3.3.0';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png'];
const NET_WAIT = 4000;   // 2.2.0: on a weak connection, give the network 4 seconds, then open the saved copy instead of hanging

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  // Only old app-shell caches (habsys-v...) are removed. The 'habsys-data' cache holds a protected copy of the
  // user's progress and must NEVER be deleted here.
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('habsys-v') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
// Network first (so updates arrive), cache as the offline fallback.
// 2.5.0: requests to other websites (the Friends cards on Firebase) are never touched by this worker: they go straight to the network.
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET' || new URL(r.url).origin !== location.origin) return;
  const fromCache = () => caches.match(r, {ignoreSearch: true, cacheName: CACHE}).then(m => m || caches.match('index.html', {cacheName: CACHE}));
  const net = fetch(r).then(res => {
    if (res && res.ok) { const copy = res.clone(); e.waitUntil(caches.open(CACHE).then(c => c.put(r, copy)).catch(() => {})); }
    return res;
  });
  e.waitUntil(net.catch(() => {}));   // 2.9.9: a slow request that loses the 4-second race still finishes and refreshes the saved copy, and its failure is never left unhandled
  const timer = new Promise(resolve => setTimeout(() => resolve(null), NET_WAIT));
  e.respondWith(
    Promise.race([net, timer.then(() => fromCache().then(m => m || net))])
      .catch(() => fromCache())
  );
});

// 2.8.0: evening reminder. The sender (GitHub Actions) pushes {title, body, left}; this worker shows it.
// A push must ALWAYS show a notification (iPadOS stops delivering to apps that receive silent pushes), so a bad or empty message still shows a default one.
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = {}; }
  const title = (typeof d.title === 'string' && d.title) || 'Habsys';
  const body = (typeof d.body === 'string' && d.body) || 'Your day is still open. One small step keeps the chain alive.';
  const left = Number(d.left);
  e.waitUntil(Promise.all([
    self.registration.showNotification(title, {body: body, icon: 'icon-192.png', tag: 'habsys-day', renotify: false, data: {url: './'}}),
    // the number of habits left shows on the Home Screen icon until the app is opened (the app clears it)
    (async () => { try { if (self.navigator && self.navigator.setAppBadge && left > 0) await self.navigator.setAppBadge(left); } catch (err) {} })()
  ]));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({type: 'window', includeUncontrolled: true}).then(list => {
      for (const c of list) { if ('focus' in c) return c.focus(); }
      return self.clients.openWindow('./');
    })
  );
});
