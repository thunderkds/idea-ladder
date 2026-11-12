import { parseArgs } from "node:util";
import { readCostLog, summarizeRun, type Totals } from "./cost.ts";

const { values } = parseArgs({ options: { run: { type: "string" } }, allowPositionals: false });
if (!values.run) {
  console.error("usage: bun run eval:cost -- --run <runId>");
  process.exit(2);
}

const usd = (n: number | null) => (n === null ? "n/a (subscription)" : n.toFixed(4));
const table = (title: string, rows: Record<string, Totals>) => {
  console.log(`\n${title}`);
  console.log("| Key | Calls | Input tokens | Cached input | Output tokens | USD |\n|---|---|---|---|---|---|");
  for (const [k, t] of Object.entries(rows)) console.log(`| ${k} | ${t.calls} | ${t.inputTokens} | ${t.cachedInputTokens} | ${t.outputTokens} | ${usd(t.usd)} |`);
};

try {
  const lines = readCostLog(values.run);
  const s = summarizeRun(lines);
  console.log(`Cost for run ${values.run}: ${lines.length} calls`);
  table("Per step", s.byStep);
  table("Per ladder", s.byLadder);
  console.log(`\nTotal USD: ${usd(s.totalUsd)}`);
} catch (e) {
  console.error(`eval:cost failed: ${(e as Error).message}`);
  process.exit(1);
}
