// T014 unit: diff hunk splitter + filter (lockfiles, binary, generated paths) and the DIFF_TOKEN_BUDGET cap.
import { describe, expect, test } from "bun:test";
import { capHunks, DIFF_TOKEN_BUDGET, type DiffFile, isExcludedPath, splitHunks } from "../src/server/diff-hunks.ts";

const PATCH_TWO = [
  "@@ -1,3 +1,4 @@",
  " export function retry(fn) {",
  "+  const maxAttempts = 3;",
  "   return fn();",
  "@@ -20,2 +21,2 @@ export function backoff() {",
  "-  return 100;",
  "+  return 250;",
].join("\n");

describe("T014 diff hunks", () => {
  test("splits each file patch at @@ headers; ids are <file path>#<hunk index>, stable across calls", () => {
    const files: DiffFile[] = [
      { filename: "src/retry.ts", status: "modified", patch: PATCH_TWO },
      { filename: "src/new.ts", status: "added", patch: "@@ -0,0 +1 @@\n+export const x = 1;" },
    ];
    const hunks = splitHunks(files);
    expect(hunks.map((h) => h.id)).toEqual(["src/retry.ts#0", "src/retry.ts#1", "src/new.ts#0"]);
    expect(hunks[0]?.text).toBe(PATCH_TWO.split("\n").slice(0, 4).join("\n"));
    expect(hunks[1]?.text).toContain("+  return 250;");
    expect(hunks[1]?.path).toBe("src/retry.ts");
    expect(splitHunks(files)).toEqual(hunks);
  });

  test("drops lockfiles, binary diffs (no patch) and paths under dist/, build/, vendor/", () => {
    for (const p of ["bun.lock", "package-lock.json", "yarn.lock", "Cargo.lock", "poetry.lock", "web/yarn.lock"])
      expect(isExcludedPath(p)).toBe(true);
    for (const p of ["dist/index.js", "build/out.css", "vendor/lib.go", "packages/a/dist/x.js"])
      expect(isExcludedPath(p)).toBe(true);
    for (const p of ["src/lock.ts", "distance.ts", "src/builder.ts", "docs/vendors.md"])
      expect(isExcludedPath(p)).toBe(false);
    const files: DiffFile[] = [
      { filename: "bun.lock", status: "modified", patch: "@@ -1 +1 @@\n-a\n+b" },
      { filename: "logo.png", status: "added" }, // binary: GitHub sends no patch
      { filename: "dist/app.js", status: "modified", patch: "@@ -1 +1 @@\n-a\n+b" },
    ];
    expect(splitHunks(files)).toEqual([]);
  });

  test("a diff with only deleted lines is still testable", () => {
    const hunks = splitHunks([
      { filename: "src/old.ts", status: "removed", patch: "@@ -1,2 +0,0 @@\n-export const legacy = true;\n-run();" },
    ]);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]?.text).toContain("-export const legacy = true;");
  });

  test("the cap keeps the largest hunks first (in diff order) and counts the dropped ones", () => {
    const big = (id: string, chars: number) => ({ id, path: id, text: "x".repeat(chars) });
    const budgetChars = DIFF_TOKEN_BUDGET * 4;
    const hunks = [big("a#0", 100), big("b#0", budgetChars - 50), big("c#0", 200), big("d#0", 40)];
    const { kept, dropped } = capHunks(hunks);
    expect(kept.map((h) => h.id)).toEqual(["b#0", "d#0"]);
    expect(dropped).toBe(2);
    expect(capHunks(hunks.slice(0, 1))).toEqual({ kept: hunks.slice(0, 1), dropped: 0 });
  });
});
