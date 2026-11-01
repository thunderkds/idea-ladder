// Offline cache and rating queue in IndexedDB, one database per learner (name "il-<learnerId>").
// stores: cards (due-card pack with FSRS states), ratings (queue, oldest first), meta.
// The schema upgrade only adds missing stores, so a queued rating survives an app update.
(function (root) {
  var PREFIX = 'il-';
  var VERSION = 1;
  var flushing = null;

  function openDb(name) {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(name, VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains('cards')) db.createObjectStore('cards', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('ratings')) db.createObjectStore('ratings', { keyPath: 'seq', autoIncrement: true });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      };
      req.onsuccess = function () {
        // Lets a sign-out in another tab delete this database.
        req.result.onversionchange = function () {
          req.result.close();
        };
        resolve(req.result);
      };
      req.onerror = function () {
        reject(req.error);
      };
    });
  }

  function create(learnerId) {
    var dbp = null;
    function db() {
      if (!dbp) dbp = openDb(PREFIX + learnerId);
      return dbp;
    }
    // fn(tx) may return a function; its value (read when the transaction completes) is the result.
    function run(names, mode, fn) {
      return db().then(function (d) {
        return new Promise(function (resolve, reject) {
          var tx = d.transaction(names, mode);
          var read = fn(tx);
          tx.oncomplete = function () {
            resolve(typeof read === 'function' ? read() : undefined);
          };
          tx.onerror = tx.onabort = function () {
            reject(tx.error);
          };
        });
      });
    }

    var api = {
      savePack: function (pack) {
        return run(['cards', 'meta'], 'readwrite', function (tx) {
          var cards = tx.objectStore('cards');
          cards.clear();
          pack.cards.forEach(function (c) {
            cards.put(c);
          });
          tx.objectStore('meta').put({ key: 'pack', fetchedAt: pack.fetchedAt, nextDue: pack.nextDue, hasCards: pack.hasCards });
        });
      },
      // The cards to review at `now`: new cards and cards whose local due time has come, oldest due first. null without a pack.
      readPack: function (now) {
        return run(['cards', 'meta'], 'readonly', function (tx) {
          var all = tx.objectStore('cards').getAll();
          var meta = tx.objectStore('meta').get('pack');
          return function () {
            if (!meta.result) return null;
            var due = all.result
              .filter(function (c) {
                return c.fsrs === null || new Date(c.fsrs.due) <= now;
              })
              .sort(function (a, b) {
                var ad = a.fsrs ? a.fsrs.due : '';
                var bd = b.fsrs ? b.fsrs.due : '';
                return ad < bd ? -1 : ad > bd ? 1 : 0;
              });
            // New cards (no state yet) go after the cards that were due.
            var learned = due.filter(function (c) {
              return c.fsrs !== null;
            });
            var fresh = due.filter(function (c) {
              return c.fsrs === null;
            });
            return { cards: learned.concat(fresh), nextDue: meta.result.nextDue, hasCards: meta.result.hasCards };
          };
        });
      },
      // Applies the rating to the local card state with the same scheduler as the server, and queues it.
      enqueue: function (rating) {
        return run(['cards', 'ratings'], 'readwrite', function (tx) {
          var cards = tx.objectStore('cards');
          var get = cards.get(rating.cardId);
          get.onsuccess = function () {
            var card = get.result;
            if (card && root.ILScheduler) {
              card.fsrs = root.ILScheduler.scheduleNext(card.fsrs, rating.rating, new Date(rating.reviewedAt));
              cards.put(card);
            }
            tx.objectStore('ratings').add(rating);
          };
        });
      },
      pending: function () {
        return run(['ratings'], 'readonly', function (tx) {
          var all = tx.objectStore('ratings').getAll();
          return function () {
            return all.result;
          };
        });
      },
      // After the server answers, the local state is the server state.
      applyServerState: function (cardId, state) {
        return run(['cards'], 'readwrite', function (tx) {
          var cards = tx.objectStore('cards');
          var get = cards.get(cardId);
          get.onsuccess = function () {
            if (get.result) {
              get.result.fsrs = state;
              cards.put(get.result);
            }
          };
        });
      },
      // Sends queued ratings one by one, oldest first, and stops at the first failure that a retry could fix.
      flush: function () {
        if (flushing) return flushing;
        flushing = (function step(result) {
          return api.pending().then(function (items) {
            var item = items[0];
            if (!item) return result;
            return fetch('/api/review/rating', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ cardId: item.cardId, rating: item.rating, idempotencyKey: item.idempotencyKey, elapsedMs: item.elapsedMs, reviewedAt: item.reviewedAt }),
            }).then(
              function (res) {
                var removable = res.ok || (res.status >= 400 && res.status < 500 && [401, 408, 429].indexOf(res.status) === -1);
                if (!removable) return result;
                var done = res.ok ? res.json().then(function (data) { return api.applyServerState(item.cardId, data.card); }) : Promise.resolve();
                return done
                  .then(function () {
                    return run(['ratings'], 'readwrite', function (tx) {
                      tx.objectStore('ratings').delete(item.seq);
                    });
                  })
                  .then(function () {
                    if (res.ok) result.sent += 1;
                    else result.dropped += 1;
                    return step(result);
                  });
              },
              function () {
                return result; // network failure: keep the queue
              },
            );
          });
        })({ sent: 0, dropped: 0 }).then(
          function (r) {
            flushing = null;
            return r;
          },
          function (e) {
            flushing = null;
            throw e;
          },
        );
        return flushing;
      },
      close: function () {
        if (dbp) dbp.then(function (d) { d.close(); });
      },
    };
    return api;
  }

  function listLearnerIds() {
    if (!indexedDB.databases) return Promise.resolve([]);
    return indexedDB.databases().then(function (list) {
      return list
        .map(function (d) { return d.name; })
        .filter(function (n) { return n && n.indexOf(PREFIX) === 0; })
        .map(function (n) { return n.slice(PREFIX.length); });
    });
  }

  // Sign-out: send what can be sent, then delete every learner database and the cached pages.
  function clearAll(sendFirst) {
    return listLearnerIds().then(function (ids) {
      return Promise.all(
        ids.map(function (id) {
          var store = create(id);
          var sent = sendFirst ? store.flush().catch(function () {}) : Promise.resolve();
          return sent.then(function () {
            store.close();
            return new Promise(function (resolve) {
              var req = indexedDB.deleteDatabase(PREFIX + id);
              req.onsuccess = req.onerror = req.onblocked = function () { resolve(); };
            });
          });
        }),
      );
    });
  }

  root.ILStore = { create: create, clearAll: clearAll, listLearnerIds: listLearnerIds };
})(globalThis);
