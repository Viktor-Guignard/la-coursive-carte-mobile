/* Service worker de l'app « Ma carte ».
   Rôle : rendre l'app installable et l'ouvrir même sans réseau.
   Réseau d'abord pour les fichiers de l'app (les mises à jour arrivent
   tout de suite), cache en secours. Les données de la carte (GitHub)
   ne passent jamais par ici. */
const CACHE = 'ma-carte-v3';
const SHELL = [
  './', 'index.html', 'styles.css', 'app.js', 'gh.js', 'manifest.webmanifest',
  'assets/logo-or.png', 'assets/icon-192.png', 'assets/icon-512.png', 'assets/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }))
  );
});
