import { parseArgs } from "node:util";
import { loadFixture, loadGolden } from "./golden.ts";
import type { MeasuredSubject } from "./subject.ts";
import { STEPS, loadSubject, renderMarkdown, runEval, writeReport, type Step } from "./harness.ts";

const { values } = parseArgs({ options: { step: { type: "string" }, subject: { type: "string" } }, allowPositionals: false });
if (!values.step || !values.subject || !STEPS.includes(values.step as Step)) {
  console.error(`usage: bun run eval -- --step <${STEPS.join("|")}> --subject <name in src/subjects/>`);
  process.exit(2);
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
