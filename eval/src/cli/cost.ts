// pnpm eval:cost -- --run <runId>   prints cost per step and per ladder from cost-log/<runId>.jsonl
import { readCostLog, summarizeCost } from "../cost.js";
import { parseArgs } from "./args.js";

const { flags } = parseArgs(process.argv.slice(2));
const run = flags.run;
if (typeof run !== "string" || !/^[A-Za-z0-9._-]+$/.test(run)) { console.error("usage: pnpm eval:cost -- --run <runId>"); process.exit(2); }
const records = await readCostLog(run);
if (records.length === 0) { console.error(`no cost records for run "${run}"`); process.exit(1); }
const s = summarizeCost(records);
const usd = (n: number) => `$${n.toFixed(6)}`;
console.log(`Cost for run ${run}: ${s.calls} LLM calls, total ${usd(s.totalUsd)}\n\nPer step:`);
for (const [k, v] of Object.entries(s.perStep)) console.log(`  ${k.padEnd(24)} ${usd(v)}`);
console.log("\nPer ladder:");
for (const [k, v] of Object.entries(s.perLadder)) console.log(`  ${k.padEnd(40)} ${usd(v)}`);
