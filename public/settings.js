// Settings screen: push reminders, progress import. Export is a plain form that downloads a file.
(function () {
  var section = document.getElementById('reminders');
  if (!section) return;
  var MAX_IMPORT_BYTES = 5 * 1024 * 1024;
  var vapidKey = section.dataset.vapidPublicKey || '';
  var hourEl = document.getElementById('reminder-hour');
  var onBtn = document.getElementById('reminders-on');
  var offBtn = document.getElementById('reminders-off');
  var statusEl = document.getElementById('reminders-status');
  var HOUR_KEY = 'il-reminder-hour';

  function timezone() {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  }

  function post(path, body) {
    return fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  }

  function keyBytes(base64url) {
    var pad = '='.repeat((4 - (base64url.length % 4)) % 4);
    var raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
    return out;
  }

  function hourLabel(h) {
    return (Number(h) < 10 ? '0' : '') + h + ':00';
  }

  function setState(subscribed, message) {
    onBtn.disabled = subscribed;
    offBtn.disabled = !subscribed;
    statusEl.textContent = message;
  }

  function unavailable(message) {
    onBtn.disabled = true;
    offBtn.disabled = true;
    hourEl.disabled = true;
    statusEl.textContent = message;
  }

  function currentSubscription() {
    return navigator.serviceWorker.ready.then(function (reg) {
      return reg.pushManager.getSubscription();
    });
  }

  function save(sub) {
    var hour = Number(hourEl.value);
    return post('/api/push/subscribe', { subscription: sub.toJSON(), reminderHour: hour, timezone: timezone() }).then(function (res) {
      if (!res.ok) throw new Error('subscribe-' + res.status);
      try { localStorage.setItem(HOUR_KEY, String(hour)); } catch { /* storage may be off */ }
    });
  }

  function turnOn() {
    onBtn.disabled = true;
    Notification.requestPermission()
      .then(function (permission) {
        if (permission !== 'granted') {
          unavailable('Reminders blocked in browser settings');
          return null;
        }
        return navigator.serviceWorker.ready
          .then(function (reg) {
            return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(vapidKey) });
          })
          .then(function (sub) {
            return save(sub).then(function () {
              setState(true, 'Reminders are on at ' + hourLabel(hourEl.value) + ' (' + timezone() + ').');
            });
          });
      })
      .catch(function () {
        onBtn.disabled = false;
        statusEl.textContent = 'Reminders could not be turned on. Try again.';
      });
  }

  function turnOff() {
    offBtn.disabled = true;
    currentSubscription()
      .then(function (sub) {
        if (!sub) return null;
        return post('/api/push/unsubscribe', { endpoint: sub.endpoint }).then(function () {
          return sub.unsubscribe();
        });
      })
      .then(function () {
        setState(false, 'Reminders are off.');
      })
      .catch(function () {
        offBtn.disabled = false;
        statusEl.textContent = 'Reminders could not be turned off. Try again.';
      });
  }

  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    unavailable('Reminders need a browser with push support. On iPhone and iPad, add this app to your Home Screen first (iOS 16.4 or later), then open it from there.');
  } else if (!vapidKey) {
    unavailable('Reminders are not set up on this server yet.');
  } else if (Notification.permission === 'denied') {
    unavailable('Reminders blocked in browser settings');
  } else {
    onBtn.addEventListener('click', turnOn);
    offBtn.addEventListener('click', turnOff);
    setState(false, 'Reminders are off.');
    try {
      var saved = localStorage.getItem(HOUR_KEY);
      if (saved) hourEl.value = saved;
    } catch { /* storage may be off */ }
    currentSubscription()
      .then(function (sub) {
        if (!sub) return;
        // Opening settings refreshes the stored timezone (the learner may have travelled).
        return save(sub).then(function () {
          setState(true, 'Reminders are on at ' + hourLabel(hourEl.value) + ' (' + timezone() + ').');
        });
      })
      .catch(function () {});
  }

  var fileEl = document.getElementById('import-file');
  var importBtn = document.getElementById('import-button');
  var importStatus = document.getElementById('import-status');
  var importError = document.getElementById('import-error');

  importBtn.addEventListener('click', function () {
    importStatus.textContent = '';
    importError.textContent = '';
    var file = fileEl.files && fileEl.files[0];
    if (!file) {
      importError.textContent = 'Choose a progress file first.';
      return;
    }
    if (file.size > MAX_IMPORT_BYTES) {
      importError.textContent = 'This file is larger than 5 MB, so it was not read.';
      return;
    }
    importBtn.disabled = true;
    file
      .text()
      .then(function (text) {
        return fetch('/api/progress/import', { method: 'POST', headers: { 'content-type': 'application/json' }, body: text });
      })
      .then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) {
            importError.textContent = data.message || 'The file could not be imported. Nothing was imported.';
            return;
          }
          importStatus.textContent =
            'Imported: ' + data.cardStatesUpdated + ' card states updated, ' + data.logRowsAdded + ' review log rows added.';
        });
      })
      .catch(function () {
        importError.textContent = 'The file could not be imported. Nothing was imported.';
      })
      .then(function () {
        importBtn.disabled = false;
      });
  });
})();
