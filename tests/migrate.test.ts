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
const extensions = async (sql: SQL) =>
  (await sql`SELECT extname FROM pg_extension`).map((r: { extname: string }) => r.extname);

describe("migrations (AC 1)", () => {
  test("up creates vector, users and sessions", async () => {
    await migrateUp(db.sql);
    expect(await extensions(db.sql)).toContain("vector");
    expect(await tables(db.sql)).toEqual(["schema_migrations", "sessions", "users"]);
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
    await migrateDown(db.sql, undefined, ALLOW_DOWN);
    expect(await tables(db.sql)).toEqual([]);
    expect(await extensions(db.sql)).not.toContain("vector");
    expect(await migrateUp(db.sql)).toEqual(["0001_init"]);
    expect(await tables(db.sql)).toEqual(["schema_migrations", "sessions", "users"]);
  });

  test("down on an empty schema is a no-op", async () => {
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
    expect(await userTables(db.sql)).toEqual(["sessions", "users"]);
  });

  test("refused when NODE_ENV=production, even with MIGRATE_ALLOW_DOWN=1", async () => {
    await migrateUp(db.sql);
    await expect(migrateDown(db.sql, undefined, { MIGRATE_ALLOW_DOWN: "1", NODE_ENV: "production" })).rejects.toThrow(
      /NODE_ENV=production.*MIGRATE_ALLOW_DOWN/,
    );
    expect(await userTables(db.sql)).toEqual(["sessions", "users"]);
  });

  test("allowed with MIGRATE_ALLOW_DOWN=1", async () => {
    await migrateUp(db.sql);
    expect(await migrateDown(db.sql, undefined, ALLOW_DOWN)).toBe("0001_init");
    expect(await tables(db.sql)).toEqual([]);
  });

  test("CLI `bun run db:migrate:down` without the opt-in exits 1 and names the variable", async () => {
    await migrateUp(db.sql);
    const { MIGRATE_ALLOW_DOWN: _unset, ...env } = process.env;
    const proc = Bun.spawnSync(["bun", "run", "db:migrate:down"], { env: { ...env, DATABASE_URL: db.url } });
    expect(proc.exitCode).toBe(1);
    expect(proc.stderr.toString()).toContain("MIGRATE_ALLOW_DOWN=1");
    expect(await userTables(db.sql)).toEqual(["sessions", "users"]);
  });
});
