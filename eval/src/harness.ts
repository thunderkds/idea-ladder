import { mkdir, writeFile } from "node:fs/promises";
import type { RepoSnapshot } from "./github.js";
import { scoreConcepts, scoreCoreFiles } from "./score.js";
import type { GoldenEntry } from "./schema.js";

export type Step = "core-files" | "concepts";
export interface SubjectOutput { coreFiles?: string[]; concepts?: string[] }
/** A pipeline step under test. `entry` is passed for convenience; a real subject must not read the labels. */
export interface Subject { name: string; run(snapshot: RepoSnapshot, entry?: GoldenEntry): Promise<SubjectOutput> }

export interface Row { fullName: string; tier: string; recall?: number; precision?: number; overlap?: number; missed: string[]; extra: string[] }
export interface Report {
  step: Step; subject: string; generatedAt: string; repoCount: number; rows: Row[];
  mean: { recall?: number; precision?: number; overlap?: number };
}

export interface RunOptions {
  step: Step; subject: Subject; subjectName: string; repos: GoldenEntry[];
  loadSnapshot: (fullName: string) => Promise<RepoSnapshot>; now?: () => Date;
}

const mean = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);

export async function runEval(o: RunOptions): Promise<Report> {
  const rows: Row[] = [];
  for (const entry of o.repos) {
    const out = await o.subject.run(await o.loadSnapshot(entry.fullName), entry);
    if (o.step === "core-files") {
      if (!out.coreFiles) throw new Error(`${o.subjectName} returned no coreFiles for ${entry.fullName} (step core-files)`);
      const s = scoreCoreFiles(out.coreFiles, entry.expectedCoreFiles);
      rows.push({ fullName: entry.fullName, tier: entry.tier, recall: s.recall, precision: s.precision, missed: s.missed, extra: s.extra });
    } else {
      if (!out.concepts) throw new Error(`${o.subjectName} returned no concepts for ${entry.fullName} (step concepts)`);
      const s = scoreConcepts(out.concepts, entry.expectedConcepts);
      rows.push({ fullName: entry.fullName, tier: entry.tier, overlap: s.overlap, missed: s.missed, extra: s.extra });
    }
  }
  return {
    step: o.step, subject: o.subjectName, generatedAt: (o.now ?? (() => new Date()))().toISOString(), repoCount: rows.length, rows,
    mean: o.step === "core-files"
      ? { recall: mean(rows.map((r) => r.recall!)), precision: mean(rows.map((r) => r.precision!)) }
      : { overlap: mean(rows.map((r) => r.overlap!)) },
  };
}

const f = (n: number | undefined) => (n === undefined ? "" : n.toFixed(3));

export function renderMarkdown(r: Report): string {
  const core = r.step === "core-files";
  const head = core ? "| Repo | Tier | Recall | Precision | Missed | Extra |\n|---|---|---|---|---|---|" : "| Repo | Tier | Overlap | Missed | Extra |\n|---|---|---|---|---|";
  const list = (xs: string[]) => (xs.length ? xs.map((x) => `\`${x}\``).join(", ") : "-");
  const body = r.rows.map((x) => (core
    ? `| ${x.fullName} | ${x.tier} | ${f(x.recall)} | ${f(x.precision)} | ${list(x.missed)} | ${list(x.extra)} |`
    : `| ${x.fullName} | ${x.tier} | ${f(x.overlap)} | ${list(x.missed)} | ${list(x.extra)} |`)).join("\n");
  const m = core ? `**Mean recall ${f(r.mean.recall)}, mean precision ${f(r.mean.precision)}**` : `**Mean overlap ${f(r.mean.overlap)}**`;
  return `# Eval report: ${r.step} / ${r.subject}\n\nGenerated ${r.generatedAt}. ${r.repoCount} repos.\n\n${head}\n${body}\n\n${m}\n`;
}

export async function writeReport(r: Report, dir: URL | string): Promise<{ json: string; md: string }> {
  const base = typeof dir === "string" ? dir.replace(/\/?$/, "/") : dir.pathname;
  await mkdir(base, { recursive: true });
  const stamp = r.generatedAt.replace(/:/g, "-");
  const json = `${base}${r.step}-${stamp}.json`;
  const md = `${base}${r.step}-${stamp}.md`;
  await writeFile(json, JSON.stringify(r, null, 2) + "\n");
  await writeFile(md, renderMarkdown(r));
  return { json, md };
}
