// T014: the learner's L2 diff as hunks, the only chunks model A may cite for diff questions. Code only, no LLM.

/** One changed file as GitHub's compare API lists it; `patch` is absent for binary (and very large) diffs. */
export type DiffFile = { filename: string; status: string; patch?: string };
/** One `@@` hunk of one file. `id` = `<file path>#<hunk index>`, stable for the same diff. */
export type Hunk = { id: string; path: string; text: string };

/**
 * Model A input cap, in tokens (4 chars per token, the T006 estimate): the same 24,000 chars a level generator gets
 * (LEVEL_CHUNK_CHARS, T008).
 */
export const DIFF_TOKEN_BUDGET = 6_000;
const CHARS_PER_TOKEN = 4;

const LOCKFILES = new Set(["bun.lock", "package-lock.json", "yarn.lock", "Cargo.lock", "poetry.lock"]);
const GENERATED_DIRS = new Set(["dist", "build", "vendor"]);

/** Lockfiles (any folder) and any path with a `dist`, `build` or `vendor` folder in it. */
export function isExcludedPath(path: string): boolean {
  const parts = path.split("/");
  return LOCKFILES.has(parts.at(-1) as string) || parts.slice(0, -1).some((p) => GENERATED_DIRS.has(p));
}

/** Splits every kept file's patch at its `@@` header lines. Excluded paths and binary files give no hunk. */
export function splitHunks(files: DiffFile[]): Hunk[] {
  const out: Hunk[] = [];
  for (const f of files) {
    if (!f.patch || isExcludedPath(f.filename)) continue;
    const blocks: string[][] = [];
    for (const line of f.patch.split("\n")) {
      if (line.startsWith("@@") || blocks.length === 0) blocks.push([]);
      (blocks.at(-1) as string[]).push(line);
    }
    blocks.forEach((b, i) => {
      out.push({ id: `${f.filename}#${i}`, path: f.filename, text: b.join("\n") });
    });
  }
  return out;
}

/**
 * Keeps the largest hunks that fit DIFF_TOKEN_BUDGET (largest first), returned in diff order; counts the rest. A hunk
 * longer than the whole budget is first cut to the budget, so a diff of oversized hunks still has one to ask about.
 */
export function capHunks(hunks: Hunk[]): { kept: Hunk[]; dropped: number } {
  const budget = DIFF_TOKEN_BUDGET * CHARS_PER_TOKEN;
  const cut = hunks.map((h) => (h.text.length > budget ? { ...h, text: h.text.slice(0, budget) } : h));
  let left = budget;
  const keep = new Set<string>();
  for (const h of [...cut].sort((a, b) => b.text.length - a.text.length)) {
    if (h.text.length > left) continue;
    keep.add(h.id);
    left -= h.text.length;
  }
  return { kept: cut.filter((h) => keep.has(h.id)), dropped: hunks.length - keep.size };
}
