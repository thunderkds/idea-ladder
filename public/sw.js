// Service worker. Caches the app shell and the last daily-review page so review works offline.
// Ratings are not queued here: the page queues them in IndexedDB (public/offline-store.js).
// A new version waits until the old one's pages close (no skipWaiting), so a learner offline mid-session is not interrupted.
var SHELL = 'il-shell-v1';
var PAGES = 'il-pages-v1';
var PRECACHE = [
  '/offline',
  '/manifest.webmanifest',
  '/assets/tokens.css',
  '/assets/app.css',
  '/assets/pwa.js',
  '/assets/offline-store.js',
  '/assets/fsrs-client.js',
  '/assets/vendor/ts-fsrs.js',
  '/assets/review.js',
  '/assets/icon-192.png',
  '/assets/icon-512.png',
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(SHELL).then(function (cache) {
      return cache.addAll(
        PRECACHE.map(function (url) {
          return new Request(url, { cache: 'reload' });
        }),
      );
    }),
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (keys) {
        return Promise.all(
          keys
            .filter(function (k) {
              return k !== SHELL && k !== PAGES;
            })
            .map(function (k) {
              return caches.delete(k);
            }),
        );
      })
      .then(function () {
        return self.clients.claim();
      }),
  );
});

function isShellAsset(url) {
  return url.pathname.indexOf('/assets/') === 0 || url.pathname === '/manifest.webmanifest';
}

// Network first, so a deploy is seen at once when online; the cached copy serves when offline.
function shellAsset(request) {
  return fetch(request).then(
    function (res) {
      if (res.ok) {
        var copy = res.clone();
        caches.open(SHELL).then(function (c) { return c.put(request, copy); });
      }
      return res;
    },
    function () {
      return caches.match(request, { cacheName: SHELL }).then(function (hit) {
        return hit || Response.error();
      });
    },
  );
}

function offlinePage() {
  return caches.match('/offline', { cacheName: SHELL }).then(function (hit) {
    return hit || Response.error();
  });
}

function navigation(request, url) {
  var isReview = url.pathname === '/review';
  return fetch(request).then(
    function (res) {
      if (isReview) {
        // Keep the last good review page. A redirect (signed out) removes it.
        if (res.status === 200 && res.type === 'basic') {
          var copy = res.clone();
          caches.open(PAGES).then(function (c) { return c.put('/review', copy); });
        } else {
          caches.open(PAGES).then(function (c) { return c.delete('/review'); });
        }
      }
      return res;
    },
    function () {
      if (!isReview) return offlinePage();
      return caches.open(PAGES).then(function (c) {
        return c.match('/review');
      }).then(function (hit) {
        return hit || offlinePage();
      });
    },
  );
}

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;
  var url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(navigation(request, url));
  } else if (isShellAsset(url)) {
    event.respondWith(shellAsset(request));
  }
});

self.addEventListener('push', function (event) {
  var data = { title: 'Cards are due', body: 'Your daily review is ready.', url: '/review' };
  try {
    if (event.data) data = Object.assign(data, event.data.json());
  } catch {
    // keep the defaults
  }
  event.waitUntil(
    self.registration.showNotification(data.title, { body: data.body, icon: '/assets/icon-192.png', data: { url: data.url } }),
  );
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var target = (event.notification.data && event.notification.data.url) || '/review';
  event.waitUntil(self.clients.openWindow(target));
});
