import { createEmptyCard, fsrs, generatorParameters, Rating, type Card } from 'ts-fsrs';

/** Rating values the learner can give. `Rating.Manual` (0) is never accepted. */
export const RATINGS = [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy] as const;
export type ReviewRating = (typeof RATINGS)[number];

export function isReviewRating(value: unknown): value is ReviewRating {
  return typeof value === 'number' && (RATINGS as readonly number[]).includes(value);
}

/** A learner's FSRS state for one card. `state`: 0 New, 1 Learning, 2 Review, 3 Relearning. */
export interface CardState {
  due: Date;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  state: number;
  lastReview: Date | null;
}

// Fuzz is off so a replay of the review log gives the same dates ("Must be reproducible").
const scheduler = fsrs(generatorParameters({ enable_fuzz: false }));

function toCard(s: CardState): Card {
  return {
    due: s.due,
    stability: s.stability,
    difficulty: s.difficulty,
    elapsed_days: s.elapsedDays,
    scheduled_days: s.scheduledDays,
    learning_steps: s.learningSteps,
    reps: s.reps,
    lapses: s.lapses,
    state: s.state,
    ...(s.lastReview ? { last_review: s.lastReview } : {}),
  };
}

function fromCard(c: Card): CardState {
  return {
    due: c.due,
    stability: c.stability,
    difficulty: c.difficulty,
    elapsedDays: c.elapsed_days,
    scheduledDays: c.scheduled_days,
    learningSteps: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state,
    lastReview: c.last_review ?? null,
  };
}

/** The state of a card the learner has not rated yet. */
export function initialState(now: Date): CardState {
  return fromCard(createEmptyCard(now));
}

/** The one place that asks ts-fsrs for the next state. Pure: the same inputs give the same output. */
export function scheduleNext(state: CardState, rating: ReviewRating, now: Date): CardState {
  return fromCard(scheduler.next(toCard(state), now, rating).card);
}

export interface LogEntry {
  rating: ReviewRating;
  reviewedAt: Date;
}

/** Folds a learner's review log, oldest first, over the initial state. */
export function replayLog(entries: readonly LogEntry[]): CardState {
  const first = entries[0];
  if (!first) throw new Error('replayLog needs at least one entry');
  return entries.reduce((state, e) => scheduleNext(state, e.rating, e.reviewedAt), initialState(first.reviewedAt));
}

/** JSON form of a state for the review log (dates as ISO strings). */
export function stateToJson(s: CardState): Record<string, unknown> {
  return { ...s, due: s.due.toISOString(), lastReview: s.lastReview ? s.lastReview.toISOString() : null };
}
