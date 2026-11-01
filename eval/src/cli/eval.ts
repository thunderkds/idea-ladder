// pnpm eval -- --step core-files|concepts --subject baseline-readme   (offline: replays golden/fixtures, no network, no LLM)
import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadSnapshot } from "../fixtures.js";
import { renderMarkdown, runEval, writeReport, type Step, type Subject } from "../harness.js";
import { checkGolden, goldenFileSchema } from "../schema.js";
import { parseArgs } from "./args.js";

const { flags } = parseArgs(process.argv.slice(2));
const step = flags.step;
const name = flags.subject;
if ((step !== "core-files" && step !== "concepts") || typeof name !== "string") {
  console.error("usage: pnpm eval -- --step core-files|concepts --subject <name|path>");
  process.exit(2);
}
const specifier = /[/.]/.test(name) ? pathToFileURL(isAbsolute(name) ? name : resolve(process.cwd(), name)).href : new URL(`../subjects/${name}.ts`, import.meta.url).href;
const mod = (await import(specifier)) as { subject?: Subject; default?: Subject };
const subject = mod.subject ?? mod.default;
if (!subject) { console.error(`${name} exports neither "subject" nor a default Subject`); process.exit(2); }

const golden = goldenFileSchema.parse(JSON.parse(await readFile(new URL("../../golden/repos.json", import.meta.url), "utf8")));
const snaps = new Map<string, Awaited<ReturnType<typeof loadSnapshot>>>();
for (const e of golden) snaps.set(e.fullName, await loadSnapshot(e.fullName));
const problems = checkGolden(golden, (n) => snaps.get(n));
if (problems.length) { console.error(problems.join("\n")); process.exit(1); }

const report = await runEval({ step: step as Step, subject, subjectName: name, repos: golden, loadSnapshot: async (n) => snaps.get(n)! });
const files = await writeReport(report, new URL("../../reports/", import.meta.url));
console.log(renderMarkdown(report));
console.log(`wrote ${files.json}\nwrote ${files.md}`);
