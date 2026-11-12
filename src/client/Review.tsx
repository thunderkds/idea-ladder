// T011: /review. One due card at a time: the question, `Show answer`, then Again / Hard / Good / Easy. The session ends
// when the queue is empty or 5:00 has passed (client clock, from the first card shown); a card still on screen at 5:00
// can be rated, and no new card is shown after that. The server alone schedules the next review (ts-fsrs).
// T015: when the queue request cannot reach the network, the session runs from the offline pack cached in IndexedDB:
// each rating gets its next state locally from the same `scheduleNext` and is queued for sync (offline-store.ts).
// A session started online switches to the cached pack when a rating hits a network error (not an HTTP status).
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { OfflinePack } from "../shared/offline.ts";
import { RATINGS, type RateRequest, type Rating, type ReviewCard, type ReviewQueue } from "../shared/review.ts";
import { useOnline } from "./offline.tsx";
import { currentPack, expireSession, rateOffline, refresh } from "./offline-store.ts";
import { installAvailable, onInstallChange, promptInstall } from "./pwa.ts";

const LABELS: Record<Rating, string> = { again: "Again", hard: "Hard", good: "Good", easy: "Easy" };
const RATING_KEYS = ["1", "2", "3", "4"];

/** m:ss, rounded up so the timer shows 5:00 until a full second has passed and 0:00 only at the end. */
const clockText = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
/** Screen readers hear the timer only at the last minute, the last 10 seconds and time up, never every second. */
const announcement = (ms: number) =>
  ms <= 0
    ? "Time is up. Rate this card to finish."
    : ms <= 10_000
      ? "10 seconds left"
      : ms <= 60_000
        ? "1 minute left"
        : "";

type Session = {
  cards: ReviewCard[];
  /** One idempotency key per card, reused for every retry of that card. */
  keys: string[];
  index: number;
  startedAt: number;
  shownAt: number;
  rated: number;
  ended: boolean;
};

/** The offline pack as a review queue, in the server's order: due cards by due time, then New cards in pack order. */
function offlineQueue(pack: OfflinePack, now: number): ReviewQueue {
  const order = (c: OfflinePack["cards"][number]) =>
    c.cardState ? Date.parse(c.cardState.due) : Number.POSITIVE_INFINITY;
  const cards = pack.cards
    .filter((c) => c.cardState === null || Date.parse(c.cardState.due) <= now)
    .sort((a, b) => order(a) - order(b) || 0); // stable: equal keys (New cards) keep the pack's order
  const later = pack.cards
    .map((c) => c.cardState?.due)
    .filter((due): due is string => due !== undefined && Date.parse(due) > now)
    .sort((a, b) => Date.parse(a) - Date.parse(b));
  return {
    nowIso: new Date(now).toISOString(),
    sessionLimitMs: pack.sessionLimitMs,
    hasCards: pack.cards.length > 0,
    nextDueAt: later[0] ?? null,
    cards,
  };
}

function OfflineBanner() {
  return (
    <p className="offline-banner" role="status">
      <strong>Offline</strong> Your ratings are saved on this device and sync when you are back online.
    </p>
  );
}

/** Shown on Session done when the browser offers installing; never on first load. */
function InstallOffer() {
  const available = useSyncExternalStore(onInstallChange, installAvailable);
  const [dismissed, setDismissed] = useState(false);
  if (!available || dismissed) return null;
  return (
    <section className="install-offer" aria-labelledby="install-title">
      <h2 id="install-title">Install app</h2>
      <p>Install Idea Ladder to review offline and get a daily reminder.</p>
      <p className="install-actions">
        <button className="button button-quiet" type="button" onClick={() => void promptInstall()}>
          Install
        </button>
        <button className="button button-quiet" type="button" onClick={() => setDismissed(true)}>
          Not now
        </button>
      </p>
    </section>
  );
}

function BackLink({ primary = false }: { primary?: boolean }) {
  return (
    <p>
      <a className={primary ? "button" : "back-link"} href="/ladders">
        Back to My ladders
      </a>
    </p>
  );
}

