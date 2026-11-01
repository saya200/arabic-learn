importScripts('sw-manifest.js');
const CACHE = 'arlearn-' + self.VERSION;

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(self.PRECACHE.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k.startsWith('arlearn-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// كلمات: الشبكة أولاً (عشان تصحيحات سالم توصل)، وإذا ما فيه نت نستخدم المحفوظ. الباقي: المحفوظ أولاً.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.endsWith('/data/words.json')) {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 3000);
        const res = await fetch(req, { signal: ctl.signal, cache: 'no-cache' });
        clearTimeout(t);
        if (res.ok) cache.put(req, res.clone());
        return res;
      } catch (_) {
        return (await cache.match(req, { ignoreSearch: true })) || Response.error();
      }
    })());
    return;
  }
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch (_) {
      if (req.mode === 'navigate') return (await cache.match('index.html')) || Response.error();
      return Response.error();
    }
  })());
});
