import type { Fixture } from "../schema.ts";
import type { Subject } from "../subject.ts";

/** Strips `https://github.com/<o>/<r>/(blob|tree)/<ref>/` so a link target reads as a repo path. */
const GITHUB_LINK = /https?:\/\/github\.com\/[^/\s)]+\/[^/\s)]+\/(?:blob|tree)\/[^/\s)]+\//g;
const PATH_LIKE = /[\w@.-]+(?:\/[\w@.-]+)+|[\w@-]+\.[A-Za-z0-9]+/g;
const README_NAME = /^readme(\.[a-z]+)?$/i;

/** Path-like tokens in README order, first occurrence only. They may or may not exist in the tree. */
export function extractReadmePaths(readme: string): string[] {
  const seen = new Set<string>();
  for (const raw of readme.replace(GITHUB_LINK, "").match(PATH_LIKE) ?? []) {
    const p = raw.replace(/^(\.\/)+/, "").replace(/[.,;:]+$/, "");
    if (p) seen.add(p);
  }
  return [...seen];
}

const parseJson = (s: string): Record<string, unknown> | undefined => {
  try {
    const v: unknown = JSON.parse(s);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
};

/** Conventional entry point named by a root dependency file, if that file exists in the tree. */
function entryPoint(fx: Fixture, files: Set<string>): string | undefined {
  const pkg = fx.depFileContents["package.json"];
  if (pkg !== undefined) {
    const json = parseJson(pkg);
    for (const key of ["source", "module", "main"]) {
      const v = json?.[key];
      if (typeof v === "string") {
        const p = v.replace(/^(\.\/)+/, "");
        if (files.has(p)) return p;
      }
    }
  }
  if (fx.depFiles.includes("Cargo.toml")) {
    const m = /\[\[bin\]\][^[]*?path\s*=\s*"([^"]+)"/s.exec(fx.depFileContents["Cargo.toml"] ?? "");
    for (const p of [m?.[1], "src/lib.rs", "src/main.rs"]) if (p && files.has(p)) return p;
  }
  const name = fx.fullName.split("/")[1]!.toLowerCase();
  const py = name.replace(/-/g, "_");
  const candidates: string[] = [];
  if (fx.depFiles.some((f) => ["pyproject.toml", "setup.py", "requirements.txt", "Pipfile"].includes(f))) {
    candidates.push(`src/${py}/__init__.py`, `${py}/__init__.py`);
  }
  if (fx.depFiles.includes("go.mod")) candidates.push("main.go", `${name}.go`);
  return candidates.find((p) => files.has(p));
}

/**
 * Deterministic floor for every later step (AC 5): files the README names that exist in the tree, in README
 * order, then the entry point named by the root dependency file. No network, no LLM.
 */
export const baselineReadme: Required<Subject> = {
  name: "baseline-readme",
  coreFiles(fx) {
    const files = new Set(fx.tree.filter((t) => t.type === "blob").map((t) => t.path));
    const out = extractReadmePaths(fx.readme).filter((p) => files.has(p) && !README_NAME.test(p));
    const entry = entryPoint(fx, files);
    if (entry && !out.includes(entry)) out.push(entry);
    return out;
  },
  concepts: (fx) => fx.topics,
};

export default baselineReadme;
