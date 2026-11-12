import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SQL } from "bun";
import { migrateDown, migrateUp } from "../src/server/migrate.ts";
import { createTestDatabase } from "./support/db.ts";

/** Explicit opt-in for the destructive down migration (test databases are throwaway). */
const ALLOW_DOWN = { MIGRATE_ALLOW_DOWN: "1", NODE_ENV: "test" };

let db: Awaited<ReturnType<typeof createTestDatabase>>;
beforeAll(async () => {
  db = await createTestDatabase();
});
afterAll(async () => {
  await db.drop();
});

const tables = async (sql: SQL) =>
  (await sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`).map(
    (r: { table_name: string }) => r.table_name,
  );
const T0001 = ["schema_migrations", "sessions", "users"];
const ALL = [
  "core_files",
  "generation_job_waiters",
  "generation_jobs",
  "ladders",
  "repo_confidence",
  "repo_file_cache",
  "repo_snapshots",
  "schema_migrations",
  "sessions",
  "users",
];
const extensions = async (sql: SQL) =>
  (await sql`SELECT extname FROM pg_extension`).map((r: { extname: string }) => r.extname);

describe("migrations (AC 1)", () => {
  test("up creates vector, users and sessions", async () => {
    await migrateUp(db.sql);
    expect(await extensions(db.sql)).toContain("vector");
    expect(await tables(db.sql)).toEqual(ALL);
    const cols =
      await db.sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'users' ORDER BY ordinal_position`;
    expect(cols.map((c: { column_name: string }) => c.column_name)).toEqual([
      "id",
      "github_id",
      "github_login",
      "created_at",
      "updated_at",
    ]);
  });

  test("users.github_id is unique", async () => {
    await db.sql`INSERT INTO users (github_id, github_login) VALUES (1, 'a')`;
    await expect(
      (async () => await db.sql`INSERT INTO users (github_id, github_login) VALUES (1, 'b')`)(),
    ).rejects.toThrow(/unique|duplicate/i);
    await db.sql`DELETE FROM users`;
  });

  test("up is idempotent", async () => {
    expect(await migrateUp(db.sql)).toEqual([]);
  });

  test("down reverts to an empty schema, with rows present; up again succeeds", async () => {
    await db.sql`INSERT INTO users (github_id, github_login) VALUES (7, 'has-data')`;
    expect(await migrateDown(db.sql, undefined, ALLOW_DOWN)).toBe("0003_core_files");
    expect(await migrateDown(db.sql, undefined, ALLOW_DOWN)).toBe("0002_start_jobs");
    expect(await migrateDown(db.sql, undefined, ALLOW_DOWN)).toBe("0001_init");
    expect(await tables(db.sql)).toEqual([]);
    expect(await extensions(db.sql)).not.toContain("vector");
    expect(await migrateUp(db.sql)).toEqual(["0001_init", "0002_start_jobs", "0003_core_files"]);
    expect(await tables(db.sql)).toEqual(ALL);
  });

  test("down on an empty schema is a no-op", async () => {
    await migrateDown(db.sql, undefined, ALLOW_DOWN);
    await migrateDown(db.sql, undefined, ALLOW_DOWN);
    await migrateDown(db.sql, undefined, ALLOW_DOWN);
    expect(await migrateDown(db.sql, undefined, ALLOW_DOWN)).toBeUndefined();
    expect(await tables(db.sql)).toEqual([]);
  });

  test("a failing migration leaves no half-applied schema", async () => {
    const dir = await mkdtemp(join(tmpdir(), "il-mig-"));
    await writeFile(join(dir, "0001_bad.up.sql"), "CREATE TABLE half_applied (id int);\nSELECT * FROM no_such_table;");
    await writeFile(join(dir, "0001_bad.down.sql"), "DROP TABLE half_applied;");
    await expect(migrateUp(db.sql, dir)).rejects.toThrow(/0001_bad/);
    expect(await tables(db.sql)).not.toContain("half_applied");
    expect(await db.sql`SELECT to_regclass('public.half_applied') AS t`).toEqual([{ t: null }]);
  });

  test("a missing extension fails with a clear message", async () => {
    const dir = await mkdtemp(join(tmpdir(), "il-mig-"));
    await writeFile(
      join(dir, "0001_ext.up.sql"),
      'CREATE EXTENSION IF NOT EXISTS "no_such_ext_for_test";\nCREATE TABLE after_ext (id int);',
    );
    await writeFile(join(dir, "0001_ext.down.sql"), "DROP TABLE after_ext;");
    await expect(migrateUp(db.sql, dir)).rejects.toThrow(
      /extension "no_such_ext_for_test" is not installed on this Postgres server/,
    );
    expect(await db.sql`SELECT to_regclass('public.after_ext') AS t`).toEqual([{ t: null }]);
  });
});

