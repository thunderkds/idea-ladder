import type { Subject } from "../harness.js";
import type { RepoSnapshot } from "../github.js";

const MAX_FILES = 10;
/** Images, docs and lock files are never core code. */
const NOT_CODE = /\.(png|jpe?g|gif|svg|ico|webp|md|mdx|txt|lock|ipynb)$/i;
const norm = (p: string) => p.replace(/^\.\//, "").replace(/^\//, "");

/** Candidate path tokens in the README: anything shaped like name.ext, with optional directories. */
function readmeTokens(readme: string): string[] {
  return [...readme.matchAll(/[A-Za-z0-9_@.\-/]+\.[A-Za-z0-9]{1,5}\b/g)].map((m) => norm(m[0]));
}

/** Entry point named by the repo's own dependency file, if it exists in the tree. */
function entryPoints(s: RepoSnapshot): string[] {
  const out: string[] = [];
  const pkg = s.depFileContents["package.json"];
  if (pkg) {
    try {
      const j = JSON.parse(pkg) as Record<string, unknown>;
      const exp = j.exports;
      const dot = typeof exp === "string" ? exp : exp && typeof exp === "object" ? (exp as Record<string, unknown>)["."] ?? exp : undefined;
      const fromExports = (x: unknown): string[] =>
        typeof x === "string" ? [x] : x && typeof x === "object" ? Object.values(x as object).flatMap(fromExports) : [];
      for (const c of [j.source, j.module, j.main, ...fromExports(dot)]) if (typeof c === "string") out.push(norm(c));
    } catch { /* malformed package.json: no entry point */ }
  }
  if (s.depFileContents["Cargo.toml"]) out.push("src/lib.rs", "src/main.rs");
  if (s.depFileContents["go.mod"]) out.push(`${s.fullName.split("/")[1]}.go`, "main.go");
  return out;
}

/**
 * Deterministic baseline (no network, no LLM): files the README names that exist in the tree, plus the
 * dependency-file entry point. A bare file name counts only if exactly one tree file has that name.
 */
export const subject: Subject = {
  name: "baseline-readme",
  async run(s) {
    const tree = new Set(s.tree);
    const byBase = new Map<string, string[]>();
    for (const p of s.tree) {
      const b = p.slice(p.lastIndexOf("/") + 1);
      byBase.set(b, [...(byBase.get(b) ?? []), p]);
    }
    const picked: string[] = [];
    for (const t of readmeTokens(s.readme)) {
      if (tree.has(t)) picked.push(t);
      else if (!t.includes("/") && byBase.get(t)?.length === 1) picked.push(byBase.get(t)![0]!);
    }
    for (const e of entryPoints(s)) if (tree.has(e)) picked.push(e);
    const coreFiles = [...new Set(picked)].filter((p) => p !== s.readmePath && !NOT_CODE.test(p)).slice(0, MAX_FILES);
    return { coreFiles, concepts: s.topics };
  },
};
export default subject;
