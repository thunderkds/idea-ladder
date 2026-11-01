// PWA shell for every page: service worker, offline banner, install prompt, sign-out cleanup.
(function () {
  var PAGES_CACHE = 'il-pages-v1';
  var OFFLINE_TEXT = 'You are offline. Your review ratings are saved on this device and sent when you are back online.';

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').catch(function () {});
    });
  }
  window.registerServiceWorker = registerServiceWorker;
  registerServiceWorker();

  var main = document.querySelector('main');

  // The first visit is not served by the worker yet, so keep this review page for the next offline load.
  if (location.pathname === '/review' && 'serviceWorker' in navigator && window.caches) {
    navigator.serviceWorker.ready
      .then(function () {
        return caches.open(PAGES_CACHE);
      })
      .then(function (cache) {
        return cache.match('/review').then(function (hit) {
          if (hit) return null;
          return fetch('/review').then(function (res) {
            if (res.status === 200 && !res.redirected) return cache.put('/review', res);
          });
        });
      })
      .catch(function () {});
  }

  // Offline banner: in the page flow, above the content, so it never covers a button.
  var banner = null;
  function syncBanner() {
    if (!main) return;
    if (!navigator.onLine && !banner) {
      banner = document.createElement('p');
      banner.className = 'offline-banner';
      banner.setAttribute('role', 'status');
      banner.textContent = OFFLINE_TEXT;
      main.insertBefore(banner, main.firstChild);
    } else if (navigator.onLine && banner) {
      banner.remove();
      banner = null;
    }
  }
  window.addEventListener('online', syncBanner);
  window.addEventListener('offline', syncBanner);
  syncBanner();

  // Install prompt: shown only after the learner finished a review session, never on first load.
  var deferred = null;
  var FLAG = 'il-first-session-done';
  var DISMISSED = 'il-install-dismissed';
  function storage(op, key, value) {
    try {
      return op === 'get' ? localStorage.getItem(key) : localStorage.setItem(key, value);
    } catch {
      return null;
    }
  }
  function showInstall() {
    if (!deferred || !main || document.getElementById('install-prompt')) return;
    if (!storage('get', FLAG) || storage('get', DISMISSED)) return;
    var box = document.createElement('section');
    box.id = 'install-prompt';
    box.className = 'install-prompt';
    box.setAttribute('aria-label', 'Install app');
    var text = document.createElement('p');
    text.textContent = 'Install Idea Ladder to review offline and get reminders.';
    var actions = document.createElement('div');
    actions.className = 'install-actions';
    var yes = document.createElement('button');
    yes.type = 'button';
    yes.className = 'button';
    yes.textContent = 'Install';
    yes.addEventListener('click', function () {
      var event = deferred;
      deferred = null;
      box.remove();
      event.prompt();
    });
    var no = document.createElement('button');
    no.type = 'button';
    no.className = 'button button-quiet';
    no.textContent = 'Not now';
    no.addEventListener('click', function () {
      storage('set', DISMISSED, '1');
      box.remove();
    });
    actions.appendChild(yes);
    actions.appendChild(no);
    box.appendChild(text);
    box.appendChild(actions);
    main.appendChild(box);
  }
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferred = e;
    showInstall();
  });
  document.addEventListener('il:session-finished', function () {
    storage('set', FLAG, '1');
    showInstall();
  });

  // Sign-out clears what this device cached for the learner: queued ratings are sent first when online.
  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!form || form.getAttribute('action') !== '/auth/sign-out') return;
    e.preventDefault();
    var clearing = [];
    if (window.ILStore) clearing.push(window.ILStore.clearAll(navigator.onLine));
    if (window.caches) clearing.push(caches.delete(PAGES_CACHE));
    Promise.all(clearing).catch(function () {}).then(function () {
      form.submit();
    });
  });
})();
