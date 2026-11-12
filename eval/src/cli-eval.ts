import { parseArgs } from "node:util";
import { loadFixture, loadGolden } from "./golden.ts";
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
  const { jsonPath, mdPath } = writeReport(report);
  process.stdout.write(renderMarkdown(report));
  console.log(`\nwrote ${jsonPath}\nwrote ${mdPath}`);
} catch (e) {
  console.error(`eval failed: ${(e as Error).message}`);
  process.exit(1);
}
