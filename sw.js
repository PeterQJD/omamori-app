// Service worker: keeps a copy of the app's files so it works offline.
// The cache name includes APP_VERSION, so bumping the version in version.js
// installs a fresh copy and removes the old one.
importScripts('version.js');

const CACHE = 'omamori-' + self.APP_VERSION;
const FILES = [
  './',
  'index.html',
  'styles.css',
  'version.js',
  'db.js',
  'images.js',
  'app.js',
  'manifest.webmanifest',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      // cache: 'reload' skips the browser's HTTP cache so we get the newest files
      .then(cache => cache.addAll(FILES.map(url => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('omamori-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;

  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(cached => {
      if (cached) return cached;
      if (req.mode === 'navigate') return caches.match('index.html');
      return fetch(req);
    })
  );
});
