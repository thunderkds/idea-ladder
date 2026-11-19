import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { scoreConcepts, scoreCoreFiles } from "./scorers.ts";
import type { Fixture, GoldenEntry } from "./schema.ts";
import type { MeasuredSubject, Subject } from "./subject.ts";

export const REPORTS_DIR = join(import.meta.dir, "..", "reports");

export type Step = "core-files" | "concepts";
export const STEPS: readonly Step[] = ["core-files", "concepts"];

interface RowBase { fullName: string; tier: string; predicted: string[]; missed: string[]; extra: string[]; error?: string }
export interface CoreFilesRow extends RowBase { recall: number; precision: number; modelCalls?: number; usd?: number | null; tokens?: number; hitLimit?: boolean; githubRateLimited?: number }
export interface ConceptsRow extends RowBase { overlap: number; modelCalls?: number; usd?: number | null; tokens?: number }

interface ReportBase { subject: string; generatedAt: string }
export interface CoreFilesReport extends ReportBase {
  step: "core-files";
  rows: CoreFilesRow[];
  /** `usd: null`: at least one run was on the subscription (claude-code); `tokens` is then the mean tokens. */
  mean: { recall: number; precision: number; usd?: number | null; tokens?: number; modelCalls?: number };
  /** Runs stopped by a step cap or token budget (subjects with run stats only). */
  hitLimitRuns?: number;
  /** Sum of the rows' `githubRateLimited` (subjects with run stats only). */
  githubRateLimited?: number;
  baseline?: { subject: string; meanRecall: number };
  verdicts?: string[];
}
export interface ConceptsReport extends ReportBase { step: "concepts"; rows: ConceptsRow[]; mean: { overlap: number; tokensPerCall?: number | null; usdPerCall?: number | null } }
export type Report = CoreFilesReport | ConceptsReport;

export interface RunOptions {
  subject: Subject;
  repos: GoldenEntry[];
  loadFixture: (fullName: string) => Fixture;
  now?: () => Date;
}

const mean = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);

/** Runs a subject over the given golden repos (offline: fixtures only) and scores it against the labels. */
export async function runEval(o: RunOptions & { step: "core-files" }): Promise<CoreFilesReport>;
export async function runEval(o: RunOptions & { step: "concepts" }): Promise<ConceptsReport>;
export async function runEval(o: RunOptions & { step: Step }): Promise<Report> {
  const { step, subject, repos, loadFixture, now } = o;
  if (!STEPS.includes(step)) throw new Error(`unknown step "${String(step)}"; expected one of ${STEPS.join(", ")}`);
  const predict = step === "core-files" ? subject.coreFiles : subject.concepts;
  if (!predict) throw new Error(`subject "${subject.name}" does not implement the ${step} step`);
  const generatedAt = (now?.() ?? new Date()).toISOString();

  const rows = [];
  for (const e of repos) {
    const base = { fullName: e.fullName, tier: e.tier };
    const fixture = loadFixture(e.fullName); // a missing or corrupt fixture is an infrastructure error: let it throw
    let predicted: string[] = [];
    let error: string | undefined;
    try {
      predicted = await predict.call(subject, fixture);
    } catch (err) {
      error = (err as Error).message; // an error is a miss: scored as an empty prediction, reported on its row
    }
    const errField = error === undefined ? {} : { error };
    const stats = (subject as Partial<MeasuredSubject>).runStats?.(e.fullName);
    if (step === "core-files") rows.push({ ...base, predicted, ...scoreCoreFiles(predicted, e.expectedCoreFiles), ...errField, ...stats });
    else rows.push({ ...base, predicted, ...scoreConcepts(predicted, e.expectedConcepts), ...errField, ...(stats && { modelCalls: stats.modelCalls, usd: stats.usd, tokens: stats.tokens }) });
  }

  if (step === "core-files") {
    const r = rows as CoreFilesRow[];
    const withStats = r.filter((x) => x.usd !== undefined);
    const subscription = withStats.some((x) => x.usd === null);
    const statsPart = withStats.length === 0 ? {} : {
      ...(subscription
        ? { usd: null, tokens: mean(withStats.map((x) => x.tokens ?? 0)) }
        : { usd: mean(withStats.map((x) => x.usd ?? 0)) }),
      modelCalls: mean(withStats.map((x) => x.modelCalls ?? 0)),
    };
    return {
      step, subject: subject.name, generatedAt, rows: r,
      mean: { recall: mean(r.map((x) => x.recall)), precision: mean(r.map((x) => x.precision)), ...statsPart },
      ...(withStats.length === 0 ? {} : {
        hitLimitRuns: withStats.filter((x) => x.hitLimit).length,
        githubRateLimited: withStats.reduce((n, x) => n + (x.githubRateLimited ?? 0), 0),
      }),
    };
  }
  const r = rows as ConceptsRow[];
  const withStats = r.filter((x) => x.modelCalls !== undefined);
  const calls = withStats.reduce((n, x) => n + (x.modelCalls ?? 0), 0);
  const priced = withStats.filter((x) => typeof x.usd === "number");
  const pricedCalls = priced.reduce((n, x) => n + (x.modelCalls ?? 0), 0);
  const statsMean = withStats.length === 0 ? {} : {
    tokensPerCall: calls === 0 ? null : withStats.reduce((n, x) => n + (x.tokens ?? 0), 0) / calls,
    usdPerCall: pricedCalls === 0 ? null : priced.reduce((n, x) => n + (x.usd as number), 0) / pricedCalls,
  };
  return { step, subject: subject.name, generatedAt, rows: r, mean: { overlap: mean(r.map((x) => x.overlap)), ...statsMean } };
}