describe("down migration guard (destructive)", () => {
  const userTables = async (sql: SQL) => (await tables(sql)).filter((t: string) => t !== "schema_migrations");

  test("refused without MIGRATE_ALLOW_DOWN; nothing is dropped", async () => {
    await migrateUp(db.sql);
    await expect(migrateDown(db.sql, undefined, {})).rejects.toThrow(/MIGRATE_ALLOW_DOWN=1/);
    await expect(migrateDown(db.sql, undefined, { MIGRATE_ALLOW_DOWN: "true" })).rejects.toThrow(
      /MIGRATE_ALLOW_DOWN=1/,
    );
    expect(await userTables(db.sql)).toEqual(ALL.filter((t) => t !== "schema_migrations"));
  });

  test("refused when NODE_ENV=production, even with MIGRATE_ALLOW_DOWN=1", async () => {
    await migrateUp(db.sql);
    await expect(migrateDown(db.sql, undefined, { MIGRATE_ALLOW_DOWN: "1", NODE_ENV: "production" })).rejects.toThrow(
      /NODE_ENV=production.*MIGRATE_ALLOW_DOWN/,
    );
    expect(await userTables(db.sql)).toEqual(ALL.filter((t) => t !== "schema_migrations"));
  });

  test("allowed with MIGRATE_ALLOW_DOWN=1", async () => {
    await migrateUp(db.sql);
    expect(await migrateDown(db.sql, undefined, ALLOW_DOWN)).toBe("0003_core_files");
    expect(await migrateDown(db.sql, undefined, ALLOW_DOWN)).toBe("0002_start_jobs");
    expect(await tables(db.sql)).toEqual(T0001);
  });

  test("CLI `bun run db:migrate:down` without the opt-in exits 1 and names the variable", async () => {
    await migrateUp(db.sql);
    const { MIGRATE_ALLOW_DOWN: _unset, ...env } = process.env;
    const proc = Bun.spawnSync(["bun", "run", "db:migrate:down"], { env: { ...env, DATABASE_URL: db.url } });
    expect(proc.exitCode).toBe(1);
    expect(proc.stderr.toString()).toContain("MIGRATE_ALLOW_DOWN=1");
    expect(await userTables(db.sql)).toEqual(ALL.filter((t) => t !== "schema_migrations"));
  });
});

describe("0002_start_jobs (T005)", () => {
  const SHA = "6b41670516ed8e8b738612f60491995470aa63b3";
  const openJob = (repo: string) =>
    db.sql`INSERT INTO generation_jobs (repo_full_name, commit_sha) VALUES (${repo}, ${SHA}) RETURNING id`;

  test("up / down / up with rows present", async () => {
    await migrateUp(db.sql);
    await db.sql`INSERT INTO ladders (repo_full_name, commit_sha, status) VALUES ('developit/mitt', ${SHA}, 'unverified')`;
    await openJob("developit/mitt");
    expect(await migrateDown(db.sql, undefined, ALLOW_DOWN)).toBe("0003_core_files");
    expect(await migrateDown(db.sql, undefined, ALLOW_DOWN)).toBe("0002_start_jobs");
    expect(await tables(db.sql)).toEqual(T0001);
    expect(await migrateUp(db.sql)).toEqual(["0002_start_jobs", "0003_core_files"]);
    expect(await tables(db.sql)).toEqual(ALL);
  });

  test("one open job per repo + SHA; a failed job does not block a new one", async () => {
    await migrateUp(db.sql);
    const [first] = await openJob("lukeed/dset");
    await expect((async () => await openJob("lukeed/dset"))()).rejects.toThrow(/unique|duplicate/i);
    await db.sql`UPDATE generation_jobs SET status = 'failed', reason = 'rate-limited' WHERE id = ${first.id}`;
    expect((await openJob("lukeed/dset")).length).toBe(1);
  });

  test("repo names must be lower-case and SHAs 40-hex; status is one of four", async () => {
    await migrateUp(db.sql);
    await expect((async () => await openJob("Developit/Mitt"))()).rejects.toThrow(/check/i);
    await expect(
      (async () =>
        await db.sql`INSERT INTO ladders (repo_full_name, commit_sha, status) VALUES ('a/b', 'abc', 'unverified')`)(),
    ).rejects.toThrow(/check/i);
    await expect(
      (async () =>
        await db.sql`INSERT INTO generation_jobs (repo_full_name, commit_sha, status) VALUES ('a/b', ${SHA}, 'done')`)(),
    ).rejects.toThrow(/check/i);
  });
});

