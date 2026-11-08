// Habsys offline worker. Bump CACHE when releasing a new version.
const CACHE = 'habsys-v2.1.0';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png'];

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
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET' || new URL(r.url).origin !== location.origin) return;
  e.respondWith(
    fetch(r).then(res => {
      if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(r, copy)); }
      return res;
    }).catch(() => caches.match(r, {ignoreSearch: true, cacheName: CACHE}).then(m => m || caches.match('index.html', {cacheName: CACHE})))
  );
});
