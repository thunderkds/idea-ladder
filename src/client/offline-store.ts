// T015: the offline review data in IndexedDB (idb) and its sync with the server, which stays the source of truth.
// - `packs`: the last offline pack per learner id (cards due within 7 days + New cards, each with its stored state).
// - `meta.learner`: the learner the cached pack belongs to; only that learner's pack is ever shown offline.
// - `queue`: ratings made offline, in order, each with an idempotency key made once and reused on every retry.
// Sign-out clears all of it (and the service worker caches). A 401 clears the packs and caches but keeps the queue
// and `meta.learner`, so ratings made offline still sync after the same learner signs in again; no card is shown.
import { type DBSchema, type IDBPDatabase, openDB } from "idb";
import { type Card, newCard, scheduleNext } from "../server/scheduler.ts";
import {
  type CardStateJson,
  MAX_SYNC_BATCH,
  type OfflinePack,
  type SyncRating,
  type SyncRequest,
  type SyncResponse,
} from "../shared/offline.ts";
import type { Rating } from "../shared/review.ts";

export const DB_NAME = "idea-ladder";
export const DB_VERSION = 1;
export type QueuedRating = SyncRating & { learnerId: string; seq?: number };

interface OfflineDb extends DBSchema {
  packs: { key: string; value: OfflinePack };
  queue: { key: number; value: QueuedRating };
  meta: { key: string; value: string };
}

/**
 * Versioned upgrade. Each version step only adds stores or indexes; the `queue` store is never deleted or recreated,
 * so ratings queued under an older app version survive an upgrade and still sync.
 */
function upgrade(db: IDBPDatabase<OfflineDb>, oldVersion: number) {
  if (oldVersion < 1) {
    db.createObjectStore("packs", { keyPath: "learnerId" });
    db.createObjectStore("queue", { keyPath: "seq", autoIncrement: true });
    db.createObjectStore("meta");
  }
}

let opened: Promise<IDBPDatabase<OfflineDb>> | undefined;
const db = () => {
  opened ??= openDB<OfflineDb>(DB_NAME, DB_VERSION, {
    upgrade,
    // A newer app version in another tab wants to upgrade: let it, and reopen on the next call.
    blocking(_current, _next, event) {
      (event.target as IDBDatabase).close();
      opened = undefined;
    },
  });
  return opened;
};

const toCard = (s: CardStateJson): Card => ({
  ...s,
  due: new Date(s.due),
  last_review: s.last_review ? new Date(s.last_review) : undefined,
});
const toJson = (c: Card): CardStateJson => ({
  due: c.due.toISOString(),
  stability: c.stability,
  difficulty: c.difficulty,
  elapsed_days: c.elapsed_days,
  scheduled_days: c.scheduled_days,
  learning_steps: c.learning_steps,
  reps: c.reps,
  lapses: c.lapses,
  state: c.state as CardStateJson["state"],
  last_review: c.last_review ? c.last_review.toISOString() : null,
});

/** The next local state, computed exactly as the server's rateCard does (New on first rating, never before last review). */
export function localNext(state: CardStateJson | null, rating: Rating, now: Date) {
  const before = state ? toCard(state) : newCard(now);
  const at = new Date(Math.max(now.getTime(), before.last_review?.getTime() ?? 0));
  return { at, state: toJson(scheduleNext(before, rating, at)) };
}

/** The cached pack of the learner who last opened the app online, or undefined. */
export async function currentPack(): Promise<OfflinePack | undefined> {
  const d = await db();
  const learnerId = await d.get("meta", "learner");
  return learnerId ? d.get("packs", learnerId) : undefined;
}

/**
 * Stores a fresh pack, unless this learner still has unsynced ratings (their local states are newer than the pack).
 * A pack of another learner replaces the old learner's pack.
 */
async function savePack(pack: OfflinePack) {
  const tx = (await db()).transaction(["packs", "meta", "queue"], "readwrite");
  const queued = (await tx.objectStore("queue").getAll()).some((q) => q.learnerId === pack.learnerId);
  if (!queued) {
    if ((await tx.objectStore("meta").get("learner")) !== pack.learnerId) await tx.objectStore("packs").clear();
    await tx.objectStore("packs").put(pack);
    await tx.objectStore("meta").put(pack.learnerId, "learner");
  }
  await tx.done;
}

/** The learner's queued ratings in the order they were made. */
export async function queuedRatings(learnerId: string): Promise<QueuedRating[]> {
  const all = await (await db()).getAll("queue");
  return all
    .filter((q) => q.learnerId === learnerId)
    .sort((a, b) => a.reviewedAt.localeCompare(b.reviewedAt) || (a.seq ?? 0) - (b.seq ?? 0));
}

