// T009 AC 5-7: measures the answer-key check on the independent seed set, three ways: (a) code check alone, (b) blind
// solver (model B) alone, (c) both (a question is kept only if both pass). Wrong keys are seeded as in T001: each
// distractor in turn becomes the key. Model B answers each item once (blindSolve never sees the key), so the answer
// for a wrong key d is the same call: the solver agrees with d only if it picked d.
// `bun run eval:blind-solver` is the live run on the owner's Claude login; the pure parts below are unit-tested.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkAnswerKey } from "../../src/server/answer-key-check.ts";
import { type BlindSolveResult, blindSolve } from "../../src/server/blind-solver.ts";
import type { Generate } from "../../src/server/model-a.ts";
import type { CallUsage } from "../../src/server/repo-reader.ts";

export type SeedItem = {
  id: string;
  kind: "span" | "numeric" | "paraphrase";
  question: string;
  options: string[];
  key: string;
  chunk: string;
  source: { repo: string; path: string; sha: string };
};
/** What model B did for one item: the option text it picked, or null when its call or answer failed. */
export type Choice = { id: string; picked: string | null; seed: number | null; failure?: string };
export type Policy = "code" | "blind" | "both";
export const POLICIES: Policy[] = ["code", "blind", "both"];
export const POLICY_TITLE: Record<Policy, string> = {
  code: "(a) code check alone",
  blind: "(b) blind solver alone",
  both: "(c) both (keep only if both pass)",
};

/** Pre-registered thresholds (TASK_GUIDE_T009), fixed before the first run. Do not tune after. */
export const THRESHOLDS = { catchRateMin: 0.9, falseRejectMax: 0.1 } as const;

export type Counts = { wrongTotal: number; caught: number; correctTotal: number; falseRejects: number };
export type PolicyMetrics = Counts & {
  catchRate: number;
  falseRejectRate: number;
  byKind: Record<string, Counts>;
  /** Seeded wrong keys the policy kept. */
  misses: { id: string; key: string }[];
  /** Correct keys the policy rejected. */
  falseRejectList: { id: string; key: string }[];
};
export type Measurement = Record<Policy, PolicyMetrics>;

const zero = (): Counts => ({ wrongTotal: 0, caught: 0, correctTotal: 0, falseRejects: 0 });

/** Does policy `p` keep the question with `key` as its answer key? */
function keeps(p: Policy, item: SeedItem, key: string, choice: Choice | undefined): boolean {
  const code = checkAnswerKey({ options: item.options, key, chunk: item.chunk }).pass;
  const blind = choice?.picked != null && choice.picked === key; // a failed call (null) never agrees
  return p === "code" ? code : p === "blind" ? blind : code && blind;
}

/** Catch rate and false-reject rate of each policy, with counts and per item kind. Pure arithmetic. */
export function measure(items: SeedItem[], choices: Choice[]): Measurement {
  const byId = new Map(choices.map((c) => [c.id, c]));
  const out = {} as Measurement;
  for (const p of POLICIES) {
    const m: PolicyMetrics = {
      ...zero(),
      catchRate: 0,
      falseRejectRate: 0,
      byKind: {},
      misses: [],
      falseRejectList: [],
    };
    for (const item of items) {
      const k = (m.byKind[item.kind] ??= zero());
      const choice = byId.get(item.id);
      m.correctTotal++;
      k.correctTotal++;
      if (!keeps(p, item, item.key, choice)) {
        m.falseRejects++;
        k.falseRejects++;
        m.falseRejectList.push({ id: item.id, key: item.key });
      }
      for (const d of item.options.filter((o) => o !== item.key)) {
        m.wrongTotal++;
        k.wrongTotal++;
        if (keeps(p, item, d, choice)) m.misses.push({ id: item.id, key: d });
        else {
          m.caught++;
          k.caught++;
        }
      }
    }
    m.catchRate = m.wrongTotal ? m.caught / m.wrongTotal : 0;
    m.falseRejectRate = m.correctTotal ? m.falseRejects / m.correctTotal : 0;
    out[p] = m;
  }
  return out;
}

const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
const meets = (m: Pick<PolicyMetrics, "catchRate" | "falseRejectRate">) =>
  m.catchRate >= THRESHOLDS.catchRateMin && m.falseRejectRate <= THRESHOLDS.falseRejectMax;

