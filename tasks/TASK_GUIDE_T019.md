# TASK_GUIDE — T019: Signed credential (plain signed JSON, Ed25519) on ladder completion + revocation status list
**Date**: 2026-11-01
**Complexity Level**: C2
**Risk Level**: High
**Priority**: P0
**Assigned agent**: backend-developer
**Agent guide**: `agents/backend.md`

---

## Mandatory Startup (Do Not Skip)

Before writing any code:
1. Read `PROJECT_SPEC.md`
2. Read the memory slice in your spawn prompt (`<!-- memory-slice -->`). Read `memory/MEMORY.md` in full only if your work reaches a file, hook, skill or decision the slice does not cover
3. Read this file completely
4. Read `agents/backend.md`
5. Note the **Complexity Level** above and apply the matching process from the Complexity matrix in `agents/backend.md`
6. C2: read `memory/codebase-map.md` (the app layout set by T003, once mapped). Read `experiments/core-spike/RESULTS.md` § 2 and `experiments/core-spike/src/proof.ts`, `docs/REQUIREMENT_SOURCE.md` § Proof architecture, § Framework stack (Credentials row), § Diagram text (Evidence record example, Sequence: pass test and proof), and `docs/MAIN_FLOW.md` § 5 (conflict C2).

---

## Requirement (Pillar 1 — Adapt the requirement)

Requirement § Proof architecture: "Credential — On ladder completion, an Open Badges 3.0 credential (a W3C
Verifiable Credential) signed with the issuer key, listing the evidence URLs"; "Revocation — Status list entry
per credential, so a credential can be revoked if cheating is found"; "The LLM is never in the trust path: every
proof is deterministic evidence plus a signature. Anyone can re-check a proof without trusting Idea Ladder's AI."
§ Framework stack, Credentials row: "Plain signed JSON for v1, upgrade at v2". Sequence: pass test and proof:
"13 API→Issuer after L4: issue credential · 14 Issuer→Store VC + status · 15 Issuer→PWA signed badge + public
verify URL". Conflict reading C2 (`docs/MAIN_FLOW.md` § 5): v1 proof = plain signed JSON, OB 3.0 at v2 (T024).
T001 result: "VERDICT signed proof: KEEP (untouched record verifies; 17/17 tamper cases rejected = 100%)".

