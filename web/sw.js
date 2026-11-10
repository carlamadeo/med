const CACHE = 'mis-estudios-shell-v1';
const SHELL = [
  './', './index.html', './styles.css', './app.js', './detect.js', './drive.js', './extract.js',
  './icon.svg', './types.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
  ));
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const sameOrigin = url.origin === self.location.origin;
  if (sameOrigin && SHELL.includes(url.pathname)) {
    event.respondWith(
      caches.match(event.request).then((response) => response || fetch(event.request))
    );
  } else {
    event.respondWith(fetch(event.request));
  }
});
