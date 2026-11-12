// Minimal SQL migration runner on Bun's built-in Postgres client.
// Files: migrations/NNNN_name.up.sql + NNNN_name.down.sql. Each file runs in one transaction.
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { SQL } from "bun";

const DEFAULT_DIR = join(import.meta.dir, "../../migrations");
const LOCK_ID = 7_424_100; // pg_advisory_xact_lock key: serialises concurrent runners

const TRACKING_TABLE = `CREATE TABLE IF NOT EXISTS schema_migrations (
  name text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
)`;

async function migrationNames(dir: string): Promise<string[]> {
  return (await readdir(dir))
    .filter((f) => f.endsWith(".up.sql"))
    .map((f) => f.slice(0, -".up.sql".length))
    .sort();
}

/** Re-throws a Postgres error with the migration name, and a clear hint for a missing extension. */
function explain(name: string, err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err);
  const ext =
    /extension "([^"]+)" is not available|could not open extension control file "[^"]*\/([^"/]+)\.control"/.exec(
      message,
    );
  if (ext) {
    const extName = ext[1] ?? ext[2];
    return new Error(
      `Migration ${name} failed: extension "${extName}" is not installed on this Postgres server. ` +
        `Use a Postgres with the extension (pgvector/pgvector image for "vector"). Nothing was applied. (${message})`,
    );
  }
  return new Error(`Migration ${name} failed, nothing from it was applied: ${message}`);
}

/** Applies every pending migration in name order. Returns the names applied. */
export async function migrateUp(sql: SQL, dir = DEFAULT_DIR): Promise<string[]> {
  const applied: string[] = [];
  for (const name of await migrationNames(dir)) {
    const text = await Bun.file(join(dir, `${name}.up.sql`)).text();
    const done = await sql
      .begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(${LOCK_ID})`;
        await tx.unsafe(TRACKING_TABLE);
        if ((await tx`SELECT 1 FROM schema_migrations WHERE name = ${name}`).length) return false;
        await tx.unsafe(text);
        await tx`INSERT INTO schema_migrations (name) VALUES (${name})`;
        return true;
      })
      .catch((err) => {
        throw explain(name, err);
      });
    if (done) applied.push(name);
  }
  return applied;
}

/**
 * Reverts the most recent migration. DESTRUCTIVE: the down files drop tables and their rows.
 * When the last migration is reverted, the tracking table is dropped too (empty schema).
 * Returns the name reverted, or undefined when nothing was applied.
 * Refuses to run unless `MIGRATE_ALLOW_DOWN=1`, and always refuses when `NODE_ENV=production`.
 */
export async function migrateDown(
  sql: SQL,
  dir = DEFAULT_DIR,
  env: Record<string, string | undefined> = process.env,
): Promise<string | undefined> {
  if (env.NODE_ENV === "production") {
    throw new Error(
      "Refusing to run the down migration: NODE_ENV=production. Down drops tables and data; MIGRATE_ALLOW_DOWN is ignored in production.",
    );
  }
  if (env.MIGRATE_ALLOW_DOWN !== "1") {
    throw new Error(
      "Refusing to run the down migration: it drops tables and data. Set MIGRATE_ALLOW_DOWN=1 to allow it (throwaway databases only).",
    );
  }
  return sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(${LOCK_ID})`;
    if (!(await tx`SELECT to_regclass('public.schema_migrations') AS t`)[0].t) return undefined;
    const last = (await tx`SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 1`)[0]?.name as
      | string
      | undefined;
    if (last) {
      const text = await Bun.file(join(dir, `${last}.down.sql`)).text();
      await tx.unsafe(text).catch((err: unknown) => {
        throw explain(last, err);
      });
      await tx`DELETE FROM schema_migrations WHERE name = ${last}`;
    }
    if (!(await tx`SELECT 1 FROM schema_migrations LIMIT 1`).length) await tx.unsafe("DROP TABLE schema_migrations");
    return last;
  });
}

if (import.meta.main) {
  const command = process.argv[2];
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("Invalid configuration: missing required environment variable(s): DATABASE_URL");
    process.exit(1);
  }
  if (command !== "up" && command !== "down") {
    console.error("usage: bun src/server/migrate.ts up|down");
    process.exit(1);
  }
  const sql = new SQL(url);
  try {
    if (command === "up") {
      const applied = await migrateUp(sql);
      console.log(applied.length ? `applied: ${applied.join(", ")}` : "up to date: nothing to apply");
    } else {
      const reverted = await migrateDown(sql);
      console.log(reverted ? `reverted: ${reverted}` : "nothing to revert");
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    await sql.close();
  }
}
