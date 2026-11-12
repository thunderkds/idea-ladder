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
const T0005 = ["card_states", "review_cards", "review_log"];
const ALL = [
  "card_states",
  "generation_job_waiters",
  "generation_jobs",
  "ladder_levels",
  "ladders",
  "repo_confidence",
  "repo_snapshots",
  "review_cards",
  "review_log",
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
    expect(await migrateDown(db.sql, undefined, ALLOW_DOWN)).toBe("0005_review");
    expect(await migrateDown(db.sql, undefined, ALLOW_DOWN)).toBe("0004_ladder_levels");
    expect(await migrateDown(db.sql, undefined, ALLOW_DOWN)).toBe("0002_start_jobs");
    expect(await migrateDown(db.sql, undefined, ALLOW_DOWN)).toBe("0001_init");
    expect(await tables(db.sql)).toEqual([]);
    expect(await extensions(db.sql)).not.toContain("vector");
    expect(await migrateUp(db.sql)).toEqual(["0001_init", "0002_start_jobs", "0004_ladder_levels", "0005_review"]);
    expect(await tables(db.sql)).toEqual(ALL);
  });

  test("down on an empty schema is a no-op", async () => {
    await migrateDown(db.sql, undefined, ALLOW_DOWN);
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
    expect(await migrateDown(db.sql, undefined, ALLOW_DOWN)).toBe("0005_review");
    expect(await tables(db.sql)).toEqual(ALL.filter((t) => !T0005.includes(t)));
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
    expect(await migrateDown(db.sql, undefined, ALLOW_DOWN)).toBe("0005_review");
    expect(await migrateDown(db.sql, undefined, ALLOW_DOWN)).toBe("0004_ladder_levels");
    expect(await migrateDown(db.sql, undefined, ALLOW_DOWN)).toBe("0002_start_jobs");
    expect(await tables(db.sql)).toEqual(T0001);
    expect(await migrateUp(db.sql)).toEqual(["0002_start_jobs", "0004_ladder_levels", "0005_review"]);
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

describe("0004_ladder_levels (T010)", () => {
  const SHA = "6b41670516ed8e8b738612f60491995470aa63b3";
  const level = (id: number, l: string) =>
    db.sql`INSERT INTO ladder_levels (ladder_id, level, title, goal, pass_test_kind, pass_test_description) VALUES (${id}, ${l}, 't', 'g', 'k', 'd')`;

  test("up / down / up with rows present; down drops only ladder_levels", async () => {
    await migrateUp(db.sql);
    const [ladder] =
      await db.sql`INSERT INTO ladders (repo_full_name, commit_sha, status) VALUES ('developit/mitt', ${SHA}, 'unverified') RETURNING id`;
    await level(ladder.id, "L0");
    expect(await migrateDown(db.sql, undefined, ALLOW_DOWN)).toBe("0005_review");
    expect(await migrateDown(db.sql, undefined, ALLOW_DOWN)).toBe("0004_ladder_levels");
    expect(await tables(db.sql)).toEqual(ALL.filter((t) => t !== "ladder_levels" && !T0005.includes(t)));
    expect(await migrateUp(db.sql)).toEqual(["0004_ladder_levels", "0005_review"]);
    expect(await tables(db.sql)).toEqual(ALL);
  });

  test("level is L0..L4 and unique per ladder; the ladder must exist", async () => {
    await migrateUp(db.sql);
    const [ladder] =
      await db.sql`INSERT INTO ladders (repo_full_name, commit_sha, status) VALUES ('lukeed/dset', ${SHA}, 'unverified') RETURNING id`;
    await level(ladder.id, "L1");
    await expect((async () => await level(ladder.id, "L1"))()).rejects.toThrow(/unique|duplicate/i);
    await expect((async () => await level(ladder.id, "L5"))()).rejects.toThrow(/check/i);
    await expect((async () => await level(987654, "L0"))()).rejects.toThrow(/foreign key/i);
  });
});

describe("T011 0005_review", () => {
  const SHA = "6b41670516ed8e8b738612f60491995470aa63b3";
  const seed = async () => {
    const [ladder] =
      await db.sql`INSERT INTO ladders (repo_full_name, commit_sha, status) VALUES ('owner/review-mig', ${SHA}, 'unverified') RETURNING id`;
    const [card] =
      await db.sql`INSERT INTO review_cards (ladder_id, level, front, back) VALUES (${ladder.id}, 'L0', 'q', 'a') RETURNING id`;
    const [user] = await db.sql`INSERT INTO users (github_id, github_login) VALUES (5005, 'rev') RETURNING id`;
    return { ladder: ladder.id, card: card.id, user: user.id };
  };
  const log = (user: string, card: string, key: string, rating = "good") =>
    db.sql`INSERT INTO review_log (learner_id, card_id, rating, state_before, state_after, reviewed_at, elapsed_ms, idempotency_key)
      VALUES (${user}, ${card}, ${rating}, '{}'::jsonb, '{}'::jsonb, now(), 10, ${key})`;

  test("up / down / up with rows present; down drops only the three review tables", async () => {
    await migrateUp(db.sql);
    const { user, card } = await seed();
    await log(user, card, "k1");
    expect(await migrateDown(db.sql, undefined, ALLOW_DOWN)).toBe("0005_review");
    expect(await tables(db.sql)).toEqual(ALL.filter((t) => !T0005.includes(t)));
    expect(await db.sql`SELECT to_regproc('review_log_append_only') AS f`).toEqual([{ f: null }]);
    expect(await migrateUp(db.sql)).toEqual(["0005_review"]);
    expect(await tables(db.sql)).toEqual(ALL);
    await db.sql`TRUNCATE ladders, users CASCADE`;
  });

  test("level and rating are checked; a key is unique per learner; the log is append-only", async () => {
    await migrateUp(db.sql);
    const { ladder, user, card } = await seed();
    await expect(
      (async () =>
        await db.sql`INSERT INTO review_cards (ladder_id, level, front, back) VALUES (${ladder}, 'L5', 'q', 'a')`)(),
    ).rejects.toThrow(/check/i);
    await expect((async () => await log(user, card, "k", "manual"))()).rejects.toThrow(/check/i);
    await log(user, card, "k");
    await expect((async () => await log(user, card, "k"))()).rejects.toThrow(/unique|duplicate/i);
    await expect((async () => await db.sql`UPDATE review_log SET elapsed_ms = 0`)()).rejects.toThrow(/append-only/);
    await expect((async () => await db.sql`DELETE FROM review_log`)()).rejects.toThrow(/append-only/);
    await expect((async () => await db.sql`DELETE FROM review_cards WHERE id = ${card}`)()).rejects.toThrow(
      /foreign key|append-only/i,
    );
    await db.sql`TRUNCATE ladders, users CASCADE`;
  });
});
