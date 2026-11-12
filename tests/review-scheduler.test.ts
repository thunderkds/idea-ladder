import { describe, expect, test } from "bun:test";
import { createEmptyCard, fsrs, generatorParameters, Rating, State } from "ts-fsrs";
import pkg from "../package.json";
import { cardState, newCard, scheduleNext, toGrade } from "../src/server/scheduler.ts";
import { RATINGS } from "../src/shared/review.ts";

const T = new Date("2026-11-01T09:00:00Z");
const lib = fsrs(generatorParameters({ enable_fuzz: false }));
const GRADE = { again: Rating.Again, hard: Rating.Hard, good: Rating.Good, easy: Rating.Easy } as const;
const days = (n: number) => n * 86_400_000;

describe("T011 scheduleNext (AC 2, Success Criteria 2)", () => {
  test("package.json pins ts-fsrs exactly 5.4.2", () => {
    expect(pkg.dependencies["ts-fsrs"]).toBe("5.4.2");
  });

  test("a New card rated Good at 2026-11-01T09:00:00Z equals the library output exactly", () => {
    const expected = lib.next(createEmptyCard(T), T, Rating.Good).card;
    expect(scheduleNext(newCard(T), "good", T)).toEqual(expected);
  });

  test("all 4 ratings from every card state (New, Learning, Review, Relearning) equal the library output", () => {
    const learning = lib.next(createEmptyCard(T), T, Rating.Again).card;
    const review = lib.next(createEmptyCard(T), T, Rating.Easy).card;
    const relearning = lib.next(review, new Date(review.due.getTime() + days(1)), Rating.Again).card;
    const starts = [
      { card: createEmptyCard(T), at: T },
      { card: learning, at: new Date(T.getTime() + 60_000) },
      { card: review, at: new Date(review.due.getTime() + days(2)) },
      { card: relearning, at: new Date(relearning.due.getTime() + 600_000) },
    ];
    expect(starts.map((s) => s.card.state)).toEqual([State.New, State.Learning, State.Review, State.Relearning]);
    for (const { card, at } of starts) {
      for (const r of RATINGS) {
        expect(scheduleNext(card, r, at)).toEqual(lib.next(card, at, GRADE[r]).card);
      }
    }
  });

  test("does not mutate the input card", () => {
    const card = newCard(T);
    const copy = structuredClone(card);
    scheduleNext(card, "easy", T);
    expect(card).toEqual(copy);
  });

  test("Rating.Manual and unknown strings are never a grade", () => {
    for (const bad of ["manual", "Manual", "MANUAL", "Good", "0", "", "again "]) expect(toGrade(bad)).toBeUndefined();
    expect(RATINGS.map(toGrade)).toEqual([Rating.Again, Rating.Hard, Rating.Good, Rating.Easy]);
  });

  test("card state names follow the ts-fsrs State enum", () => {
    expect([State.New, State.Learning, State.Review, State.Relearning].map(cardState)).toEqual([
      "new",
      "learning",
      "review",
      "relearning",
    ]);
  });
});
