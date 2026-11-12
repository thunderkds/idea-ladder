import { SQL } from "bun";

/** Server-level URL for tests: DATABASE_URL, else the docker compose database. */
export const adminUrl = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:54329/idea_ladder";

/** Creates an empty, uniquely named database; `drop()` removes it. */
export async function createTestDatabase(): Promise<{ url: string; sql: SQL; drop: () => Promise<void> }> {
  const name = `il_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const admin = new SQL(adminUrl);
  await admin.unsafe(`CREATE DATABASE "${name}"`);
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const sql = new SQL(url.toString());
  return {
    url: url.toString(),
    sql,
    drop: async () => {
      await sql.close();
      await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await admin.close();
    },
  };
}
