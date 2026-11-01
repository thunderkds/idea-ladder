// Daily review screen. The server owns the schedule: this file shows cards, times the session and sends ratings.
(function () {
  var root = document.getElementById('review');
  if (!root) return;
  var SESSION_MS = Number(root.dataset.sessionSeconds || '300') * 1000;
  var RATINGS = [
    { value: 1, label: 'Again' },
    { value: 2, label: 'Hard' },
    { value: 3, label: 'Good' },
    { value: 4, label: 'Easy' },
  ];

  var queue = [];
  var index = 0;
  var reviewed = 0;
  var startedAt = null;
  var capped = false;
  var ticker = null;
  var timerEl = null;
  var learnerId = root.dataset.learnerId;
  var store = window.ILStore && learnerId ? window.ILStore.create(learnerId) : null;
  var offlineMode = false; // true while the queue comes from this device's cache
  var syncEl = document.getElementById('sync-status');
  var card = null; // { key, shownAt, elapsedMs, answerShown, inFlight, backEl, ratingsEl, showBtn, errorEl }

  function el(tag, text, className) {
    var node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function clear() {
    card = null;
    while (root.firstChild) root.removeChild(root.firstChild);
    if (timerEl) root.appendChild(timerEl);
  }

  function formatLeft(ms) {
    var total = Math.max(0, Math.ceil(ms / 1000));
    var s = total % 60;
    return Math.floor(total / 60) + ':' + (s < 10 ? '0' : '') + s;
  }

  function renderTimer() {
    if (!timerEl) return;
    var left = startedAt === null ? SESSION_MS : SESSION_MS - (Date.now() - startedAt);
    timerEl.textContent = 'Time left ' + formatLeft(left);
  }

  function startTimer() {
    startedAt = Date.now();
    ticker = setInterval(function () {
      renderTimer();
      if (Date.now() - startedAt >= SESSION_MS) {
        capped = true;
        clearInterval(ticker);
        ticker = null;
      }
    }, 1000);
  }

  function fetchQueue() {
    return fetch('/api/review/queue', { headers: { accept: 'application/json' } }).then(function (res) {
      if (res.status === 401) {
        window.location.assign('/');
        throw new Error('unauthenticated');
      }
      if (!res.ok) throw new Error('queue-' + res.status);
      return res.json();
    });
  }

  function noop() {}

  function updateSyncStatus() {
    if (!store || !syncEl) return Promise.resolve();
    return store.pending().then(function (items) {
      syncEl.textContent = items.length === 0 ? '' : items.length + (items.length === 1 ? ' rating is' : ' ratings are') + ' waiting to sync';
    }, noop);
  }

  // Sends ratings queued on this device. The server recomputes each state and stays the source of truth.
  function syncNow() {
    if (!store || !navigator.onLine) return Promise.resolve();
    return store.flush().then(updateSyncStatus, updateSyncStatus);
  }

  // Keeps the next 7 days of due cards on this device. Skipped while ratings are still waiting to sync.
  function refreshPack() {
    if (!store) return;
    store
      .pending()
      .then(function (items) {
        if (items.length > 0) return null;
        return fetch('/api/review/offline-pack', { headers: { accept: 'application/json' } })
          .then(function (res) {
            return res.ok ? res.json() : null;
          })
          .then(function (pack) {
            if (pack && pack.learnerId === learnerId) return store.savePack(pack);
          });
      })
      .catch(noop);
  }

  function formatLocal(iso) {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  function renderEmpty(data) {
    clear();
    if (!data.hasCards) {
      root.appendChild(el('h2', 'No cards yet'));
      root.appendChild(el('p', 'Cards appear here once a ladder you started has cards in an open level.', 'muted'));
      return;
    }
    root.appendChild(el('h2', 'Nothing due'));
    if (data.nextDue) root.appendChild(el('p', 'Next due: ' + formatLocal(data.nextDue)));
  }

  function finish() {
    if (ticker) {
      clearInterval(ticker);
      ticker = null;
    }
    clear();
    if (reviewed > 0) document.dispatchEvent(new CustomEvent('il:session-finished'));
    if (navigator.onLine) syncNow().then(refreshPack);
    root.appendChild(el('h2', 'Session finished'));
    root.appendChild(el('p', 'You rated ' + reviewed + (reviewed === 1 ? ' card.' : ' cards.')));
    var more = el('p');
    root.appendChild(more);
    more.textContent = capped ? 'Time is up. Cards you did not rate stay due for the next session.' : 'Nothing else is due now.';
    fetchQueue()
      .then(function (data) {
        if (data.nextDue) root.appendChild(el('p', 'Next due: ' + formatLocal(data.nextDue)));
      })
      .catch(function () {});
  }

  function next() {
    // Check the clock here too: a background tab delays the timer callback.
    if (startedAt !== null && Date.now() - startedAt >= SESSION_MS) capped = true;
    if (index >= queue.length || capped) finish();
    else showCard();
  }

  function setError(message, retry) {
    if (!card) return;
    while (card.errorEl.firstChild) card.errorEl.removeChild(card.errorEl.firstChild);
    if (!message) return;
    card.errorEl.appendChild(el('p', message, 'review-error'));
    var btn = el('button', 'Retry', 'button button-quiet');
    btn.type = 'button';
    btn.addEventListener('click', retry);
    card.errorEl.appendChild(btn);
  }

  // Offline: apply the rating to the local state and queue it with its idempotency key and the time on this device.
  function queueLocally(current, value, state) {
    store
      .enqueue({ cardId: current.id, rating: value, idempotencyKey: state.key, elapsedMs: state.elapsedMs, reviewedAt: new Date().toISOString() })
      .then(function () {
        reviewed += 1;
        index += 1;
        updateSyncStatus();
        next();
      })
      .catch(function () {
        state.inFlight = false;
        setError('The rating could not be saved on this device. Try again.', function () {
          rate(value);
        });
      });
  }

  function rate(value) {
    if (!card || !card.answerShown || card.inFlight) return;
    var current = queue[index];
    var state = card;
    if (state.elapsedMs === null) state.elapsedMs = Math.min(Date.now() - state.shownAt, 3600000);
    state.inFlight = true;
    setError('');
    if (store && (offlineMode || !navigator.onLine)) {
      queueLocally(current, value, state);
      return;
    }
    fetch('/api/review/rating', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cardId: current.id, rating: value, idempotencyKey: state.key, elapsedMs: state.elapsedMs }),
    })
      .then(function (res) {
        if (!res.ok) throw new Error('rating-' + res.status);
        return res.json().catch(function () { return null; }).then(function (data) {
          // The device copy of the card follows the server state.
          if (store && data && data.card) store.applyServerState(current.id, data.card).catch(noop);
          reviewed += 1;
          index += 1;
          next();
        });
      })
      .catch(function () {
        if (store && !navigator.onLine) {
          queueLocally(current, value, state);
          return;
        }
        state.inFlight = false;
        setError('The rating was not saved. Try again.', function () {
          rate(value);
        });
      });
  }

  function reveal() {
    if (!card || card.answerShown) return;
    card.answerShown = true;
    card.backEl.hidden = false;
    card.ratingsEl.hidden = false;
    card.showBtn.hidden = true;
    card.backEl.focus();
  }

  function showCard() {
    var current = queue[index];
    if (startedAt === null) startTimer();
    clear();
    var section = el('section', undefined, 'review-card');
    section.setAttribute('aria-label', 'Review card');
    section.appendChild(el('p', current.repoFullName + ' · ' + current.levelId, 'review-meta'));
    section.appendChild(el('p', current.front, 'wrap'));
    var back = el('p', current.back, 'review-back wrap');
    back.hidden = true;
    back.tabIndex = -1;
    section.appendChild(back);
    var showBtn = el('button', 'Show answer', 'button');
    showBtn.type = 'button';
    showBtn.setAttribute('aria-keyshortcuts', 'Space');
    showBtn.addEventListener('click', reveal);
    section.appendChild(showBtn);
    var ratingsEl = el('div', undefined, 'review-ratings');
    ratingsEl.hidden = true;
    RATINGS.forEach(function (r) {
      var btn = el('button', r.label, 'button button-quiet');
      btn.type = 'button';
      btn.setAttribute('aria-keyshortcuts', String(r.value));
      btn.addEventListener('click', function () {
        rate(r.value);
      });
      ratingsEl.appendChild(btn);
    });
    section.appendChild(ratingsEl);
    var errorEl = el('div');
    errorEl.setAttribute('role', 'alert');
    section.appendChild(errorEl);
    root.appendChild(section);
    card = {
      key: crypto.randomUUID(),
      shownAt: Date.now(),
      elapsedMs: null,
      answerShown: false,
      inFlight: false,
      backEl: back,
      ratingsEl: ratingsEl,
      showBtn: showBtn,
      errorEl: errorEl,
    };
    showBtn.focus();
  }

  document.addEventListener('keydown', function (e) {
    if (!card || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === ' ' && !card.answerShown) {
      e.preventDefault();
      reveal();
    } else if (e.key >= '1' && e.key <= '4') {
      rate(Number(e.key));
    }
  });

  function start(data) {
    queue = data.cards;
    index = 0;
    timerEl = el('p', undefined, 'review-timer');
    timerEl.setAttribute('role', 'timer');
    renderTimer();
    if (queue.length === 0) {
      timerEl = null;
      renderEmpty(data);
    } else {
      clear();
      showCard();
    }
  }

  // No connection: review from the cards cached at the last online visit.
  function loadOffline() {
    store
      .readPack(new Date())
      .then(function (pack) {
        offlineMode = true;
        if (!pack) {
          clear();
          root.appendChild(el('p', 'No cards are saved on this device yet. Connect once to download them.', 'review-error'));
          return;
        }
        start(pack);
      })
      .catch(function () {
        clear();
        root.appendChild(el('p', 'Your cards could not be loaded.', 'review-error'));
      });
  }

  function load() {
    syncNow()
      .then(fetchQueue)
      .then(function (data) {
        offlineMode = false;
        start(data);
        refreshPack();
      })
      .catch(function (err) {
        if (err && err.message === 'unauthenticated') return;
        if (store && (!navigator.onLine || err instanceof TypeError)) {
          loadOffline();
          return;
        }
        clear();
        root.appendChild(el('p', 'Your cards could not be loaded.', 'review-error'));
        var btn = el('button', 'Retry', 'button button-quiet');
        btn.type = 'button';
        btn.addEventListener('click', load);
        root.appendChild(btn);
      });
  }

  window.addEventListener('online', function () {
    offlineMode = false;
    syncNow();
  });
  updateSyncStatus();
  load();
})();
