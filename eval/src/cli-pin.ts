import { resolveHeadSha } from "./github.ts";

const name = process.argv.slice(2).find((a) => a !== "--");
if (!name) {
  console.error("usage: bun run eval:pin -- <owner/name>   (prints the default-branch head sha to paste into repos.json)");
  process.exit(2);
}
try {
  console.log(await resolveHeadSha(name, { token: process.env.GITHUB_TOKEN }));
} catch (e) {
  console.error(`eval:pin failed: ${(e as Error).message}`);
  process.exit(1);
}
