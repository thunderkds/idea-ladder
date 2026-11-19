// T012 AC 7 / NFR-002: no LLM call is reachable from startMcqAttempt or submitMcqAttempt.
import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { dirname, resolve } from "node:path";
import type { PassedLevels } from "../src/server/ladder-view.ts";
import { type McqAttempt, type McqResult, startMcqAttempt, submitMcqAttempt } from "../src/server/mcq-test.ts";
import { migrateUp } from "../src/server/migrate.ts";
import { createTestDatabase } from "./support/db.ts";
import { seedLadder, seedLearner, seedPool } from "./support/mcq-seed.ts";

let db: Awaited<ReturnType<typeof createTestDatabase>>;
beforeAll(async () => {
  db = await createTestDatabase();
  await migrateUp(db.sql);
});
afterAll(async () => {
  await db.drop();
});

/** Every module reachable through value imports (type-only imports are erased), and every bare package. */
async function importGraph(entry: string): Promise<{ files: Set<string>; packages: Set<string> }> {
  const transpiler = new Bun.Transpiler({ loader: "ts" });
  const files = new Set<string>();
  const packages = new Set<string>();
  const queue = [resolve(entry)];
  while (queue.length) {
    const file = queue.pop() as string;
    if (files.has(file)) continue;
    files.add(file);
    if (!file.endsWith(".ts")) continue;
    for (const imp of transpiler.scanImports(await Bun.file(file).text())) {
      if (imp.path.startsWith(".")) queue.push(resolve(dirname(file), imp.path));
      else packages.add(imp.path);
    }
  }
  return { files, packages };
}

const LLM_MODULES = [
  "model-a.ts",
  "claude-code-reader.ts",
  "repo-reader.ts",
  "level-generator.ts",
  "concept-mapper.ts",
];

describe("T012 no LLM in the pass-test trust path", () => {
  test("the pass-test modules import no AI SDK package and no model module", async () => {
    for (const entry of ["src/server/mcq-test.ts", "src/server/evidence.ts"]) {
      const { files, packages } = await importGraph(entry);
      const llmPackages = [...packages].filter((p) => p === "ai" || p.startsWith("@ai-sdk/") || p === "inngest");
      expect(llmPackages).toEqual([]);
      expect([...files].filter((f) => LLM_MODULES.some((m) => f.endsWith(`/${m}`)))).toEqual([]);
    }
    // Control: the scan does see the AI SDK where it is imported.
    expect((await importGraph("src/server/model-a.ts")).packages.has("ai")).toBe(true);
    expect([...(await importGraph("src/server/mcq-test.ts")).files].some((f) => f.endsWith("/save-ladder.ts"))).toBe(
      true,
    );
  });

  describe("with every model path made to throw", () => {
    const boom = () => {
      throw new Error("LLM call attempted from the pass test");
    };
    const spies = [
      spyOn(globalThis, "fetch").mockImplementation(boom as unknown as typeof fetch),
      spyOn(Bun, "spawn").mockImplementation(boom as unknown as typeof Bun.spawn),
      spyOn(Bun, "spawnSync").mockImplementation(boom as unknown as typeof Bun.spawnSync),
    ];
    afterEach(() => {
      for (const s of spies) expect(s).not.toHaveBeenCalled();
    });
    afterAll(() => {
      for (const s of spies) s.mockRestore();
    });

    test("start and submit both complete and pass", async () => {
      const learner = await seedLearner(db.sql);
      const ladder = await seedLadder(db.sql);
      await seedPool(db.sql, ladder, "L0", 10);
      const none: PassedLevels = async () => [];
      const now = new Date("2026-11-01T09:00:00Z");
      const a = (await startMcqAttempt(db.sql, learner, ladder.ladderId, "L0", now, none)) as McqAttempt;
      expect(a.questions).toHaveLength(10);
      const answers = Object.fromEntries(
        a.questions.map((q) => [q.id, q.options.findIndex((o) => o.startsWith("key-"))]),
      );
      const r = (await submitMcqAttempt(db.sql, learner, a.attemptId, answers, now)) as McqResult;
      expect(r).toMatchObject({ pass: true, correct: 10, unlockedLevel: "L1" });
    });
  });
});
