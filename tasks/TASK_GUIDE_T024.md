# TASK_GUIDE — T024: Upgrade proof to Open Badges 3.0 / W3C VC 2.0
**Date**: 2026-11-01
**Complexity Level**: C3
**Risk Level**: High
**Priority**: P2
**Assigned agent**: backend-developer
**Agent guide**: `agents/backend.md`

---

## Mandatory Startup (Do Not Skip)

Before writing any code:
1. Read `PROJECT_SPEC.md`
2. Read the memory slice in your spawn prompt (`<!-- memory-slice -->`). Read `memory/MEMORY.md` in full only if your work reaches a file, hook, skill or decision the slice does not cover
3. Read this file completely
4. Read `agents/backend.md`
5. Note the **Complexity Level** above and apply the matching process from the Complexity matrix in `agents/backend.md` (C3: decompose into subtasks; `brainstorming` mandatory; adversarial `verify`)
6. C3: read `memory/codebase-map.md` (the app layout set by T003, once mapped). Read `tasks/TASK_GUIDE_T019.md` and `tasks/TASK_GUIDE_T020.md` (the v1 credential, status list and verify page this task upgrades), `docs/REQUIREMENT_SOURCE.md` § Proof architecture, § Framework stack (Credentials row), § Alternatives to investigate (Proof format row), and `docs/MAIN_FLOW.md` § 5 (conflict C2).

---

## Requirement (Pillar 1 — Adapt the requirement)

Requirement § Proof architecture: "Credential — On ladder completion, an Open Badges 3.0 credential (a W3C
Verifiable Credential) signed with the issuer key, listing the evidence URLs — OB 3.0 / VC 2.0"; "Revocation —
Status list entry per credential ... — VC status list". § Framework stack, Credentials row: "Open Badges 3.0 issuer
(W3C Verifiable Credentials signing) — Portable, cryptographically verifiable proof — Plain signed JSON for v1,
upgrade at v2". Sequence: pass test and proof: "Issuer (OB 3.0 signer)"; "14 Issuer→Store VC + status".
Conflict reading C2 (`docs/MAIN_FLOW.md` § 5): "v1 = plain signed JSON (T001 tested this); OB 3.0 at v2".
§ Alternatives, Proof format: "Switch if — Nobody shares or checks proofs".

