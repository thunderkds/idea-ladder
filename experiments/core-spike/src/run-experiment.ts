import { writeFile } from "node:fs/promises";
import { buildResults } from "./report.js";

const md = await buildResults();
await writeFile(new URL("../RESULTS.md", import.meta.url), md);
console.log(md.split("\n").filter((l) => l.startsWith("VERDICT")).join("\n"));
console.log("wrote RESULTS.md");
