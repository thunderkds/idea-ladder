# 0004 — Offline sync, push reminders, progress import (T015)

Date: 2026-11-12. Status: accepted.

T015 lets the learner review offline, sends a daily push reminder, and exports/imports progress. The server stays
the source of truth: every card state still changes only through `rateCard` → `scheduleNext` (ADR 0003), so the
review log still replays to every stored `card_states` row. New table: `push_subscriptions`
(`migrations/0006_push_subscriptions.up.sql`).

| Table | Key | Meaning |
|---|---|---|
| `push_subscriptions` | `id` bigint identity; `endpoint` `UNIQUE`; `learner_id` FK to `users(id)` `ON DELETE CASCADE` | one browser's Web Push subscription: `endpoint`, `p256dh`, `auth` (capabilities: stored, never logged, never returned), `reminder_hour` 0..23 in `timezone` (IANA name), `last_sent_at` |

Rules:

- **Sync.** `GET /api/review/offline-pack` gives the cards due within 7 days (plus New cards) of unlocked levels.
  `POST /api/review/sync` sends queued ratings in order, each through `rateCard`. `reviewInstant` picks the review
  time: the client `reviewedAt` is used only if it is after the card's `last_review` and not later than server time
  + 5 min (`FUTURE_SLACK_MS`); otherwise server time (never before `last_review`). The per-rating response field
  `usedClientTime` is the record of which time was used: there is no `clientTimeRejected` column. A card with no
  `last_review` (never rated) accepts any past `reviewedAt`, so a restore from an export keeps its old times;
  backdating only changes the learner's own schedule. Idempotency keys (ADR 0003) make a rating sent twice one row.
- **Import.** The file is size-checked (5 MiB, `413 file-too-large`) before it is read, then validated whole with zod
  (`version: 1` only; at most 20 000 review rows and 20 000 rows in each other list) before anything is written,
  and refused (`403 wrong-account`) when `learner.githubId` is not the signed-in account. Only `reviewLog` rows are
  applied, per card in `reviewedAt` order, each through `rateCard`. A row is skipped when its idempotency key is
  already used, the card is not rateable by this learner (another learner's ladder, a locked level, unknown), its
  time is not after the server's `last_review`, or it is more than 5 min after server time. The file's
  `cardStates`, `levelStatus` and `evidenceHashes` are validated but never written: writing a state would break the
  replay guarantee, and lock state and evidence come only from server-side pass tests (NFR-002). So an import can
  never create proof or unlock a level. Export writes `evidenceHashes: []` until T012 adds evidence records.
- **Push reminders.** `reminderTick` (Inngest cron `0 * * * *`) sends one push to a subscription when its local
  hour equals `reminder_hour`, ≥ 1 card is due in the learner's review queue, and nothing was sent in the last 20 h.
  It claims the row (`UPDATE ... last_sent_at` guarded by the 20 h rule) before sending, so overlapping ticks never
  both send. A push service answer of 404 or 410 deletes the row; other failures keep it and log only the row id and
  status. The clock (`now()`) and the sender are injected: tests and the e2e server use a fake sender; `main.ts`
  uses `web-push` with the VAPID keys from config (all three or none; without them the tick does nothing and
  subscribe answers `503 push-not-configured`).
- **Endpoint host restriction.** The server POSTs to the endpoint a learner subscribes, so subscribe accepts only
  `https` on port 443, no userinfo, a DNS name (no IP literal, not `localhost`) equal to or under one of
  `PUSH_SERVICE_HOSTS` in `src/server/push.ts` (Google FCM, Mozilla, Apple, Microsoft WNS; also
  `jmt17.google.com`, the FCM host that Chromium builds without Google API keys use, found by QA 2026-11-12, only
  that host and its subdomains, not the rest of `google.com`). Anything else is
  `400 invalid-request`. Unsubscribe accepts any https URL, since it only deletes the caller's own row.
- **Manual check for the owner.** No test sends a real push. After deploy with VAPID keys set: install the PWA on
  one real iPhone (iOS ≥ 16.4, Add to Home Screen), turn on reminders at the next hour, keep one card due, and
  record the received notification (screenshot) in `tasks/TASK_REVIEW_T015.md`.

Known gaps (T018 hardening list):

- A shared browser: subscribing an endpoint another learner holds moves the row to the new learner (the browser
  has one endpoint); the first learner stops getting reminders there.
- Import while rating in another tab: a rating that lands between the import's `last_review` read and its
  `rateCard` call is ordered by the row lock, so the imported row may apply after it at server time.
- No rate limit on `POST /api/review/sync` or `POST /api/progress/import` (both bounded by size and row caps).
- Any past `reviewedAt` is accepted for a never-rated card (see Sync).
