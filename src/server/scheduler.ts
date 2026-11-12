// T011: the only place a next review date is computed. Pure: no I/O, no clock; every input is given.
// ts-fsrs 5.4.2 with default parameters and fuzz off, so a replay of the review log gives the same dates.
import {
  type Card,
  createEmptyCard,
  Rating as FsrsRating,
  fsrs,
  type Grade,
  generatorParameters,
  State,
} from "ts-fsrs";
import type { CardState, Rating } from "../shared/review.ts";

export type { Card };

const scheduler = fsrs(generatorParameters({ enable_fuzz: false }));

const GRADES: Record<Rating, Grade> = {
  again: FsrsRating.Again,
  hard: FsrsRating.Hard,
  good: FsrsRating.Good,
  easy: FsrsRating.Easy,
};

/** The ts-fsrs grade for a client rating string; undefined for anything else (`Rating.Manual` included). */
export function toGrade(rating: string): Grade | undefined {
  return Object.hasOwn(GRADES, rating) ? GRADES[rating as Rating] : undefined;
}

/** The state of a card the learner has never rated. */
export function newCard(now: Date): Card {
  return createEmptyCard(now);
}

/** The card after `rating` at `now`, exactly as ts-fsrs computes it. */
export function scheduleNext(card: Card, rating: Rating, now: Date): Card {
  return scheduler.next(card, now, GRADES[rating]).card;
}

const STATE_NAMES: Record<State, CardState> = {
  [State.New]: "new",
  [State.Learning]: "learning",
  [State.Review]: "review",
  [State.Relearning]: "relearning",
};
export const cardState = (state: State): CardState => STATE_NAMES[state];