/** One verdict line per pre-registered threshold decision. */
export function verdictLines(m: Measurement): string[] {
  const rates = (x: PolicyMetrics) => `catch ${pct(x.catchRate)}, false-reject ${pct(x.falseRejectRate)}`;
  const both = m.both;
  const lines = [
    meets(both)
      ? `VERDICT code check + blind solver: KEEP (${rates(both)}; thresholds catch >= 90% and false-reject <= 10%)`
      : `VERDICT code check + blind solver: FAIL (${rates(both)}; thresholds catch >= 90% and false-reject <= 10%). Blind solver does not meet threshold: the Supervisor opens the entailment-check alternative`,
    `VERDICT blind solver alone: ${meets(m.blind) ? "MEETS" : "MISSES"} both thresholds (${rates(m.blind)})`,
    `VERDICT code check alone: ${meets(m.code) ? "MEETS" : "MISSES"} both thresholds (${rates(m.code)})`,
  ];
  if (meets(m.blind) && !meets(both))
    lines.push("DECISION INPUT: the blind solver alone meets both thresholds and the combined policy does not");
  return lines;
}

/** Items whose answer differs between two runs (AC 7). */
export function changedAnswers(previous: Choice[], current: Choice[]): { id: string; before: string | null; after: string | null }[] {
  const before = new Map(previous.map((c) => [c.id, c.picked]));
  return current
    .filter((c) => before.has(c.id) && before.get(c.id) !== c.picked)
    .map((c) => ({ id: c.id, before: before.get(c.id) ?? null, after: c.picked }));
}

export type RunFacts = {
  timestamp: string;
  backend: "api" | "claude-code";
  models: string[];
  seedSha256: string;
  items: SeedItem[];
  choices: Choice[];
  usages: CallUsage[];
  previous?: { file: string; changed: ReturnType<typeof changedAnswers> };
};

