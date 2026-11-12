import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { scoreConcepts, scoreCoreFiles } from "./scorers.ts";
import type { Fixture, GoldenEntry } from "./schema.ts";
import type { MeasuredSubject, Subject } from "./subject.ts";

export const REPORTS_DIR = join(import.meta.dir, "..", "reports");

export type Step = "core-files" | "concepts";
export const STEPS: readonly Step[] = ["core-files", "concepts"];

interface RowBase { fullName: string; tier: string; predicted: string[]; missed: string[]; extra: string[]; error?: string }
export interface CoreFilesRow extends RowBase { recall: number; precision: number; modelCalls?: number; usd?: number; hitLimit?: boolean }
export interface ConceptsRow extends RowBase { overlap: number }

interface ReportBase { subject: string; generatedAt: string }
export interface CoreFilesReport extends ReportBase {
  step: "core-files";
  rows: CoreFilesRow[];
  mean: { recall: number; precision: number; usd?: number; modelCalls?: number };
  /** Runs stopped by a step cap or token budget (subjects with run stats only). */
  hitLimitRuns?: number;
  baseline?: { subject: string; meanRecall: number };
  verdicts?: string[];
}
export interface ConceptsReport extends ReportBase { step: "concepts"; rows: ConceptsRow[]; mean: { overlap: number } }
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
    const stats = step === "core-files" ? (subject as Partial<MeasuredSubject>).runStats?.(e.fullName) : undefined;
    if (step === "core-files") rows.push({ ...base, predicted, ...scoreCoreFiles(predicted, e.expectedCoreFiles), ...errField, ...stats });
    else rows.push({ ...base, predicted, ...scoreConcepts(predicted, e.expectedConcepts), ...errField });
  }

  if (step === "core-files") {
    const r = rows as CoreFilesRow[];
    const withStats = r.filter((x) => x.usd !== undefined);
    const statsPart = withStats.length === 0 ? {} : {
      usd: mean(withStats.map((x) => x.usd ?? 0)),
      modelCalls: mean(withStats.map((x) => x.modelCalls ?? 0)),
    };
    return {
      step, subject: subject.name, generatedAt, rows: r,
      mean: { recall: mean(r.map((x) => x.recall)), precision: mean(r.map((x) => x.precision)), ...statsPart },
      ...(withStats.length === 0 ? {} : { hitLimitRuns: withStats.filter((x) => x.hitLimit).length }),
    };
  }
  const r = rows as ConceptsRow[];
  return { step, subject: subject.name, generatedAt, rows: r, mean: { overlap: mean(r.map((x) => x.overlap)) } };
}

const f = (n: number) => n.toFixed(2);
const cell = (xs: string[]) => (xs.length === 0 ? "" : xs.map((x) => `\`${x}\``).join(", "));

export function renderMarkdown(report: Report): string {
  const lines = [`# Eval: ${report.step} · subject ${report.subject}`, "", `Generated ${report.generatedAt} · ${report.rows.length} repos`, ""];
  if (report.step === "core-files") {
    const st = report.mean.usd !== undefined;
    const statCells = (r: CoreFilesRow) => (st ? ` ${r.modelCalls ?? ""} | ${r.usd === undefined ? "" : r.usd.toFixed(4)} | ${r.hitLimit ? "yes" : ""} |` : "");
    lines.push(`| Repo | Tier | Recall | Precision | Missed | Extra |${st ? " Model calls | USD | Hit limit |" : ""}`, `|---|---|---|---|---|---|${st ? "---|---|---|" : ""}`);
    for (const r of report.rows) lines.push(`| ${r.fullName} | ${r.tier} | ${f(r.recall)} | ${f(r.precision)} | ${cell(r.missed)} | ${cell(r.extra)}${r.error ? ` (error: ${r.error})` : ""} |${statCells(r)}`);
    lines.push(`| **mean** | | ${f(report.mean.recall)} | ${f(report.mean.precision)} | | |${st ? ` ${f(report.mean.modelCalls ?? 0)} | ${(report.mean.usd ?? 0).toFixed(4)} | ${report.hitLimitRuns} of ${report.rows.length} |` : ""}`);
    if (report.baseline) lines.push("", `Baseline \`${report.baseline.subject}\` mean recall: ${f(report.baseline.meanRecall)}`);
    if (report.verdicts?.length) lines.push("", ...report.verdicts.map((v) => `- ${v}`));
  } else {
    lines.push("| Repo | Tier | Overlap | Missed | Extra |", "|---|---|---|---|---|");
    for (const r of report.rows) lines.push(`| ${r.fullName} | ${r.tier} | ${f(r.overlap)} | ${cell(r.missed)} | ${cell(r.extra)}${r.error ? ` (error: ${r.error})` : ""} |`);
    lines.push(`| **mean** | | ${f(report.mean.overlap)} | | |`);
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
