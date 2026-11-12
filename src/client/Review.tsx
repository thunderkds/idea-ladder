// T011: /review. One due card at a time: the question, `Show answer`, then Again / Hard / Good / Easy. The session ends
// when the queue is empty or 5:00 has passed (client clock, from the first card shown); a card still on screen at 5:00
// can be rated, and no new card is shown after that. The server alone schedules the next review (ts-fsrs).
import { useEffect, useRef, useState } from "react";
import { RATINGS, type RateRequest, type Rating, type ReviewCard, type ReviewQueue } from "../shared/review.ts";

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
  const questionRef = useRef<HTMLParagraphElement>(null);
  const answerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let stopped = false;
    fetch("/api/review/queue")
      .then(async (res) => {
        if (res.status === 401) return window.location.assign("/");
        if (!res.ok) throw new Error(`review queue request failed: ${res.status}`);
        const body = (await res.json()) as ReviewQueue;
        if (stopped) return;
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
      })
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
      const res = await fetch("/api/review/rate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status === 401) return window.location.assign("/");
      // 404: the card is no longer reviewable for this learner (for example its level is locked); move on.
      if (!res.ok && res.status !== 404) throw new Error(`rating failed: ${res.status}`);
      const at = Date.now();
      const next = session.index + 1;
      const rated = session.rated + (res.ok ? 1 : 0);
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
        <h1>Session done</h1>
        <p>
          You rated {session.rated} {session.rated === 1 ? "card" : "cards"} this session.
        </p>
        <p className="status-detail">Unrated cards stay due for the next session.</p>
        <BackLink primary />
      </main>
    );
  }

  const card = session.cards[session.index];
  if (!card) return null;
  const remaining = Math.max(0, queue.sessionLimitMs - (now - session.startedAt));
  return (
    <main className="page">
      <header className="bar">
        <a className="back-link" href="/ladders">
          My ladders
        </a>
        <p className="review-timer">
          <span className="muted">Time left </span>
          <span role="timer">{clockText(remaining)}</span>
        </p>
      </header>
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
