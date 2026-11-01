import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { confidenceScore } from "./confidence.js";
import { loadSnapshot, REPOS } from "./fixture-fetch.js";
import { measure, type Mcq, type Metrics } from "./measure.js";
import { hashRecord, signRecord, tamperCases, verifyRecord, type EvidenceRecord } from "./proof.js";

// Evidence record example, docs/REQUIREMENT_SOURCE.md § Diagram text.
export const EXAMPLE_RECORD: EvidenceRecord = {
  learner: "github:thunderkds",
  ladder: "repo:owner/name@3f2a9c1",
  level: "L2",
  test: "artifact+diff-questions",
  evidence: { branch: "https://github.com/thunderkds/name/tree/add-retry", commit: "9b1e2d4", diffQuestions: { asked: 5, correct: 4, pass: 4 } },
  verifiedBy: "verifier@1.3.0",
  verifiedAt: "2026-11-01T09:12:00Z",
};

const pct = (x: number) => (100 * x).toFixed(1) + "%";
// Pre-registered thresholds, TASK_GUIDE_T001 § Evaluation. Fixed before the first run.
export const THRESHOLDS = { catchRateMin: 0.9, falseRejectMax: 0.1, maxApiCalls: 20 };

export function keyVerdict(m: Pick<Metrics, "catchRate" | "falseRejectRate">): { keep: boolean; line: string } {
  const keep = m.catchRate >= THRESHOLDS.catchRateMin && m.falseRejectRate <= THRESHOLDS.falseRejectMax;
  return {
    keep,
    line: keep
      ? `VERDICT answer-key code check: KEEP (catch ${pct(m.catchRate)} >= 90% and false-reject ${pct(m.falseRejectRate)} <= 10%)`
      : `VERDICT answer-key code check: FAIL (catch ${pct(m.catchRate)} vs >= 90%; false-reject ${pct(m.falseRejectRate)} vs <= 10%). Code check alone is insufficient: blind solver or entailment check required`,
  };
}

