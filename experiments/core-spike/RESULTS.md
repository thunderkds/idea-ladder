# T001 core spike — RESULTS

Generated 2026-11-01T02:16:47.701Z by `pnpm experiment` (offline: recorded GitHub fixtures, no LLM, no network).

## Verdicts (thresholds pre-registered in TASK_GUIDE_T001, not tuned after the run)

VERDICT answer-key code check: FAIL (catch 96.9% vs >= 90%; false-reject 11.3% vs <= 10%). Code check alone is insufficient: blind solver or entailment check required
VERDICT signed proof: KEEP (untouched record verifies; 17/17 tamper cases rejected = 100%)
VERDICT GitHub read: KEEP (all 3 repos gave a 40-hex SHA + snapshot in <= 20 API calls each)

## 1. Answer-key code check (AC 3)

Seed set: 53 original MCQs (4 options), grounded in <= 300-char quotes of 3 recorded READMEs.

| Metric | Count | Rate |
|---|---|---|
| Catch rate (seeded wrong keys rejected / all seeded wrong keys) | 154 / 159 | 96.9% |
| False-reject rate (correct keys rejected / all correct keys) | 6 / 53 | 11.3% |

By kind:

| Kind | Wrong keys caught | Correct keys rejected |
|---|---|---|
| numeric | 44 / 45 (97.8%) | 0 / 15 |
| span | 98 / 102 (96.1%) | 2 / 34 |
| paraphrase | 12 / 12 (100.0%) | 4 / 4 |

Misses (5) — seeded wrong key that the check accepted:

- `mitt-08` wrong key `on` (true key `off`) — Which method removes a handler?
- `dset-27` wrong key `1` (true key `999`) — Which value is written at path b.1?
- `dset-29` wrong key `Objects` (true key `Arrays`) — What is created when an integer segment is met?
- `dset-33` wrong key `lodash/set` (true key `dset`) — Which library was fastest in the benchmark?
- `dset-33` wrong key `set-value` (true key `dset`) — Which library was fastest in the benchmark?

False rejects (6) — correct key that the check rejected:

- `mitt-09` key `registers a handler` [paraphrase] — What does the on method do?
- `mitt-16` key `the name was available` [paraphrase] — What is notable about the package name?
- `dset-31` key `String or Array` [span] — Which types may the path have?
- `dset-32` key `last` [span] — Which key of the path receives the value?
- `dset-36` key `to combine streamed response chunks` [paraphrase] — Why does dset/merge exist?
- `pf-49` key `existing frameworks are too large` [paraphrase] — What does the README say about other frameworks?

## 2. Signed evidence record (AC 4, 5)

- Record: example from docs/REQUIREMENT_SOURCE.md § Diagram text. Hash: `sha256:a1abe95d78b6b13e35923d66b7be6307c34a52d04bf6aa091812f26b8b0382d9`
- Canonical JSON key-order independent: true
- Untouched record verifies: true
- Tamper cases rejected: 17 / 17

  - rejected: change learner
  - rejected: change ladder
  - rejected: change level
  - rejected: change test
  - rejected: change evidence.branch
  - rejected: change evidence.commit
  - rejected: change evidence.diffQuestions.asked
  - rejected: change evidence.diffQuestions.correct
  - rejected: change evidence.diffQuestions.pass
  - rejected: change verifiedBy
  - rejected: change verifiedAt
  - rejected: add field
  - rejected: remove field
  - rejected: bad hash
  - rejected: flip signature bit
  - rejected: verify with another public key
  - rejected: tamper level L2->L3 and recompute hash

## 3. GitHub read + SHA pin + confidence (AC 6, 7, 8)

| Repo | Pinned SHA | Branch | API calls | README chars | Open issues | Good first issues | Dep files | Confidence | Reasons | Recorded |
|---|---|---|---|---|---|---|---|---|---|---|
| The-Pocket/PocketFlow | `f74d023f93607b8c3268133339a5e532a949898c` | main | 7 | 18377 | 60 | 0 | setup.py | 0.9 high | 0 good first issue (-0.1) | 2026-11-01T02:10:57Z |
| developit/mitt | `6b41670516ed8e8b738612f60491995470aa63b3` | main | 7 | 6273 | 16 | 0 | package.json | 0.9 high | 0 good first issue (-0.1) | 2026-11-01T02:11:00Z |
| lukeed/dset | `05b1ec0f8cebe3b5d5667285bc7da90f38a7215e` | master | 7 | 4797 | 8 | 0 | package.json | 0.9 high | 0 good first issue (-0.1) | 2026-11-01T02:11:03Z |

## Known limits (read before trusting the numbers)

- The seeded wrong keys are synthetic: each distractor of my own MCQ becomes the key. The catch rate is an upper bound for real generator mistakes, which are subtler (a wrong key that paraphrases the chunk, or that appears in it).
- The seed set is small (53 MCQs) and written by one author (an LLM-assisted agent) before the run; distractor quality drives the catch rate. No threshold or rule was changed after the first run.
- Most correct keys are literal spans. A real generator may write keys as paraphrases; those are false-rejected by design (see the `paraphrase` row). The false-reject rate depends on the span/paraphrase mix, which here is chosen by the author.
- Case-insensitive matching means a wrong key that differs only by case (e.g. `window.Mitt` vs `window.mitt`) is accepted by design. The seed set has no such distractor, so this class is not measured.
- All 3 v0 repos score `high` (0.9): none has a `good first issue`, all have a README >= 1,500 chars, open issues and a dependency file. The concept-fallback branch is covered by unit tests on hand-made snapshots only; no real v0 repo triggers it, and the rule does not flag `lukeed/dset` as thin.
- The check is lexical: a key inside a negated sentence ("there is no retry") passes. Not solved, by design of the spike.
- A distractor that also appears in the chunk passes the check. Only a blind solver or an entailment check can catch that class.
- `_` counts as a word character, so a key wrapped in markdown emphasis (`_last_`) is rejected. Markup inside the chunk (backticks between words) also breaks multi-word keys.
- Issue counts use only the first page (<= 100 issues, pull requests excluded). A repo with > 100 open issues reads as 100.
- GitHub numbers come from fixtures recorded once, unauthenticated, on the date shown. SHAs move; the fixture pins them. 7 calls per repo are the count of the code path, not a measured latency or a rate-limit stress test.
- Ed25519 keys are generated in memory per run; nothing is persisted. The record is plain signed JSON: no key distribution, revocation or issuer identity is tested.
- The LLM blind solver, embedding dedupe and FSRS are not measured (out of scope).