describe("0003_core_files (T006)", () => {
  const SHA = "6b41670516ed8e8b738612f60491995470aa63b3";
  const snapshot = (repo: string) => db.sql`
    INSERT INTO repo_snapshots (repo_full_name, commit_sha, default_branch, archived, readme, topics, languages,
      dep_files, open_issues, good_first_issues, tree, tree_truncated)
    VALUES (${repo}, ${SHA}, 'main', false, '', '[]'::jsonb, '{}'::jsonb, '[]'::jsonb, 0, 0, '[]'::jsonb, false)`;
  const pick = (rank: number, path: string, reason = "core") =>
    db.sql`INSERT INTO core_files (repo_full_name, commit_sha, rank, path, reason) VALUES ('a/b', ${SHA}, ${rank}, ${path}, ${reason})`;
  const rejects = (q: () => Promise<unknown>, re: RegExp) => expect((async () => await q())()).rejects.toThrow(re);

  test("up / down / up with rows present; jobs in the new statuses go back to fetched", async () => {
    await migrateUp(db.sql);
    await db.sql`TRUNCATE repo_snapshots, generation_jobs CASCADE`;
    await snapshot("a/b");
    await pick(1, "src/index.ts");
    await db.sql`INSERT INTO repo_file_cache (repo_full_name, commit_sha, path, content) VALUES ('a/b', ${SHA}, 'src/index.ts', 'x')`;
    await db.sql`INSERT INTO generation_jobs (repo_full_name, commit_sha, status) VALUES ('a/b', ${SHA}, 'picked')`;
    expect(await migrateDown(db.sql, undefined, ALLOW_DOWN)).toBe("0003_core_files");
    expect(await tables(db.sql)).toEqual(ALL.filter((t) => t !== "core_files" && t !== "repo_file_cache"));
    expect((await db.sql`SELECT status FROM generation_jobs`).map((r: { status: string }) => r.status)).toEqual([
      "fetched",
    ]);
    expect(await migrateUp(db.sql)).toEqual(["0003_core_files"]);
    expect(await tables(db.sql)).toEqual(ALL);
  });

  test("rank 1-10, reason 1-300 chars, one rank and one path per repo + SHA; cache paths stay in the repo", async () => {
    await migrateUp(db.sql);
    await db.sql`TRUNCATE repo_snapshots, generation_jobs CASCADE`;
    await snapshot("a/b");
    await pick(1, "a.ts");
    await rejects(() => pick(1, "b.ts"), /duplicate|unique/i);
    await rejects(() => pick(2, "a.ts"), /duplicate|unique/i);
    await rejects(() => pick(11, "c.ts"), /check/i);
    await rejects(() => pick(3, "d.ts", ""), /check/i);
    await rejects(() => pick(3, "d.ts", "r".repeat(301)), /check/i);
    await rejects(
      () =>
        pick(3, "d.ts")
          .then(() => db.sql`DELETE FROM core_files WHERE rank = 3`)
          .then(
            () =>
              db.sql`INSERT INTO core_files (repo_full_name, commit_sha, rank, path, reason) VALUES ('x/y', ${SHA}, 1, 'a', 'r')`,
          ),
      /foreign key/i,
    );
    for (const path of ["../etc/passwd", "/etc/passwd", "a/../b", "./a"]) {
      await rejects(
        () => db.sql`INSERT INTO repo_file_cache (repo_full_name, commit_sha, path) VALUES ('a/b', ${SHA}, ${path})`,
        /check/i,
      );
    }
    // cache content: at most 1,048,576 characters (readFile keeps at most 1 MB)
    await db.sql`INSERT INTO repo_file_cache (repo_full_name, commit_sha, path, content) VALUES ('a/b', ${SHA}, 'max.txt', ${"x".repeat(1048576)})`;
    await rejects(
      () =>
        db.sql`INSERT INTO repo_file_cache (repo_full_name, commit_sha, path, content) VALUES ('a/b', ${SHA}, 'over.txt', ${"x".repeat(1048577)})`,
      /check/i,
    );
    await rejects(
      () => db.sql`INSERT INTO generation_jobs (repo_full_name, commit_sha, status) VALUES ('a/b', ${SHA}, 'done')`,
      /check/i,
    );
    await db.sql`INSERT INTO generation_jobs (repo_full_name, commit_sha, status) VALUES ('a/b', ${SHA}, 'picking')`;
  });
});