export async function buildResults(now = new Date()): Promise<string> {
  const seed = JSON.parse(readFileSync(new URL("../fixtures/mcq-seed.json", import.meta.url), "utf8")) as Mcq[];
  const m = measure(seed);
  const kv = keyVerdict(m);
  const byId = new Map(seed.map((q) => [q.id, q]));

  // Proof
  const { privateKey, publicKey } = generateKeyPairSync("ed25519"); // in memory only
  const other = generateKeyPairSync("ed25519");
  const signed = signRecord(EXAMPLE_RECORD, privateKey);
  const untouchedOk = verifyRecord(signed, publicKey);
  const cases = [
    ...tamperCases(signed),
    { name: "verify with another public key", record: signed, key: other.publicKey },
    { name: "tamper level L2->L3 and recompute hash", record: (() => { const f = { ...signed, level: "L3" }; f.hash = hashRecord(f); return f; })() },
  ] as Array<{ name: string; record: typeof signed; key?: typeof publicKey }>;
  const results = cases.map((c) => ({ name: c.name, rejected: !verifyRecord(c.record, c.key ?? publicKey) }));
  const rejected = results.filter((r) => r.rejected).length;
  const proofOk = untouchedOk && rejected === results.length;
  const shuffledHashSame = hashRecord({ ...EXAMPLE_RECORD, evidence: { diffQuestions: EXAMPLE_RECORD.evidence.diffQuestions, commit: EXAMPLE_RECORD.evidence.commit, branch: EXAMPLE_RECORD.evidence.branch } }) === hashRecord(EXAMPLE_RECORD);

  // GitHub
  const repoRows: string[] = [];
  let githubOk = true;
  for (const r of REPOS) {
    const { snapshot: s, calls, recordedAt } = await loadSnapshot(r);
    const c = confidenceScore(s);
    if (calls > THRESHOLDS.maxApiCalls || !/^[0-9a-f]{40}$/.test(s.sha)) githubOk = false;
    repoRows.push(`| ${r} | \`${s.sha}\` | ${s.defaultBranch} | ${calls} | ${s.readme.length} | ${s.openIssues} | ${s.goodFirstIssues} | ${s.depFiles.join(", ") || "none"} | ${c.score} ${c.level}${c.fallbackToConcepts ? " (fallback to concepts)" : ""} | ${c.reasons.join("; ")} | ${recordedAt.slice(0, 19)}Z |`);
  }

  const L: string[] = [];
  L.push("# T001 core spike — RESULTS", "", `Generated ${now.toISOString()} by \`pnpm experiment\` (offline: recorded GitHub fixtures, no LLM, no network).`, "");
  L.push("## Verdicts (thresholds pre-registered in TASK_GUIDE_T001, not tuned after the run)", "");
  L.push(kv.line);
  L.push(proofOk
    ? `VERDICT signed proof: KEEP (untouched record verifies; ${rejected}/${results.length} tamper cases rejected = 100%)`
    : `VERDICT signed proof: FAIL (untouched verifies: ${untouchedOk}; ${rejected}/${results.length} tamper cases rejected). Plain signed JSON not viable as specified`);
  L.push(githubOk
    ? `VERDICT GitHub read: KEEP (all ${REPOS.length} repos gave a 40-hex SHA + snapshot in <= ${THRESHOLDS.maxApiCalls} API calls each)`
    : `VERDICT GitHub read: FAIL (a repo exceeded ${THRESHOLDS.maxApiCalls} calls or lacked a SHA). Needs token / different source`, "");

  L.push("## 1. Answer-key code check (AC 3)", "");
  L.push(`Seed set: ${seed.length} original MCQs (4 options), grounded in <= 300-char quotes of 3 recorded READMEs.`, "");
  L.push("| Metric | Count | Rate |", "|---|---|---|");
  L.push(`| Catch rate (seeded wrong keys rejected / all seeded wrong keys) | ${m.caught} / ${m.wrongTotal} | ${pct(m.catchRate)} |`);
  L.push(`| False-reject rate (correct keys rejected / all correct keys) | ${m.falseRejects} / ${m.correctTotal} | ${pct(m.falseRejectRate)} |`, "");
  L.push("By kind:", "", "| Kind | Wrong keys caught | Correct keys rejected |", "|---|---|---|");
  for (const [k, c] of Object.entries(m.byKind)) L.push(`| ${k} | ${c.caught} / ${c.wrongTotal} (${pct(c.caught / c.wrongTotal)}) | ${c.falseRejects} / ${c.correctTotal} |`);
  L.push("", `Misses (${m.misses.length}) — seeded wrong key that the check accepted:`, "");
  for (const x of m.misses) { const q = byId.get(x.id)!; L.push(`- \`${x.id}\` wrong key \`${x.key}\` (true key \`${q.key}\`) — ${q.question}`); }
  L.push("", `False rejects (${m.falseRejectList.length}) — correct key that the check rejected:`, "");
  for (const x of m.falseRejectList) { const q = byId.get(x.id)!; L.push(`- \`${x.id}\` key \`${x.key}\` [${q.kind}] — ${q.question}`); }

  L.push("", "## 2. Signed evidence record (AC 4, 5)", "");
  L.push(`- Record: example from docs/REQUIREMENT_SOURCE.md § Diagram text. Hash: \`${signed.hash}\``);
  L.push(`- Canonical JSON key-order independent: ${shuffledHashSame}`);
  L.push(`- Untouched record verifies: ${untouchedOk}`);
  L.push(`- Tamper cases rejected: ${rejected} / ${results.length}`, "");
  for (const r of results) L.push(`  - ${r.rejected ? "rejected" : "ACCEPTED (bad)"}: ${r.name}`);

  L.push("", "## 3. GitHub read + SHA pin + confidence (AC 6, 7, 8)", "");
  L.push("| Repo | Pinned SHA | Branch | API calls | README chars | Open issues | Good first issues | Dep files | Confidence | Reasons | Recorded |", "|---|---|---|---|---|---|---|---|---|---|---|");
  L.push(...repoRows);

  L.push("", "## Known limits (read before trusting the numbers)", "");
  L.push(
    "- The seeded wrong keys are synthetic: each distractor of my own MCQ becomes the key. The catch rate is an upper bound for real generator mistakes, which are subtler (a wrong key that paraphrases the chunk, or that appears in it).",
    `- The seed set is small (${seed.length} MCQs) and written by one author (an LLM-assisted agent) before the run; distractor quality drives the catch rate. No threshold or rule was changed after the first run.`,
    "- Most correct keys are literal spans. A real generator may write keys as paraphrases; those are false-rejected by design (see the `paraphrase` row). The false-reject rate depends on the span/paraphrase mix, which here is chosen by the author.",
    "- Case-insensitive matching means a wrong key that differs only by case (e.g. `window.Mitt` vs `window.mitt`) is accepted by design. The seed set has no such distractor, so this class is not measured.",
    "- All 3 v0 repos score `high` (0.9): none has a `good first issue`, all have a README >= 1,500 chars, open issues and a dependency file. The concept-fallback branch is covered by unit tests on hand-made snapshots only; no real v0 repo triggers it, and the rule does not flag `lukeed/dset` as thin.",
    "- The check is lexical: a key inside a negated sentence (\"there is no retry\") passes. Not solved, by design of the spike.",
    "- A distractor that also appears in the chunk passes the check. Only a blind solver or an entailment check can catch that class.",
    "- `_` counts as a word character, so a key wrapped in markdown emphasis (`_last_`) is rejected. Markup inside the chunk (backticks between words) also breaks multi-word keys.",
    "- Issue counts use only the first page (<= 100 issues, pull requests excluded). A repo with > 100 open issues reads as 100.",
    "- GitHub numbers come from fixtures recorded once, unauthenticated, on the date shown. SHAs move; the fixture pins them. 7 calls per repo are the count of the code path, not a measured latency or a rate-limit stress test.",
    "- Ed25519 keys are generated in memory per run; nothing is persisted. The record is plain signed JSON: no key distribution, revocation or issuer identity is tested.",
    "- The LLM blind solver, embedding dedupe and FSRS are not measured (out of scope).",
    "",
  );
  return L.join("\n");
}
