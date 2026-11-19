# 0003 — Review tables: `review_cards`, `card_states`, `review_log` (T011, reused by T008 and T015)

Date: 2026-11-12. Status: accepted.

T011 schedules daily reviews; T008 generates the cards. Tests need card rows to seed, so T011 adds the card table
with the scheduling tables in `migrations/0005_review.up.sql` (number `0003` belongs to T006). T008 writes
`review_cards` and adds columns only if it must; T011 only reads it.

| Table | Key | Meaning |
|---|---|---|
| `review_cards` | `id` bigint identity; `ladder_id` FK to `ladders(id)` `ON DELETE CASCADE`; `level` one of `L0`..`L4` | one card: `front` (question) and `back` (answer), original text (PROJECT_SPEC Critical Constraints) |
| `card_states` | primary key (`learner_id`, `card_id`), both FK `ON DELETE CASCADE` | the learner's ts-fsrs 5.4.2 `Card` fields: `due`, `stability`, `difficulty`, `elapsed_days`, `scheduled_days`, `learning_steps`, `reps`, `lapses`, `state` (ts-fsrs `State` 0..3), `last_review` |
| `review_log` | `id` bigint identity; `UNIQUE (learner_id, idempotency_key)`; FKs without cascade | one row per rating: `rating` (`again`/`hard`/`good`/`easy`), `state_before` and `state_after` (the ts-fsrs `Card` as jsonb), `reviewed_at` (server time), `elapsed_ms` |

Rules:

- A card with no `card_states` row is New and due now. The row is created on the first rating, inside the rating's
  transaction, then locked `FOR UPDATE`; two tabs rating one card therefore apply in order, never to a stale state.
- Only `src/server/scheduler.ts` (`scheduleNext`, ts-fsrs default parameters, fuzz off) computes a next state.
  Replaying a learner's `review_log` rows for a card, in `id` order, from `createEmptyCard(first reviewed_at)`,
  gives the stored `card_states` row (tested in `tests/review-api.test.ts`).
- `review_log` is append-only: a trigger raises on `UPDATE` and `DELETE`. Its FKs have no cascade, so a card or a
  learner with review history cannot be deleted row by row. `TRUNCATE` is not blocked (test resets use it); deleting
  a learner's data on request is a later decision (T018 hardening list).
- Unlocked levels come from `levelLockState` (T010) over the `passedLevels` seam; "ladders the learner started" is the
  `generation_jobs.started_by` join of `listLadders`.

## T032 amendment (2026-11-19): one card table

T008 first saved generated cards in its own table `cards` (0009), which the review queue never read. Migration
`0012_review_cards_content` moved them into `review_cards` and dropped `cards`. `review_cards` has two more columns,
both nullable (a hand-seeded row has neither):

| Column | Meaning |
|---|---|
| `position` integer, `>= 0` | order of the card inside its ladder level; unique with `ladder_id` and `level` (NULL positions never collide) |
| `chunk_id` bigint FK to `chunks(id)` | the chunk the card cites; `mcq-test.ts` links a missed question to its cards by it |

`saveLadder` writes `review_cards`; the review queue, rating, offline pack and the failed-test `reviewCardIds` all use
that one table and one id space. Down for 0012 is lossy for ids and never deletes a `review_cards` row.