**Restated intent** (Supervisor's interpretation):
> New credentials are issued as Open Badges 3.0 `OpenBadgeCredential`s (W3C VC Data Model 2.0) that a standard
> outside verifier accepts, with revocation through a W3C Bitstring Status List; every v1 plain signed JSON
> credential already issued stays verifiable on the same verify page.

**Out of scope** (what this task explicitly does NOT do):
- Re-issuing or converting v1 credentials (they stay as issued; an optional re-issue is a later task).
- Wallet integration, OpenID4VCI issuance protocol, selective disclosure.
- 1EdTech certification (only conformance with the published schema/validator is checked).
- Any change to how levels pass or how evidence records are written.

**Requirement Refs**:
- FR-012: credential at ladder completion, Open Badges 3.0 at v2, with a revocation status entry
- FR-013: the public verify page checks the (new format) signature and re-checks GitHub evidence live
- NFR-002: LLM never in the trust path; re-checkable by anyone
- US-006: a credential at ladder completion
- US-007: the proof checker trusts the proof without trusting the AI

### Requirement Fidelity Gate (sign off BEFORE implementation)

- [ ] Restated intent confirmed to match the user's request (by Supervisor / user — not the implementing agent)
- [ ] Domain terms align with `PROJECT_SPEC.md` glossary (`grill-with-docs` run if terminology was fuzzy)
- [ ] Every Acceptance Criterion below traces to a line in the Requirement
- [ ] All Requirement Refs exist in `PRD.md` and are fully covered by the Acceptance Criteria above

> An agent must NOT start implementing until this gate is checked. If anything here is unclear,
> STOP and ask the Supervisor (Karpathy: Think Before Coding).

---

## Dependencies & Reachability

**Depends on**: T019 — v1 issuer key, credential issuance, status list and `issueCredential` call site exist; T020 — AC 6 extends the public verify page
**Entry point**: `issueOpenBadgeCredential` (called by the Inngest function `credential.issue` in place of the v1 issuer when `CREDENTIAL_FORMAT=ob3`)

> AC 6 extends the public verify page; if that page is not merged at pickup, AC 6 and Success 5 are blocked — report it, do not build the page here.
> v2 task: planned only. Pickup waits for Gate 2, and the § Alternatives "Proof format" test (ask 5 to 10 learners or hiring managers what they would trust) should be read before pickup.

---

## Acceptance Criteria

| # | Criterion (testable) | Traces to requirement |
|---|----------------------|-----------------------|
| 1 | `issueOpenBadgeCredential` produces a credential with `@context` = the VC 2.0 context then the OB 3.0 context (exact URLs copied from the 1EdTech OB 3.0 spec, not guessed), `type` = `["VerifiableCredential", "OpenBadgeCredential"]`, `issuer` = an OB `Profile` with `id`, `credentialSubject.achievement` describing the ladder (repo + pinned SHA), and `evidence[]` with one entry per passed level whose `id` is the evidence record URL and which carries the record's SHA-256 hash. | "OB 3.0 credential ... listing the evidence URLs" |
| 2 | The credential validates against the OB 3.0 JSON Schema for `AchievementCredential`/`OpenBadgeCredential` published by 1EdTech (schema file vendored with its source URL and retrieval date). | "Open Badges 3.0" |
| 3 | The credential is secured with the mechanism chosen in the brainstorm (Data Integrity `eddsa-rdfc-2022` or VC-JOSE-COSE with EdDSA), signed with the T019 issuer key or a new key published in the issuer's verification document; an independent library (not the issuing code) verifies it in a test. | "signed with the issuer key"; "Portable, cryptographically verifiable proof" |
| 4 | `credentialStatus` is a `BitstringStatusListEntry` pointing at a `BitstringStatusListCredential` the app serves and signs; revoking (`pnpm revoke-credential`) flips the bit, and the independent verifier then reports the credential revoked. | "VC status list" |
| 5 | Every tamper case from T019 AC 3 applied to an OB 3.0 credential makes verification fail. | NFR-002 |
| 6 | The verify page (T020) accepts both formats: a v1 plain signed JSON credential still shows `Signature valid` with its v1 key; an OB 3.0 credential shows the same verdict lines; the live GitHub re-check runs for both. T020's existing e2e tests pass unchanged. | "upgrade at v2" without breaking v1 proofs |
| 7 | With `CREDENTIAL_FORMAT` unset the app keeps issuing v1 credentials (default stays v1 until the user switches); with `ob3` it issues OB 3.0. | safe rollout |
| 8 | No network fetch of a JSON-LD context at verify time: contexts are pinned locally with their hashes; an unknown context URL makes verification fail with `unknown-context`. | integrity of the trust path |

---

## Evaluation & Acceptance (How we know the agent worked correctly)

### Success Criteria (observable, pass/fail)

| # | Given (input/state) | Expect (output/behavior) | How it's checked |
|---|---------------------|--------------------------|------------------|
| 1 | Completed test ladder, `CREDENTIAL_FORMAT=ob3` | credential passes the vendored OB 3.0 JSON Schema | vitest (ajv) |
| 2 | Same credential | independent verifier library → verified | vitest |
| 3 | Same credential, `credentialSubject.achievement.name` changed | verifier → not verified | vitest |
| 4 | `pnpm revoke-credential <id>` | independent verifier → status revoked | vitest + command run |
| 5 | v1 credential from T019 fixtures on `/verify/:credentialId` | `Signature valid` | Playwright (T020 suite) |
| 6 | Credential with an extra unknown `@context` URL | `unknown-context`, not verified, no network request | vitest (network blocked) |
| 7 | `CREDENTIAL_FORMAT` unset | v1 credential issued | vitest |

### Verification Command (exact, runnable)

```bash
pnpm install --frozen-lockfile && pnpm db:migrate && pnpm test -- credential && pnpm test -- openbadge && pnpm test:e2e -- verify-page && pnpm lint
```

### Evidence (filled by reviewer at Stage 4/5)

> **Moved.** Filled by the reviewer at Stage 4/5 in `tasks/TASK_REVIEW_T024.md`.

---

## Demonstration

> **Moved.** See `tasks/TASK_REVIEW_T024.md`.

---

## Approach

**Pattern reference**: T019's credential module (issuance call site, idempotency, status list, `pnpm revoke-credential`) and its tamper-case test list; T020's verify page for the format switch.

**Vital slice**: one schema-valid, independently verifiable OB 3.0 credential with a working status list entry, and v1 credentials still verifying.
**Cut list**:
- re-issue of v1 credentials as OB 3.0
- DID methods beyond the one picked for the issuer (for example `did:web` only)
- wallet / OpenID4VCI delivery
- second securing mechanism (pick one)

C3 process: run `Skill({ skill: "brainstorming" })` first and decompose into subtasks the Supervisor can track:
(a) securing mechanism and libraries — compare Data Integrity `eddsa-rdfc-2022` (JSON-LD canonicalisation, needs
pinned contexts) with VC-JOSE-COSE (JWT, simpler, no RDF canonicalisation) on library maturity, outside-verifier
support and code size; (b) issuer identity (`did:web` on the app domain vs an HTTPS issuer `Profile` URL with a
verification method); (c) data mapping from the v1 credential to OB 3.0; (d) Bitstring Status List; (e) verify page
format switch. Pin every library to an exact version published at least 2 weeks before pickup; check each
library's licence. Keep the v1 code path; the format is a switch, not a rewrite. Store OB 3.0 credentials
append-only next to v1 rows with a `format` column; run `Skill({ skill: "migration-safety" })`.

---

## Edge Case Checklist

- [ ] JSON-LD context fetched from the network at verify time — forbidden; pinned document loader only
- [ ] RDF canonicalisation differs between libraries for Unicode strings — test NFC/NFD repo names with the independent verifier
- [ ] Issuer key rotation after OB 3.0 issue — old credentials verify by `verificationMethod` id; publish old keys
- [ ] Bitstring status list compressed size and index range (minimum list length from the W3C spec) — follow the spec value, test index 0 and the last index
- [ ] `validFrom` / `issuanceDate` naming differs between VC 1.1 and 2.0 — use VC 2.0 names only
- [ ] Evidence record URL changes domain later — `evidence[].id` is the URL at issue time; the hash is the integrity check
- [ ] Outside verifier sees a v1 credential — page and doc explain v1 is plain signed JSON with its own steps

---

## Files to Change (Predicted)

| File | Change |
|------|--------|
| proof module from T019 (app layout set by T003, see `memory/codebase-map.md` once mapped) | `issueOpenBadgeCredential`, OB 3.0 verify, format switch |
| status list module from T019 | Bitstring Status List credential |
| verify page from T020 | format detection; v1 path unchanged |
| new migration in T003's migrations folder | `format` column on credentials, bitstring list storage |
| vendored OB 3.0 schema + pinned JSON-LD contexts (with source URL and SHA-256) | AC 2, 8 |
| `.env.example` | `CREDENTIAL_FORMAT=` (empty = v1) |
| tests `openbadge` + T020 e2e suite | AC 1–8 |
| `tasks/TASK_REVIEW_T024.md` | Evidence (reviewer) |

## Files Must NOT Touch

| File | Reason |
|------|--------|
| `.claude/**`, `agents/**`, `skills/**`, `templates/**`, `AGENTS.md`, `CLAUDE.md` | kit |
| `PRD.md`, `PROJECT_SPEC.md`, `PROJECT_KANBAN.md` | Supervisor-owned |
| `experiments/**` | throwaway spikes |
| existing v1 credential rows and v1 verify algorithm | already-issued proofs must keep verifying |
| evidence record table and writer (T012) | append-only; read only |

---

## Test Plan

vitest: schema validation (ajv on the vendored schema), independent-library verification, tamper cases,
status list revoke, unknown context with network blocked (Success 1–4, 6, 7). Playwright: T020's verify-page
suite plus one OB 3.0 credential (Success 5). Adversarial verify (C3): a second agent tries to forge or
replay a credential and to make the verify page accept a revoked one. Real run: issue one OB 3.0 credential
on the dev DB, verify it with the independent library from a separate script, paste the output.

---

## Completion Checklist

- [ ] Implementation done
- [ ] Self-review: `Skill({ skill: "code-review" })` run
- [ ] Security review: `Skill({ skill: "security-review" })` run (High risk)
- [ ] `Skill({ skill: "migration-safety" })` run (credential format column, status list storage)
- [ ] Lint passes (`pnpm lint`, `tsc --noEmit`)
- [ ] Tests written AND pass — output pasted into `tasks/TASK_REVIEW_T024.md` Evidence (Hard-Stop Gate 5)
- [ ] `Skill({ skill: "verify" })` run — headless auto verify (adversarial at C3)
- [ ] Supervisor notified: task ready for Stage 4 review