**Restated intent** (Supervisor's interpretation):
> When a learner's evidence records cover every level L0–L4 of one ladder, the issuer signs one plain JSON
> credential (canonical JSON, SHA-256, Ed25519) that lists those evidence records, and gives it a status list
> entry so the owner can revoke it; anyone holding the published public key can verify it without our AI.

**Out of scope** (what this task explicitly does NOT do):
- The public verify page and live GitHub re-check (T020); the profile page (T021).
- Open Badges 3.0 / W3C VC 2.0 format, DIDs, JSON-LD (T024).
- Key rotation tooling beyond a `keyId` field; HSM/KMS storage.
- Any admin UI for revocation (a script only).
- Any change to how levels pass (T012, T013 own the evidence records).

**Requirement Refs**:
- FR-012: signed credential at ladder completion, plain signed JSON in v1, with a revocation status entry
- FR-011: the credential lists the append-only evidence records and their SHA-256 hashes
- NFR-002: LLM never in the trust path; re-checkable by anyone
- NFR-003: credential subject is the GitHub account signed in by OAuth
- US-006: a credential at ladder completion

### Requirement Fidelity Gate (sign off BEFORE implementation)

- [ ] Restated intent confirmed to match the user's request (by Supervisor / user — not the implementing agent)
- [ ] Domain terms align with `PROJECT_SPEC.md` glossary (`grill-with-docs` run if terminology was fuzzy)
- [ ] Every Acceptance Criterion below traces to a line in the Requirement
- [ ] All Requirement Refs exist in `PRD.md` and are fully covered by the Acceptance Criteria above

> An agent must NOT start implementing until this gate is checked. If anything here is unclear,
> STOP and ask the Supervisor (Karpathy: Think Before Coding).

---

## Dependencies & Reachability

**Depends on**: T012 — append-only evidence records with SHA-256 hashes exist per passed level (the credential lists them; L4 records come through T013 on top of T012's store)
**Entry point**: `issueCredential` (called by the Inngest function `credential.issue` on the event `evidence/recorded` that this task emits after each `writeEvidenceRecord` call); revocation script `pnpm revoke-credential`

> v2 task: planned only. Pickup waits for Gate 2 ("Others finish L1 without your help").

---

## Acceptance Criteria

| # | Criterion (testable) | Traces to requirement |
|---|----------------------|-----------------------|
| 1 | `issueCredential(learnerId, ladderId)` issues a credential only when passing evidence records exist for all of L0, L1, L2, L3, L4 of that ladder. With any level missing it returns `{ issued: false, reason: "ladder-incomplete", missing: string[] }` (the missing level names) and writes nothing. | "On ladder completion" |
| 2 | The credential body is plain JSON: `{ type: "IdeaLadderCredential", version: 1, id, learner: "github:<login>", learnerGithubId: <number>, ladder: "repo:<owner>/<name>@<sha>", levels: [{ level, evidenceId, evidenceHash, evidenceUrl }], issuer: { id, keyId }, issuedAt, status: { listUrl, index } }`, then `hash` = `sha256:<hex>` over canonical JSON of the body without `hash`/`signature`, and `signature` = base64url Ed25519 over the `hash` string. | "signed with the issuer key, listing the evidence URLs"; plain signed JSON |
| 3 | `verifyCredential(credential, publicKey)` returns true for the issued credential and false for every T001 tamper case applied to a credential (change any field, add field, remove field, bad hash, flipped signature bit, other public key, change a level and recompute hash). | "Anyone can re-check a proof" |
| 4 | Issuance is idempotent: a second call for the same learner + ladder returns the existing credential (same `id`, `hash`, `signature`); a unique constraint on (learner, ladder) enforces it under two concurrent calls. | append-only proof; one credential per completion |
| 5 | Each credential gets a unique `status.index` in a status list. `GET /status/:listId` returns `{ listId, updatedAt, revoked: [indexes], hash, signature }` signed with the same issuer key. `pnpm revoke-credential <credentialId> --reason "<text>"` adds the index; the list's signature verifies after revocation; revoking twice is a no-op. | "Status list entry per credential, so a credential can be revoked" |
| 6 | `GET /.well-known/ladder-issuer.json` returns `{ issuerId, keys: [{ keyId, alg: "Ed25519", publicKeyJwk }] }`. The private key is read only from env `LADDER_ISSUER_PRIVATE_KEY`; with it missing or malformed the app refuses to issue (`IssuerKeyError`) and no unsigned credential is stored. The private key never appears in DB rows, logs or API responses. | "signed with the issuer key"; NFR-002 |
| 7 | No LLM call is on the issuance path (no import of the AI SDK in the credential module — checked by a test that scans the module's import graph). | "The LLM is never in the trust path" |

---

## Evaluation & Acceptance (How we know the agent worked correctly)

### Success Criteria (observable, pass/fail)

| # | Given (input/state) | Expect (output/behavior) | How it's checked |
|---|---------------------|--------------------------|------------------|
| 1 | Test DB with evidence records for L0–L3 only | `{ issued: false, reason: "ladder-incomplete", missing: ["L4"] }`, 0 credential rows | vitest (integration, test DB) |
| 2 | Evidence for L0–L4, test key pair in env | credential row; `verifyCredential` → true with the published JWK | vitest |
| 3 | Issued credential with `levels[2].evidenceHash` changed | `verifyCredential` → false | vitest |
| 4 | Two concurrent `issueCredential` calls | exactly 1 row; both return the same `id` | vitest |
| 5 | `pnpm revoke-credential <id> --reason "cheating"` | index appears in `GET /status/:listId`; list signature verifies | vitest + command run |
| 6 | `LADDER_ISSUER_PRIVATE_KEY` unset | `IssuerKeyError`, 0 rows written | vitest |

### Verification Command (exact, runnable)

```bash
pnpm install --frozen-lockfile && pnpm db:migrate && pnpm test -- credential && pnpm lint
```

### Evidence (filled by reviewer at Stage 4/5)

> **Moved.** Filled by the reviewer at Stage 4/5 in `tasks/TASK_REVIEW_T019.md`.

---

## Demonstration

> **Moved.** See `tasks/TASK_REVIEW_T019.md`.

---

## Approach

**Pattern reference**: `experiments/core-spike/src/proof.ts` — `canonicalJson`, `hashRecord`, `signRecord`, `verifyRecord`, `tamperCases`; port them (do not import from `experiments/`) into the app's proof module, unchanged in behaviour.

**Vital slice**: issue + verify one credential for one completed ladder, with its status list entry.
**Cut list**:
- key rotation (one active `keyId`; the JWKS shape allows more later)
- revocation UI (script only)
- push notification "signed badge ready" (T020/T021 show the badge; the push channel is T015's)
- credential export as file (the JSON at its URL is the export)

Reuse T012's evidence record hashing: one canonical JSON function for records, credentials and status lists, so
T020 and outside checkers implement one algorithm. Sign the `hash` string (as T001 did), not pretty-printed
text. Store credentials append-only (insert only; revocation lives in the status list table, never as an
update of the credential row). Status list v1: a table of (listId, index, credentialId, revokedAt, reason);
the endpoint serialises revoked indexes sorted ascending and signs the document. Issue from an Inngest function
on the `evidence/recorded` event (emitted after `writeEvidenceRecord`; adding the emit is the only change to the T012 path) so a retry does not double-issue (AC 4 holds the guarantee, not the retry logic).
Load the private key once at boot with `createPrivateKey`; test keys come from `generateKeyPairSync('ed25519')`
in the test setup. Run `Skill({ skill: "migration-safety" })` for the new tables.

---

## Edge Case Checklist

- [ ] Ladder has a passing L3 record that was later superseded by a retake — use the passing record; never list a failing one
- [ ] Learner's GitHub login changed after passing — `learnerGithubId` carries the stable GitHub user id; `learner` keeps the login at issue time
- [ ] Two `evidence/recorded` events for the last level arrive together — unique constraint, one credential
- [ ] Evidence record hash in the DB does not match a recomputed hash — refuse to issue, log `evidence-hash-mismatch`
- [ ] Unicode in repo name or login (NFC vs NFD) — same hash (canonical JSON NFC)
- [ ] Revoked credential is still returned by its URL — yes, unchanged; revocation is only in the status list
- [ ] Status list index reuse after a failed insert — indexes come from a DB sequence, gaps allowed, never reused
- [ ] Private key passed in PEM vs raw base64 — accept PKCS#8 PEM only; reject others with `IssuerKeyError`

---

## Files to Change (Predicted)

| File | Change |
|------|--------|
| proof module in the app layout set by T003 (see `memory/codebase-map.md` once mapped) | port canonical JSON / hash / sign / verify; add `issueCredential`, `verifyCredential` |
| new migration in T003's migrations folder | `credentials` (append-only), `credential_status` tables |
| Inngest functions folder (T005) | `credential.issue` function on the `evidence/recorded` event; one emit line after `writeEvidenceRecord` |
| API routes (T003 layout) | `GET /status/:listId`, `GET /.well-known/ladder-issuer.json`, `GET /credentials/:id`, `GET /evidence/:id` (read-only JSON of one evidence record, the `evidenceUrl` target) |
| `scripts/revoke-credential.ts` + `package.json` script | `pnpm revoke-credential` |
| `.env.example` | `LADDER_ISSUER_PRIVATE_KEY=` (empty) with a comment |
| tests for the credential module | AC 1–7 |
| `tasks/TASK_REVIEW_T019.md` | Evidence (reviewer) |

## Files Must NOT Touch

| File | Reason |
|------|--------|
| `.claude/**`, `agents/**`, `skills/**`, `templates/**`, `AGENTS.md`, `CLAUDE.md` | kit |
| `PRD.md`, `PROJECT_SPEC.md`, `PROJECT_KANBAN.md` | Supervisor-owned |
| `experiments/**` | throwaway spikes; port, do not import |
| T012 evidence record table and the body of `writeEvidenceRecord` | append-only store owned by T012; read only (only the event emit after the call is added) |
| any real private key file | never commit secrets |

---

## Test Plan

vitest unit tests for canonical JSON, hash, sign, verify and the tamper cases (AC 2, 3, 7). Integration tests
against the test Postgres from T003 for issuance, idempotency, concurrency and revocation (AC 1, 4, 5, 6).
Real run: issue a credential on a seeded test ladder, fetch it and the issuer JWKS with `curl`, verify it with a
separate 20-line Node script that uses only `node:crypto` (proves outside re-checkability). Paste outputs.

---

## Completion Checklist

- [ ] Implementation done
- [ ] Self-review: `Skill({ skill: "code-review" })` run
- [ ] Security review: `Skill({ skill: "security-review" })` run (High risk)
- [ ] `Skill({ skill: "migration-safety" })` run (new tables)
- [ ] Lint passes (`pnpm lint`, `tsc --noEmit`)
- [ ] Tests written AND pass — output pasted into `tasks/TASK_REVIEW_T019.md` Evidence (Hard-Stop Gate 5)
- [ ] `Skill({ skill: "verify" })` run — headless auto verify
- [ ] Supervisor notified: task ready for Stage 4 review
