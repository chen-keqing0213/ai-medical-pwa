// Service Worker - 离线缓存
const CACHE = 'mc-v1';
const ASSETS = ['/', '/index.html', '/manifest.json', '/js/audio-sender.js', '/js/audio-receiver.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
});

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});
