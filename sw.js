// Service Worker: speichert die App-Dateien, damit sie offline startet.
// Bei jeder Änderung an den Dateien VERSION erhöhen, damit Geräte das Update laden.
const VERSION = 'v17';
const CACHE = 'vereinsorga-' + VERSION;
const FILES = [
  './', 'index.html', 'styles.css', 'db.js', 'import.js', 'firebase.js', 'auth.js', 'sync.js', 'calendar.js', 'bayairn.js', 'app.js',
  'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png',
];

// cache: 'reload' holt jede Datei frisch vom Server – nicht aus dem Browser-Zwischenspeicher
// (GitHub Pages lässt Dateien sonst bis zu 10 Minuten zwischenspeichern).
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Erst Cache (schnell + offline), im Hintergrund aktualisieren.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(async cache => {
      const cached = await cache.match(e.request, { ignoreSearch: true });
      const network = fetch(e.request, { cache: 'no-cache' }) // beim Server nachfragen, ob es Neues gibt
        .then(res => { if (res.ok) cache.put(e.request, res.clone()); return res; })
        .catch(() => cached);
      return cached || network;
    })
  );
});
