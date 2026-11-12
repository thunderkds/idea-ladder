import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { fixtureFile, loadGolden } from "./golden.ts";
import { RateLimitError, RepoNotFoundError, recordRepo } from "./github.ts";

const { values } = parseArgs({ options: { force: { type: "boolean" } }, allowPositionals: false });
const token = process.env.GITHUB_TOKEN || undefined;
console.log(token ? "GITHUB_TOKEN found: authenticated (5,000 requests/hour)." : "No GITHUB_TOKEN: unauthenticated (60 requests/hour). Record in batches.");

let recorded = 0, skipped = 0;
const failed: string[] = [];
for (const e of loadGolden()) {
  const path = fixtureFile(e.fullName);
  if (existsSync(path) && !values.force) { skipped++; continue; }
  try {
    const fx = await recordRepo(e, { token });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(fx)}\n`); // written only after the whole repo was read
    recorded++;
    console.log(`recorded ${e.fullName}@${e.sha.slice(0, 7)}`);
  } catch (err) {
    if (err instanceof RateLimitError) {
      console.error(`${err.message}\nStopped before writing a partial fixture. Run again after the reset; recorded fixtures are kept.`);
      process.exit(2);
    }
    if (err instanceof RepoNotFoundError) { failed.push(`${e.fullName}: ${err.message}`); continue; }
    throw err;
  }
}
console.log(`done: ${recorded} recorded, ${skipped} already present, ${failed.length} failed`);
for (const f of failed) console.error(`FAILED ${f}`);
process.exit(failed.length > 0 ? 1 : 0);
