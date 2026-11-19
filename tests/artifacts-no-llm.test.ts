// T013 AC 7 / NFR-002: no LLM call is reachable from any artifact verifier; GitHub calls replay fixtures (no network).
import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { dirname, resolve } from "node:path";
import { verifyL2Branch, verifyL4Artifact } from "../src/server/artifacts.ts";
import { evidencePassedLevels, writeEvidenceRecord } from "../src/server/evidence.ts";
import { githubRepoClient } from "../src/server/github-repo.ts";
import { migrateUp } from "../src/server/migrate.ts";
import { checkRunFeedback } from "../src/server/run-feedback.ts";
import { createTestDatabase } from "./support/db.ts";
import { fixtureFetch } from "./support/github-fixtures.ts";
import { FORK, LEARNER, PINNED, t013Fixture, UPSTREAM } from "./support/t013-github.ts";

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
  "blind-solver.ts",
];

describe("T013 no LLM in the artifact verifiers (AC 7)", () => {
  test("the verifier modules import no AI SDK package, no Inngest and no model module", async () => {
    for (const entry of ["src/server/artifacts.ts", "src/server/artifact-url.ts", "src/server/run-feedback.ts"]) {
      const { files, packages } = await importGraph(entry);
      expect([...packages].filter((p) => p === "ai" || p.startsWith("@ai-sdk/") || p === "inngest")).toEqual([]);
      expect([...files].filter((f) => LLM_MODULES.some((m) => f.endsWith(`/${m}`)))).toEqual([]);
    }
    // Control: the scan does reach the GitHub client and the evidence module from the verifiers.
    const graph = (await importGraph("src/server/artifacts.ts")).files;
    expect([...graph].some((f) => f.endsWith("/github-repo.ts"))).toBe(true);
    expect([...graph].some((f) => f.endsWith("/evidence.ts"))).toBe(true);
  });

  describe("with every model path and the network made to throw", () => {
    const boom = () => {
      throw new Error("LLM or network call attempted from a verifier");
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

    test("L2 and L4 verification and the L1 feedback check all complete and pass", async () => {
      const [u] = await db.sql`
        INSERT INTO users (github_id, github_login) VALUES (${LEARNER.githubId}, ${LEARNER.login}) RETURNING id::text AS id`;
      await db.sql`INSERT INTO repo_snapshots (repo_full_name, commit_sha, default_branch, archived, readme, topics, languages, dep_files, open_issues, good_first_issues, tree, tree_truncated)
        VALUES (${UPSTREAM.fullName}, ${PINNED}, 'main', false, 'r', '[]'::jsonb, '{}'::jsonb, '[]'::jsonb, 0, 0, '[]'::jsonb, false)`;
      const [l] = await db.sql`
        INSERT INTO ladders (repo_full_name, commit_sha, status) VALUES (${UPSTREAM.fullName}, ${PINNED}, 'unverified') RETURNING id::text AS id`;
      await db.sql.begin(async (tx) => {
        for (const level of ["L0", "L1", "L2", "L3"])
          await writeEvidenceRecord(tx, u.id, l.id, {
            learner: "github:x",
            ladder: "repo:x",
            level,
            test: "mcq",
            evidence: {},
            verifiedBy: "test",
            verifiedAt: new Date().toISOString(),
          });
      });
      const deps = {
        sql: db.sql,
        github: githubRepoClient({
          baseUrl: "https://api.github.com",
          token: "t",
          fetch: fixtureFetch([t013Fixture()]).impl,
        }),
        passedLevels: evidencePassedLevels(db.sql),
        emit: async () => {},
        now: () => new Date(),
      };
      const l2 = await verifyL2Branch(deps, u.id, l.id, `https://github.com/${FORK.fullName}/tree/feature/retry`);
      expect(l2).toHaveProperty("artifact");
      const l4 = await verifyL4Artifact(deps, u.id, l.id, `https://github.com/${UPSTREAM.fullName}/pull/42`);
      expect(l4).toHaveProperty("evidence.test", "artifact");
      expect(checkRunFeedback({ explanation: "A. B. C." })).toEqual({ runLog: "", explanation: "A. B. C." });
    });
  });
});