export function ReviewPage() {
  const [queue, setQueue] = useState<ReviewQueue>();
  const [failed, setFailed] = useState(false);
  const [session, setSession] = useState<Session>();
  const [revealed, setRevealed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failedRating, setFailedRating] = useState<Rating>();
  const [now, setNow] = useState(() => Date.now());
  /** Set when the session runs from the cached offline pack of this learner. */
  const [offlineLearner, setOfflineLearner] = useState<string>();
  const [noPack, setNoPack] = useState(false);
  const online = useOnline();
  const questionRef = useRef<HTMLParagraphElement>(null);
  const answerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let stopped = false;
    const begin = (body: ReviewQueue) => {
      setQueue(body);
      if (body.cards.length === 0) return;
      const start = Date.now();
      setNow(start);
      setSession({
        cards: body.cards,
        keys: body.cards.map(() => crypto.randomUUID()),
        index: 0,
        startedAt: start,
        shownAt: start,
        rated: 0,
        ended: false,
      });
    };
    fetch("/api/review/queue")
      .then(
        async (res) => {
          if (res.status === 401) return expireSession();
          if (!res.ok) throw new Error(`review queue request failed: ${res.status}`);
          const body = (await res.json()) as ReviewQueue;
          if (stopped) return;
          begin(body);
        },
        // No network: run the session from the cached pack of the learner who last opened the review online.
        async () => {
          const pack = await currentPack();
          if (stopped) return;
          if (!pack) return setNoPack(true);
          setOfflineLearner(pack.learnerId);
          begin(offlineQueue(pack, Date.now()));
        },
      )
      .catch(() => {
        if (!stopped) setFailed(true);
      });
    return () => {
      stopped = true;
    };
  }, []);

  const running = session !== undefined && !session.ended;
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [running]);

  const index = session?.index ?? 0;
  useEffect(() => {
    if (index > 0) questionRef.current?.focus();
  }, [index]);
  useEffect(() => {
    if (revealed) answerRef.current?.focus();
  }, [revealed]);

  const rate = async (rating: Rating) => {
    if (!session || session.ended || saving) return;
    const card = session.cards[session.index];
    const idempotencyKey = session.keys[session.index];
    if (!card || !idempotencyKey) return;
    setSaving(true);
    setFailedRating(undefined);
    const body: RateRequest = { cardId: card.cardId, rating, idempotencyKey, elapsedMs: Date.now() - session.shownAt };
    try {
      let saved: boolean;
      if (offlineLearner) {
        await rateOffline(offlineLearner, body, new Date());
        saved = true;
      } else {
        const res = await fetch("/api/review/rate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }).catch(async (error: unknown) => {
          // The network dropped mid-session: go on from the cached pack when it has this card. The same idempotency
          // key is queued, so if the request did reach the server the sync answers `duplicate`, never a second row.
          const pack = error instanceof TypeError ? await currentPack() : undefined;
          if (!pack?.cards.some((c) => c.cardId === card.cardId)) throw error;
          await rateOffline(pack.learnerId, body, new Date());
          setOfflineLearner(pack.learnerId);
          return undefined;
        });
        if (res?.status === 401) return expireSession();
        // 404: the card is no longer reviewable for this learner (for example its level is locked); move on.
        if (res && !res.ok && res.status !== 404) throw new Error(`rating failed: ${res.status}`);
        saved = res ? res.ok : true;
      }
      // Online: send any queued ratings and keep the offline pack current.
      if (navigator.onLine) void refresh();
      const at = Date.now();
      const next = session.index + 1;
      const rated = session.rated + (saved ? 1 : 0);
      const timeUp = at - session.startedAt >= (queue?.sessionLimitMs ?? 0);
      setRevealed(false);
      setNow(at);
      setSession(
        next >= session.cards.length || timeUp
          ? { ...session, rated, ended: true }
          : { ...session, rated, index: next, shownAt: at },
      );
    } catch {
      setFailedRating(rating);
    } finally {
      setSaving(false);
    }
  };

  // Space shows the answer, 1-4 rate. A focused button keeps its own Space behaviour.
  const onKey = useRef<(e: KeyboardEvent) => void>(() => {});
  onKey.current = (e) => {
    if (!running || e.altKey || e.ctrlKey || e.metaKey || e.repeat) return;
    if (e.key === " ") {
      if (revealed || e.target instanceof HTMLButtonElement || e.target instanceof HTMLAnchorElement) return;
      e.preventDefault();
      setRevealed(true);
      return;
    }
    const rating = RATINGS[RATING_KEYS.indexOf(e.key)];
    if (revealed && rating) {
      e.preventDefault();
      void rate(rating);
    }
  };
  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKey.current(e);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  if (noPack) {
    return (
      <main className="page">
        <h1>Review not available offline yet</h1>
        <p className="status-detail">You are offline and have not opened your review online yet.</p>
        <p className="status-detail">Connect to the internet, then try again.</p>
        <p>
          <a className="button" href="/review">
            Try again
          </a>
        </p>
      </main>
    );
  }
  const banner = offlineLearner && !online ? <OfflineBanner /> : null;
  if (failed) {
    return (
      <main className="page" role="alert">
        <h1>Could not load your review</h1>
        <p className="status-detail">Something went wrong while loading it.</p>
        <p>
          <a className="button" href="/review">
            Try again
          </a>
        </p>
        <BackLink />
      </main>
    );
  }
  if (!queue) {
    return (
      <main className="page" aria-busy="true">
        <h1>Loading</h1>
      </main>
    );
  }
  if (!session) {
    return (
      <main className="page">
        {banner}
        <h1>{queue.hasCards ? "Nothing due" : "No cards yet"}</h1>
        {queue.hasCards && queue.nextDueAt ? (
          <p className="status-detail">
            Next review:{" "}
            <time dateTime={queue.nextDueAt}>
              {new Date(queue.nextDueAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
            </time>
          </p>
        ) : null}
        {queue.hasCards ? null : <p className="status-detail">Review cards appear here once a ladder has them.</p>}
        <BackLink primary />
      </main>
    );
  }
  if (session.ended) {
    return (
      <main className="page">
        {banner}
        <h1>Session done</h1>
        <p>
          You rated {session.rated} {session.rated === 1 ? "card" : "cards"} this session.
        </p>
        <p className="status-detail">Unrated cards stay due for the next session.</p>
        <BackLink primary />
        <InstallOffer />
      </main>
    );
  }

  const card = session.cards[session.index];
  if (!card) return null;
  const remaining = Math.max(0, queue.sessionLimitMs - (now - session.startedAt));
  return (
    <main className="page">
      <header className="bar">
        <nav className="bar-links" aria-label="Review">
          <a className="back-link" href="/ladders">
            My ladders
          </a>
          <a className="back-link" href="/settings">
            Settings
          </a>
        </nav>
        <p className="review-timer">
          <span className="muted">Time left </span>
          <span role="timer">{clockText(remaining)}</span>
        </p>
      </header>
      {banner}
      <h1>Review</h1>
      <p className="muted">
        Card {session.index + 1} of {session.cards.length}
      </p>
      <section className="review-card" aria-label="Review card">
        <p className="review-level">{card.level}</p>
        <p ref={questionRef} tabIndex={-1} className="review-front long-text">
          {card.front}
        </p>
        {revealed ? (
          <div ref={answerRef} tabIndex={-1} className="review-back">
            <p className="review-level">Answer</p>
            <p className="long-text">{card.back}</p>
          </div>
        ) : null}
      </section>
      {remaining === 0 ? <p className="status-detail">Time is up. Rate this card to finish.</p> : null}
      {revealed ? (
        <fieldset className="review-ratings">
          <legend className="visually-hidden">Rate this card</legend>
          {RATINGS.map((rating) => (
            <button
              key={rating}
              className="button button-quiet"
              type="button"
              disabled={saving}
              onClick={() => void rate(rating)}
            >
              {LABELS[rating]}
            </button>
          ))}
        </fieldset>
      ) : (
        <button className="button review-show" type="button" onClick={() => setRevealed(true)}>
          Show answer
        </button>
      )}
      {failedRating ? (
        <div className="review-error" role="alert">
          <p>Could not save your rating. It is not lost: try again.</p>
          <button className="button" type="button" disabled={saving} onClick={() => void rate(failedRating)}>
            Try again
          </button>
        </div>
      ) : null}
      <p className="muted">Keys: Space shows the answer, 1 to 4 rate.</p>
      <p className="visually-hidden" aria-live="polite">
        {announcement(remaining)}
      </p>
    </main>
  );
}
