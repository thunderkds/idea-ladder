# 0002 — `ladder_levels` table (T010, reused by T008)

Date: 2026-11-12. Status: accepted.

T010 shows the five levels of a ladder; T008 writes them. Tests need level rows to seed, so T010 adds the table
in `migrations/0004_ladder_levels.up.sql` (number `0003` belongs to T006). T008 reuses it and adds columns only
if it must.

| Column | Type | Meaning |
|---|---|---|
| `ladder_id` | `bigint` FK to `ladders(id)`, `ON DELETE CASCADE` | the ladder |
| `level` | `text`, one of `L0`..`L4` | level id; primary key with `ladder_id` |
| `title` | `text` | level title |
| `goal` | `text` | what the learner does at this level |
| `pass_test_kind` | `text` | free text kind of the pass test (T012 and T013 decide the values) |
| `pass_test_description` | `text` | the pass test in plain words |
| `skip_reason` | `text`, null | `concept-only-skipped` when the level is not generated for this repo |

A ladder with no rows is valid. The ladder view then shows the fixed L0 to L4 titles and pass tests
(`src/shared/levels.ts`) with the goal `Not generated yet`. Passes are not stored here: T012 owns them.
