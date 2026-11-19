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
const T0006 = ["push_subscriptions"];
const T0007 = ["learner_concepts", "repo_concepts"];
const T0008 = ["chunks"];
const ALL = [
  "card_states",
  "chunks",
  "core_files",
  "generation_job_waiters",
  "generation_jobs",
  "ladder_levels",
  "ladders",
  "learner_concepts",
  "push_subscriptions",
  "repo_concepts",
  "repo_confidence",
  "repo_file_cache",
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
    expect(await migrateDown(db.sql, undefined, ALLOW_DOWN)).toBe("0008_generation");
    expect(await migrateDown(db.sql, undefined, ALLOW_DOWN)).toBe("0007_concepts");
    expect(await migrateDown(db.sql, undefined, ALLOW_DOWN)).toBe("0006_push_subscriptions");
    expect(await migrateDown(db.sql, undefined, ALLOW_DOWN)).toBe("0005_review");
    expect(await migrateDown(db.sql, undefined, ALLOW_DOWN)).toBe("0004_ladder_levels");
    expect(await migrateDown(db.sql, undefined, ALLOW_DOWN)).toBe("0003_core_files");
    expect(await migrateDown(db.sql, undefined, ALLOW_DOWN)).toBe("0002_start_jobs");
    expect(await migrateDown(db.sql, undefined, ALLOW_DOWN)).toBe("0001_init");
    expect(await tables(db.sql)).toEqual([]);
    expect(await extensions(db.sql)).not.toContain("vector");
    expect(await migrateUp(db.sql)).toEqual([
      "0001_init",
      "0002_start_jobs",
      "0003_core_files",
      "0004_ladder_levels",
      "0005_review",
      "0006_push_subscriptions",
      "0007_concepts",
      "0008_generation",
    ]);
    expect(await tables(db.sql)).toEqual(ALL);
  });

  test("down on an empty schema is a no-op", async () => {
    await migrateDown(db.sql, undefined, ALLOW_DOWN);
    await migrateDown(db.sql, undefined, ALLOW_DOWN);
    await migrateDown(db.sql, undefined, ALLOW_DOWN);
    await migrateDown(db.sql, undefined, ALLOW_DOWN);
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
    expect(await migrateDown(db.sql, undefined, ALLOW_DOWN)).toBe("0008_generation");
    expect(await migrateDown(db.sql, undefined, ALLOW_DOWN)).toBe("0007_concepts");
    expect(await migrateDown(db.sql, undefined, ALLOW_DOWN)).toBe("0006_push_subscriptions");
    expect(await migrateDown(db.sql, undefined, ALLOW_DOWN)).toBe("0005_review");
    expect(await tables(db.sql)).toEqual(
      ALL.filter((t) => !T0005.includes(t) && !T0006.includes(t) && !T0007.includes(t) && !T0008.includes(t)),
    );
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
    expect(await migrateDown(db.sql, undefined, ALLOW_DOWN)).toBe("0008_generation");
    expect(await migrateDown(db.sql, undefined, ALLOW_DOWN)).toBe("0007_concepts");
    expect(await migrateDown(db.sql, undefined, ALLOW_DOWN)).toBe("0006_push_subscriptions");
    expect(await migrateDown(db.sql, undefined, ALLOW_DOWN)).toBe("0005_review");
    expect(await migrateDown(db.sql, undefined, ALLOW_DOWN)).toBe("0004_ladder_levels");
    expect(await migrateDown(db.sql, undefined, ALLOW_DOWN)).toBe("0003_core_files");
    expect(await migrateDown(db.sql, undefined, ALLOW_DOWN)).toBe("0002_start_jobs");
    expect(await tables(db.sql)).toEqual(T0001);
    expect(await migrateUp(db.sql)).toEqual([
      "0002_start_jobs",
      "0003_core_files",
      "0004_ladder_levels",
      "0005_review",
      "0006_push_subscriptions",
      "0007_concepts",
      "0008_generation",
    ]);
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
    expect(await migrateDown(db.sql, undefined, ALLOW_DOWN)).toBe("0008_generation");
    expect(await migrateDown(db.sql, undefined, ALLOW_DOWN)).toBe("0007_concepts");
    expect(await migrateDown(db.sql, undefined, ALLOW_DOWN)).toBe("0006_push_subscriptions");
    expect(await migrateDown(db.sql, undefined, ALLOW_DOWN)).toBe("0005_review");
    expect(await migrateDown(db.sql, undefined, ALLOW_DOWN)).toBe("0004_ladder_levels");
    expect(await migrateDown(db.sql, undefined, ALLOW_DOWN)).toBe("0003_core_files");
    expect(await tables(db.sql)).toEqual(
      ALL.filter(
        (t) =>
          t !== "core_files" &&
          t !== "repo_file_cache" &&
          t !== "ladder_levels" &&
          !T0005.includes(t) &&
          !T0006.includes(t) &&
          !T0007.includes(t) && !T0008.includes(t),
      ),
    );
    expect((await db.sql`SELECT status FROM generation_jobs`).map((r: { status: string }) => r.status)).toEqual([
      "fetched",
    ]);
    expect(await migrateUp(db.sql)).toEqual([
      "0003_core_files",
      "0004_ladder_levels",
      "0005_review",
      "0006_push_subscriptions",
      "0007_concepts",
      "0008_generation",
    ]);
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

describe("0004_ladder_levels (T010)", () => {
  const SHA = "6b41670516ed8e8b738612f60491995470aa63b3";
  const level = (id: number, l: string) =>
    db.sql`INSERT INTO ladder_levels (ladder_id, level, title, goal, pass_test_kind, pass_test_description) VALUES (${id}, ${l}, 't', 'g', 'k', 'd')`;

  test("up / down / up with rows present; down drops only ladder_levels", async () => {
    await migrateUp(db.sql);
    const [ladder] =
      await db.sql`INSERT INTO ladders (repo_full_name, commit_sha, status) VALUES ('developit/mitt', ${SHA}, 'unverified') RETURNING id`;
    await level(ladder.id, "L0");
    expect(await migrateDown(db.sql, undefined, ALLOW_DOWN)).toBe("0008_generation");
    expect(await migrateDown(db.sql, undefined, ALLOW_DOWN)).toBe("0007_concepts");
    expect(await migrateDown(db.sql, undefined, ALLOW_DOWN)).toBe("0006_push_subscriptions");
    expect(await migrateDown(db.sql, undefined, ALLOW_DOWN)).toBe("0005_review");
    expect(await migrateDown(db.sql, undefined, ALLOW_DOWN)).toBe("0004_ladder_levels");
    expect(await tables(db.sql)).toEqual(
      ALL.filter((t) => t !== "ladder_levels" && !T0005.includes(t) && !T0006.includes(t) && !T0007.includes(t) && !T0008.includes(t)),
    );
    expect(await migrateUp(db.sql)).toEqual([
      "0004_ladder_levels",
      "0005_review",
      "0006_push_subscriptions",
      "0007_concepts",
      "0008_generation",
    ]);
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
    expect(await migrateDown(db.sql, undefined, ALLOW_DOWN)).toBe("0008_generation");
    expect(await migrateDown(db.sql, undefined, ALLOW_DOWN)).toBe("0007_concepts");
    expect(await migrateDown(db.sql, undefined, ALLOW_DOWN)).toBe("0006_push_subscriptions");
    expect(await migrateDown(db.sql, undefined, ALLOW_DOWN)).toBe("0005_review");
    expect(await tables(db.sql)).toEqual(
      ALL.filter((t) => !T0005.includes(t) && !T0006.includes(t) && !T0007.includes(t) && !T0008.includes(t)),
    );
    expect(await db.sql`SELECT to_regproc('review_log_append_only') AS f`).toEqual([{ f: null }]);
    expect(await migrateUp(db.sql)).toEqual(["0005_review", "0006_push_subscriptions", "0007_concepts", "0008_generation"]);
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

describe("T015 0006_push_subscriptions", () => {
  const sub = (user: string, endpoint: string, hour = 9, timezone = "Europe/Berlin") =>
    db.sql`INSERT INTO push_subscriptions (learner_id, endpoint, p256dh, auth, reminder_hour, timezone)
      VALUES (${user}, ${endpoint}, 'p', 'a', ${hour}, ${timezone})`;
  const user = async (githubId: number) =>
    (await db.sql`INSERT INTO users (github_id, github_login) VALUES (${githubId}, 'push') RETURNING id`)[0]
      .id as string;

  test("up / down / up with rows present; down drops only push_subscriptions", async () => {
    await migrateUp(db.sql);
    await sub(await user(6006), "https://fcm.googleapis.com/fcm/send/a");
    expect(await migrateDown(db.sql, undefined, ALLOW_DOWN)).toBe("0008_generation");
    expect(await migrateDown(db.sql, undefined, ALLOW_DOWN)).toBe("0007_concepts");
    expect(await migrateDown(db.sql, undefined, ALLOW_DOWN)).toBe("0006_push_subscriptions");
    expect(await tables(db.sql)).toEqual(ALL.filter((t) => !T0006.includes(t) && !T0007.includes(t) && !T0008.includes(t)));
    expect(await migrateUp(db.sql)).toEqual(["0006_push_subscriptions", "0007_concepts", "0008_generation"]);
    expect(await tables(db.sql)).toEqual(ALL);
    await db.sql`TRUNCATE users CASCADE`;
  });

  test("columns; endpoint unique; hour 0-23; rows go with their learner", async () => {
    await migrateUp(db.sql);
    const cols =
      await db.sql`SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = 'push_subscriptions' ORDER BY ordinal_position`;
    expect(cols.map((c: { column_name: string; is_nullable: string }) => `${c.column_name}:${c.is_nullable}`)).toEqual([
      "id:NO",
      "learner_id:NO",
      "endpoint:NO",
      "p256dh:NO",
      "auth:NO",
      "reminder_hour:NO",
      "timezone:NO",
      "created_at:NO",
      "last_sent_at:YES",
    ]);
    const a = await user(6007);
    await sub(a, "https://fcm.googleapis.com/fcm/send/one");
    await expect((async () => await sub(a, "https://fcm.googleapis.com/fcm/send/one"))()).rejects.toThrow(
      /unique|duplicate/i,
    );
    await expect((async () => await sub(a, "https://fcm.googleapis.com/fcm/send/h24", 24))()).rejects.toThrow(/check/i);
    await expect((async () => await sub(a, "https://fcm.googleapis.com/fcm/send/h-1", -1))()).rejects.toThrow(/check/i);
    await sub(a, "https://fcm.googleapis.com/fcm/send/h0", 0);
    await sub(a, "https://fcm.googleapis.com/fcm/send/h23", 23);
    await db.sql`DELETE FROM users WHERE id = ${a}`;
    expect(await db.sql`SELECT count(*)::int AS n FROM push_subscriptions`).toEqual([{ n: 0 }]);
  });
});

describe("T007 0007_concepts", () => {
  const SHA = "6b41670516ed8e8b738612f60491995470aa63b3";
  test("job statuses mapping and mapped allowed; concepts go with their snapshot and learner; down resets jobs to picked", async () => {
    await migrateUp(db.sql);
    await db.sql`TRUNCATE repo_snapshots, generation_jobs CASCADE`;
    await db.sql`INSERT INTO repo_snapshots (repo_full_name, commit_sha, default_branch, archived, readme, topics, languages, dep_files, open_issues, good_first_issues, tree, tree_truncated)
      VALUES ('a/b', ${SHA}, 'main', false, 'r', '[]'::jsonb, '{}'::jsonb, '[]'::jsonb, 0, 0, '[]'::jsonb, false)`;
    await db.sql`INSERT INTO repo_concepts (repo_full_name, commit_sha, position, name, slug, reason, basis)
      VALUES ('a/b', ${SHA}, 1, 'Event emitter', 'event-emitter', 'why', '["readme"]'::jsonb)`;
    await expect(
      (async () =>
        await db.sql`INSERT INTO repo_concepts (repo_full_name, commit_sha, position, name, slug, reason, basis)
          VALUES ('a/b', ${SHA}, 2, 'Event emitter 2', 'event-emitter', 'why', '["readme"]'::jsonb)`)(),
    ).rejects.toThrow(/unique|duplicate/i);
    await db.sql`INSERT INTO generation_jobs (repo_full_name, commit_sha, status) VALUES ('a/b', ${SHA}, 'mapped')`;
    expect(await migrateDown(db.sql, undefined, ALLOW_DOWN)).toBe("0008_generation");
    expect(await migrateDown(db.sql, undefined, ALLOW_DOWN)).toBe("0007_concepts");
    expect(await db.sql`SELECT status FROM generation_jobs`).toEqual([{ status: "picked" }]);
    expect(await migrateUp(db.sql)).toEqual(["0007_concepts", "0008_generation"]);
    await db.sql`TRUNCATE repo_snapshots, generation_jobs CASCADE`;
    expect(await db.sql`SELECT count(*)::int AS n FROM repo_concepts`).toEqual([{ n: 0 }]);
  });
});

describe("T008 0008_generation", () => {
  const SHA = "6b41670516ed8e8b738612f60491995470aa63b3";
  const vec = (x: number, dims = 1536) => `[${Array.from({ length: dims }, (_, i) => (i === 0 ? x : 0)).join(",")}]`;
  const chunk = (ordinal: number, opts: { source?: string; path?: string; dims?: number; repo?: string } = {}) =>
    db.sql`INSERT INTO chunks (repo_full_name, commit_sha, source, path, ordinal, start_line, end_line, text, embedding, embedding_model)
      VALUES (${opts.repo ?? "a/b"}, ${SHA}, ${opts.source ?? "core"}, ${opts.path ?? "src/index.ts"}, ${ordinal}, 1, 40, 'text',
        ${vec(1, opts.dims)}::vector, 'text-embedding-3-small')`;
  const rejects = (q: () => Promise<unknown>, re: RegExp) => expect((async () => await q())()).rejects.toThrow(re);

  test("up / down / up with rows present; down drops only chunks", async () => {
    await migrateUp(db.sql);
    await db.sql`TRUNCATE repo_snapshots, generation_jobs CASCADE`;
    await db.sql`INSERT INTO repo_snapshots (repo_full_name, commit_sha, default_branch, archived, readme, topics, languages, dep_files, open_issues, good_first_issues, tree, tree_truncated)
      VALUES ('a/b', ${SHA}, 'main', false, 'r', '[]'::jsonb, '{}'::jsonb, '[]'::jsonb, 0, 0, '[]'::jsonb, false)`;
    await chunk(0);
    expect(await migrateDown(db.sql, undefined, ALLOW_DOWN)).toBe("0008_generation");
    expect(await tables(db.sql)).toEqual(ALL.filter((t) => !T0008.includes(t)));
    expect(await migrateUp(db.sql)).toEqual(["0008_generation"]);
    expect(await tables(db.sql)).toEqual(ALL);
  });

  test("one row per repo + SHA + source + path + ordinal; source, lines and a 1536-dim vector are checked; rows go with their snapshot", async () => {
    await migrateUp(db.sql);
    await db.sql`TRUNCATE repo_snapshots, generation_jobs CASCADE`;
    await db.sql`INSERT INTO repo_snapshots (repo_full_name, commit_sha, default_branch, archived, readme, topics, languages, dep_files, open_issues, good_first_issues, tree, tree_truncated)
      VALUES ('a/b', ${SHA}, 'main', false, 'r', '[]'::jsonb, '{}'::jsonb, '[]'::jsonb, 0, 0, '[]'::jsonb, false)`;
    await chunk(0);
    await rejects(() => chunk(0), /unique|duplicate/i);
    await chunk(0, { source: "readme" }); // same path under another source is another chunk
    await rejects(() => chunk(1, { source: "issue" }), /check/i);
    await rejects(() => chunk(2, { dims: 3 }), /dimension/i);
    await rejects(() => chunk(3, { repo: "x/y" }), /foreign key/i);
    await rejects(
      () =>
        db.sql`INSERT INTO chunks (repo_full_name, commit_sha, source, path, ordinal, start_line, end_line, text, embedding, embedding_model)
          VALUES ('a/b', ${SHA}, 'core', 'z.ts', 0, 5, 4, 't', ${vec(1)}::vector, 'm')`,
      /check/i,
    );
    await db.sql`DELETE FROM repo_snapshots`;
    expect(await db.sql`SELECT count(*)::int AS n FROM chunks`).toEqual([{ n: 0 }]);
  });
});