/** One offline rating: the next state from `scheduleNext` goes into the cached pack and the rating into the queue. */
export async function rateOffline(
  learnerId: string,
  r: { cardId: string; rating: Rating; idempotencyKey: string; elapsedMs: number },
  now: Date,
) {
  const tx = (await db()).transaction(["packs", "queue"], "readwrite");
  const pack = await tx.objectStore("packs").get(learnerId);
  const card = pack?.cards.find((c) => c.cardId === r.cardId);
  if (!pack || !card) throw new Error("card is not in the offline pack");
  const next = localNext(card.cardState, r.rating, now);
  card.cardState = next.state;
  await tx.objectStore("packs").put(pack);
  await tx.objectStore("queue").add({ ...r, reviewedAt: next.at.toISOString(), learnerId });
  await tx.done;
}

/** Applies one sync answer: every answered item leaves the queue; a returned `card` replaces the local state. */
async function applySync(learnerId: string, sent: QueuedRating[], body: SyncResponse) {
  const tx = (await db()).transaction(["packs", "queue"], "readwrite");
  const pack = await tx.objectStore("packs").get(learnerId);
  for (const result of body.results) {
    const item = sent.find((q) => q.idempotencyKey === result.idempotencyKey);
    if (item?.seq !== undefined) await tx.objectStore("queue").delete(item.seq);
    const card = pack?.cards.find((c) => c.cardId === result.cardId);
    if (card && result.card) card.cardState = result.card;
  }
  if (pack) await tx.objectStore("packs").put(pack);
  await tx.done;
}

/** Empties the given stores and every service worker cache. Never throws. */
async function clearStores(stores: ("packs" | "queue" | "meta")[]) {
  try {
    const tx = (await db()).transaction(stores, "readwrite");
    await Promise.all(stores.map((s) => tx.objectStore(s).clear()));
    await tx.done;
  } catch {
    // IndexedDB unavailable: nothing was stored
  }
  try {
    if ("caches" in window) for (const name of await caches.keys()) await caches.delete(name);
  } catch {
    // Cache Storage unavailable
  }
}

/** Explicit sign-out: empties all offline data, the queue included, and the service worker caches. */
export const clearOfflineData = () => clearStores(["packs", "queue", "meta"]);

/**
 * A 401 from any API call (the session expired or ended elsewhere): no card text stays readable (packs and caches
 * go), but the queue and `meta.learner` stay, so the same learner's next sign-in still syncs the ratings made
 * offline. Then the home page, which has the sign-in button.
 */
export async function expireSession() {
  await clearStores(["packs"]);
  window.location.assign("/");
}

/**
 * Sends the queue in order, at most MAX_SYNC_BATCH per request, named with the learner it belongs to (the server
 * answers 409 wrong-learner, writing nothing, when that is not the signed-in account). "kept" when something stays
 * queued for the next app open or `online` event (5xx, 409, anything else); "expired" on a 401.
 */
async function syncQueue(): Promise<"done" | "kept" | "expired"> {
  const learnerId = await (await db()).get("meta", "learner");
  if (!learnerId) return "done";
  const queued = await queuedRatings(learnerId);
  for (let i = 0; i < queued.length; i += MAX_SYNC_BATCH) {
    const sent = queued.slice(i, i + MAX_SYNC_BATCH);
    const body: SyncRequest = {
      learnerId,
      ratings: sent.map(({ cardId, rating, idempotencyKey, elapsedMs, reviewedAt }) => ({
        cardId,
        rating,
        idempotencyKey,
        elapsedMs,
        reviewedAt,
      })),
    };
    const res = await fetch("/api/review/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status === 401) return "expired";
    if (!res.ok) return "kept";
    await applySync(learnerId, sent, (await res.json()) as SyncResponse);
  }
  return "done";
}

/** Sync the queue, then store a fresh pack. A network error leaves everything for the next try. */
async function runRefresh() {
  try {
    const synced = await syncQueue();
    if (synced === "expired") return await expireSession();
    if (synced === "kept") return;
    const res = await fetch("/api/review/offline-pack");
    if (res.status === 401) return await expireSession();
    if (!res.ok) return;
    await savePack((await res.json()) as OfflinePack);
  } catch {
    // offline or the server is unreachable: the `online` event or the next visit tries again
  }
}

let chain: Promise<void> = Promise.resolve();
/** One refresh at a time, so a rating is never sent twice by two overlapping syncs. */
export function refresh(): Promise<void> {
  chain = chain.then(runRefresh);
  return chain;
}

const SIGN_OUT_SYNC_MS = 2_000;
const noop = () => undefined;
/**
 * Explicit sign-out: when online, first try to send the queue (at most 2 s, after any refresh already running), so
 * ratings made offline are not thrown away needlessly; then clear everything whatever the sync did. Never throws.
 */
export async function signOut() {
  if (navigator.onLine) {
    // A 401 or any failure here changes nothing: everything is cleared below anyway.
    chain = chain.then(() => syncQueue().then(noop, noop));
    await Promise.race([chain, new Promise((resolve) => setTimeout(resolve, SIGN_OUT_SYNC_MS))]);
  }
  await clearOfflineData();
}

/** App open: sync and refresh the pack on signed-in pages, and again whenever the network comes back. */
export function startOfflineSync() {
  window.addEventListener("online", () => void refresh());
  if (window.location.pathname !== "/" && navigator.onLine) void refresh();
}