const f = (n: number) => n.toFixed(2);
const cell = (xs: string[]) => (xs.length === 0 ? "" : xs.map((x) => `\`${x}\``).join(", "));

export function renderMarkdown(report: Report): string {
  const lines = [`# Eval: ${report.step} · subject ${report.subject}`, "", `Generated ${report.generatedAt} · ${report.rows.length} repos`, ""];
  if (report.step === "core-files") {
    const st = report.mean.usd !== undefined;
    const usd = (u: number | null | undefined, tokens: number | undefined) =>
      u === undefined ? "" : u === null ? `n/a (subscription), ${Math.round(tokens ?? 0)} tokens` : u.toFixed(4);
    const statCells = (r: CoreFilesRow) => (st ? ` ${r.modelCalls ?? ""} | ${usd(r.usd, r.tokens)} | ${r.hitLimit ? "yes" : ""} | ${r.githubRateLimited ?? 0} |` : "");
    lines.push(`| Repo | Tier | Recall | Precision | Missed | Extra |${st ? " Model calls | USD | Hit limit | GitHub rate-limited |" : ""}`, `|---|---|---|---|---|---|${st ? "---|---|---|---|" : ""}`);
    for (const r of report.rows) lines.push(`| ${r.fullName} | ${r.tier} | ${f(r.recall)} | ${f(r.precision)} | ${cell(r.missed)} | ${cell(r.extra)}${r.error ? ` (error: ${r.error})` : ""} |${statCells(r)}`);
    lines.push(`| **mean** | | ${f(report.mean.recall)} | ${f(report.mean.precision)} | | |${st ? ` ${f(report.mean.modelCalls ?? 0)} | ${usd(report.mean.usd, report.mean.tokens)} | ${report.hitLimitRuns} of ${report.rows.length} | ${report.githubRateLimited ?? 0} |` : ""}`);
    if (report.baseline) lines.push("", `Baseline \`${report.baseline.subject}\` mean recall: ${f(report.baseline.meanRecall)}`);
    if (report.verdicts?.length) lines.push("", ...report.verdicts.map((v) => `- ${v}`));
  } else {
    const st = report.mean.tokensPerCall !== undefined;
    const n = (v: number | null | undefined, d: number) => (v === null || v === undefined ? "n/a" : v.toFixed(d));
    lines.push(`| Repo | Tier | Overlap | Missed | Extra |${st ? " Model calls | Tokens | USD |" : ""}`, `|---|---|---|---|---|${st ? "---|---|---|" : ""}`);
    for (const r of report.rows) lines.push(`| ${r.fullName} | ${r.tier} | ${f(r.overlap)} | ${cell(r.missed)} | ${cell(r.extra)}${r.error ? ` (error: ${r.error})` : ""} |${st ? ` ${r.modelCalls ?? 0} | ${r.tokens ?? 0} | ${n(r.usd, 4)} |` : ""}`);
    lines.push(`| **mean** | | ${f(report.mean.overlap)} | | |${st ? ` | ${n(report.mean.tokensPerCall, 0)} per call | ${n(report.mean.usdPerCall, 4)} per call |` : ""}`);
  }
  return `${lines.join("\n")}\n`;
}

/** Writes `<step>-<timestamp>.json` and `.md` into `dir`. */
export function writeReport(report: Report, dir = REPORTS_DIR): { jsonPath: string; mdPath: string } {
  mkdirSync(dir, { recursive: true });
  const stamp = report.generatedAt.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const base = join(dir, `${report.step}-${stamp}`);
  writeFileSync(`${base}.json`, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(`${base}.md`, renderMarkdown(report));
  return { jsonPath: `${base}.json`, mdPath: `${base}.md` };
}

const SUBJECT_NAME = /^[a-z0-9][a-z0-9-]*$/;

/** `--subject <name>` resolves to `src/subjects/<name>.ts`; bare names only, so a flag cannot load an arbitrary file. */
export async function loadSubject(name: string): Promise<Subject> {
  if (!SUBJECT_NAME.test(name)) throw new Error(`invalid subject name "${name}" (lower-case letters, digits and hyphens only)`);
  let mod: { default?: Subject };
  try {
    mod = (await import(`./subjects/${name}.ts`)) as { default?: Subject };
  } catch (e) {
    throw new Error(`subject "${name}" not found in src/subjects/: ${(e as Error).message}`);
  }
  const s = mod.default;
  if (!s || typeof s.name !== "string") throw new Error(`subject "${name}" must default-export a Subject`);
  return s;
}