/** The markdown report (AC 6). */
export function renderReport(f: RunFacts): string {
  const m = measure(f.items, f.choices);
  const c = (x: Counts, side: "wrong" | "correct") =>
    side === "wrong"
      ? `${x.caught} / ${x.wrongTotal} (${x.wrongTotal ? pct(x.caught / x.wrongTotal) : "n/a"})`
      : `${x.falseRejects} / ${x.correctTotal} (${x.correctTotal ? pct(x.falseRejects / x.correctTotal) : "n/a"})`;
  const calls = f.usages.length;
  const sum = (pick: (u: CallUsage) => number) => f.usages.reduce((n, u) => n + pick(u), 0);
  const per100 = (n: number) => (f.items.length ? ((100 * n) / f.items.length).toFixed(1) : "n/a");
  const kinds = [...new Set(f.items.map((i) => i.kind))];
  const failed = f.choices.filter((x) => x.picked === null);
  const lines = [
    `# T009 blind solver measurement`,
    "",
    `Generated ${f.timestamp} by \`bun run eval:blind-solver\`. Back end \`${f.backend}\`, model(s) reported by the calls: ${f.models.join(", ") || "none"}. Seed set: ${f.items.length} MCQs, sha256 \`${f.seedSha256}\` (hash-locked, never edited after the first run).`,
    "",
    "## Verdicts (thresholds pre-registered in TASK_GUIDE_T009, not tuned after the run)",
    "",
    ...verdictLines(m),
    "",
    "## Policies",
    "",
    "| Policy | Wrong keys caught | Correct keys rejected (false reject) |",
    "|---|---|---|",
    ...POLICIES.map((p) => `| ${POLICY_TITLE[p]} | ${c(m[p], "wrong")} | ${c(m[p], "correct")} |`),
    "",
    "## By item kind",
    "",
    "| Kind | " + POLICIES.map((p) => `${POLICY_TITLE[p]} caught / false-rejected`).join(" | ") + " |",
    "|---|" + POLICIES.map(() => "---|").join(""),
    ...kinds.map(
      (k) =>
        `| ${k} | ` +
        POLICIES.map((p) => {
          const x = m[p].byKind[k] ?? zero();
          return `${x.caught} / ${x.wrongTotal}; ${x.falseRejects} / ${x.correctTotal}`;
        }).join(" | ") +
        " |",
    ),
    "",
    "## Model B cost (reported only; T017 sets the cap)",
    "",
    `Model B calls: ${calls} for ${f.items.length} questions = ${per100(calls)} per 100 questions. Tokens per 100 questions: input ${per100(sum((u) => u.inputTokens))}, cached input ${per100(sum((u) => u.cachedInputTokens))}, output ${per100(sum((u) => u.outputTokens))}. USD: ${f.backend === "claude-code" ? "n/a (subscription)" : "see the cost log"}.`,
    "",
    "## Determinism (AC 7)",
    "",
    f.backend === "api"
      ? "Model B ran at temperature 0 on the `api` back end."
      : "The `claude-code` back end has no temperature flag, so model B ran at the CLI default; answers can differ between runs.",
    f.previous
      ? f.previous.changed.length
        ? `Compared with ${f.previous.file}, ${f.previous.changed.length} item(s) changed their answer: ${f.previous.changed.map((x) => `${x.id} (${x.before} -> ${x.after})`).join("; ")}.`
        : `Compared with ${f.previous.file}, no item changed its answer; the verdict lines are the same.`
      : "No earlier report was found, so no comparison was made. Run the command twice to compare.",
    "",
    `## Model B failures (counted as disagreement): ${failed.length}`,
    "",
    ...(failed.length ? failed.map((x) => `- \`${x.id}\`: ${x.failure ?? "no answer"}`) : ["none"]),
    "",
    "## Misses and false rejects",
    "",
    ...POLICIES.flatMap((p) => [
      `**${POLICY_TITLE[p]}** - kept wrong keys (${m[p].misses.length}): ${m[p].misses.map((x) => `${x.id}:\`${x.key}\``).join(", ") || "none"}`,
      "",
      `**${POLICY_TITLE[p]}** - rejected correct keys (${m[p].falseRejectList.length}): ${m[p].falseRejectList.map((x) => x.id).join(", ") || "none"}`,
      "",
    ]),
    "## Known limits (read before trusting the numbers)",
    "",
    "- The seeded wrong keys are synthetic: each distractor of the seed author's own MCQ becomes the key. The catch rate is an upper bound for real generator mistakes, which are subtler (T001 known limit).",
    "- The seed set was written by the same agent that wrote the code. It was committed and hash-locked before the first measurement run and is not edited after it.",
    "- Same-provider blind spots (the user accepted this trade-off on 2026-11-19): model B is a Claude model, so it shares Claude's blind spots. It is weaker than a second provider and still catches obvious wrong keys.",
    "- Paraphrase keys are rejected by the code check by design, so policy (c) inherits that false-reject; see the per-kind table.",
    "- The seed set is small, so a rate moves by about 2 points per item; the numbers are not tight.",
  ];
  return lines.join("\n") + "\n";
}

// --- the live run ------------------------------------------------------------------------------------------------

const SEED_DIR = join(import.meta.dir, "..", "seed");
const REPORT_DIR = join(import.meta.dir, "..", "reports");

/** Reads the seed set and refuses to go on when its sha256 differs from the lock file. */
export function loadSeed(dir = SEED_DIR): { items: SeedItem[]; sha256: string } {
  const raw = readFileSync(join(dir, "blind-solver-seed.json"), "utf8");
  const lock = readFileSync(join(dir, "blind-solver-seed.sha256"), "utf8").trim().split(/\s+/)[0];
  const sha256 = createHash("sha256").update(raw).digest("hex");
  if (sha256 !== lock)
    throw new Error(`seed set hash mismatch: blind-solver-seed.json is ${sha256}, the lock says ${lock}. The seed set was edited; no call was made`);
  return { items: JSON.parse(raw) as SeedItem[], sha256 };
}

/** What is missing for model B, in words, or an empty list. Makes no model call. */
export async function missingCredentials(env: Record<string, string | undefined>, which = Bun.which): Promise<string[]> {
  const backend = env.MODEL_B_BACKEND || "claude-code";
  if (backend === "api") return ["ANTHROPIC_API_KEY", "MODEL_B_ID"].filter((n) => !env[n]).map((n) => `${n} (MODEL_B_BACKEND=api)`);
  if (backend !== "claude-code") return ["MODEL_B_BACKEND must be claude-code or api"];
  const bin = which("claude");
  if (!bin) return ["the `claude` CLI is not installed or not on PATH (install Claude Code and sign in)"];
  const status = Bun.spawnSync([bin, "auth", "status"], { stdout: "pipe", stderr: "pipe" });
  let loggedIn = false;
  try {
    loggedIn = status.exitCode === 0 && JSON.parse(status.stdout.toString()).loggedIn === true;
  } catch {}
  return loggedIn ? [] : ["a Claude login (run `claude` and sign in; `claude auth status` does not report loggedIn)"];
}

function latestPrevious(): { file: string; choices: Choice[] } | undefined {
  if (!existsSync(REPORT_DIR)) return undefined;
  const file = readdirSync(REPORT_DIR)
    .filter((f) => /^blind-solver-.*\.json$/.test(f))
    .sort()
    .at(-1);
  return file ? { file, choices: JSON.parse(readFileSync(join(REPORT_DIR, file), "utf8")).choices as Choice[] } : undefined;
}

async function main() {
  const env = process.env;
  const { items, sha256 } = loadSeed();
  const missing = await missingCredentials(env);
  if (missing.length) {
    console.error(`eval:blind-solver cannot run; missing: ${missing.join("; ")}. No model call was made.`);
    process.exit(1);
  }
  const { createModelA } = await import("../../src/server/model-a.ts");
  const { loadPrices, logStepCost } = await import("./cost.ts");
  const backend = (env.MODEL_B_BACKEND || "claude-code") as "api" | "claude-code";
  let generate: Generate;
  if (backend === "api") {
    const modelId = env.MODEL_B_ID as string;
    if (!Object.hasOwn(loadPrices(), modelId)) {
      console.error(`eval:blind-solver cannot run: MODEL_B_ID "${modelId}" has no price in eval/prices.json. No model call was made.`);
      process.exit(1);
    }
    const { createAnthropic } = await import("@ai-sdk/anthropic");
    generate = createModelA({
      backend: "api",
      model: createAnthropic({ apiKey: env.ANTHROPIC_API_KEY, baseURL: "https://api.anthropic.com/v1" })(modelId),
    }).generate;
  } else generate = createModelA({ backend: "claude-code", modelId: env.MODEL_B_ID || undefined }).generate;

  const timestamp = new Date().toISOString();
  const runId = `eval-blind-solver-${timestamp.replace(/[-:.]/g, "")}`;
  console.error(`blind-solver: back end ${backend}, ${items.length} items, cost log run id ${runId}`);
  const usages: CallUsage[] = [];
  const choices: Choice[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < items.length; i = next++) {
      const item = items[i] as SeedItem;
      let r: BlindSolveResult | undefined;
      let failure: string | undefined;
      for (let attempt = 0; attempt < 2 && !r; attempt++) {
        try {
          r = await blindSolve({
            question: item.question,
            options: item.options,
            chunk: item.chunk,
            generate,
            onUsage: (u) => {
              usages.push(u);
              logStepCost({ runId, ladderKey: `${item.source.repo}@${item.source.sha}`, step: "blind-solve", backend, ...u });
            },
          });
        } catch (err) {
          failure = err instanceof Error ? err.message : String(err);
        }
      }
      choices[i] = { id: item.id, picked: r ? (item.options[r.answerIndex] ?? null) : null, seed: r?.seed ?? null, ...(r ? {} : { failure }) };
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, worker));

  const prev = latestPrevious();
  const facts: RunFacts = {
    timestamp,
    backend,
    models: [...new Set(usages.map((u) => u.model))],
    seedSha256: sha256,
    items,
    choices,
    usages,
    ...(prev ? { previous: { file: prev.file, changed: changedAnswers(prev.choices, choices) } } : {}),
  };
  mkdirSync(REPORT_DIR, { recursive: true });
  const stem = join(REPORT_DIR, `blind-solver-${timestamp.replace(/[-:.]/g, "")}`);
  writeFileSync(`${stem}.md`, renderReport(facts));
  writeFileSync(`${stem}.json`, JSON.stringify({ timestamp, backend, seedSha256: sha256, choices }, null, 2) + "\n");
  for (const line of verdictLines(measure(items, choices))) console.log(line);
  console.log(`report: ${stem}.md`);
}

if (import.meta.main) await main();
