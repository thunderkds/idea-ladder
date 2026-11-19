import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { loadFixture, loadGolden } from "./golden.ts";
import type { MeasuredSubject } from "./subject.ts";
import { REPORTS_DIR, STEPS, loadSubject, renderMarkdown, runEval, writeReport, type Step } from "./harness.ts";
import { type LadderRow, summarizeLadders } from "./level-generators-subject.ts";
import type { Fixture } from "./schema.ts";

const { values } = parseArgs({ options: { step: { type: "string" }, subject: { type: "string" } }, allowPositionals: false });
if (!values.step || !values.subject || !(STEPS.includes(values.step as Step) || values.step === "ladder")) {
  console.error(`usage: bun run eval -- --step <${STEPS.join("|")}|ladder> --subject <name in src/subjects/>`);
  process.exit(2);
}

// T008 `--step ladder`: no golden score; per repo the generation_report, then the pre-registered threshold verdicts.
if (values.step === "ladder") {
  try {
    const subject = (await loadSubject(values.subject)) as Partial<{ ladder: (fx: Fixture) => Promise<LadderRow> }>;
    if (typeof subject.ladder !== "function") throw new Error(`subject "${values.subject}" has no ladder() for --step ladder`);
    const rows: LadderRow[] = [];
    for (const e of loadGolden()) {
      const row = await subject.ladder(loadFixture(e.fullName));
      rows.push(row);
      console.log(JSON.stringify(row));
    }
    const summary = summarizeLadders(rows);
    mkdirSync(REPORTS_DIR, { recursive: true });
    const path = join(REPORTS_DIR, `ladder-${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}.json`);
    writeFileSync(path, `${JSON.stringify({ rows, summary }, null, 2)}\n`);
    console.log(summary.verdicts.join("\n"));
    console.log(`\nwrote ${path}`);
  } catch (e) {
    console.error(`eval failed: ${(e as Error).message}`);
    process.exit(1);
  }
  process.exit(0);
}

try {
  const subject = await loadSubject(values.subject);
  const opts = { subject, repos: loadGolden(), loadFixture };
  const report = values.step === "core-files" ? await runEval({ ...opts, step: "core-files" }) : await runEval({ ...opts, step: "concepts" });
  if (report.step === "core-files" && subject.name !== "baseline-readme") {
    // Every other core-files subject is compared with the deterministic floor on the same repos.
    const baseline = await runEval({ ...opts, subject: await loadSubject("baseline-readme"), step: "core-files" });
    report.baseline = { subject: "baseline-readme", meanRecall: baseline.mean.recall };
    report.verdicts = (subject as Partial<MeasuredSubject>).verdicts?.(report, baseline.mean.recall);
  }
  const { jsonPath, mdPath } = writeReport(report);
  process.stdout.write(renderMarkdown(report));
  console.log(`\nwrote ${jsonPath}\nwrote ${mdPath}`);
} catch (e) {
  console.error(`eval failed: ${(e as Error).message}`);
  process.exit(1);
}
