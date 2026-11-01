import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTempDb, runMigrate, type TempDb } from './helpers/db.js';

let db: TempDb;

const APP_TABLES = [
  'card_states',
  'cards',
  'generation_jobs',
  'ladders',
  'push_subscriptions',
  'repo_confidence',
  'repo_snapshots',
  'review_log',
  'sessions',
  'users',
];

async function query<T extends pg.QueryResultRow>(sql: string): Promise<T[]> {
  const client = new pg.Client({ connectionString: db.url });
  await client.connect();
  try {
    return (await client.query<T>(sql)).rows;
  } finally {
    await client.end();
  }
}

const appTables = `SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name <> 'pgmigrations' ORDER BY table_name`;

beforeAll(async () => {
  db = await createTempDb();
});
afterAll(async () => {
  await db.drop();
});

describe('migrations', () => {
  it('up creates vector and the app tables; down empties the schema; up works again', async () => {
    await runMigrate(db.url, 'up');
    expect((await query<{ extname: string }>('SELECT extname FROM pg_extension')).map((r) => r.extname)).toContain(
      'vector',
    );
    expect((await query<{ table_name: string }>(appTables)).map((r) => r.table_name)).toEqual(APP_TABLES);
    const cols = await query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'users'`,
    );
    expect(cols.map((c) => c.column_name).sort()).toEqual(
      ['created_at', 'github_id', 'github_login', 'id', 'updated_at'].sort(),
    );
    const unique = await query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE tablename = 'users' AND indexdef ILIKE '%UNIQUE%github_id%'`,
    );
    expect(unique).toHaveLength(1);

    await runMigrate(db.url, 'down');
    expect(await query(appTables)).toEqual([]);
    expect((await query<{ extname: string }>('SELECT extname FROM pg_extension')).map((r) => r.extname)).not.toContain(
      'vector',
    );

    await runMigrate(db.url, 'up');
    expect((await query<{ table_name: string }>(appTables)).map((r) => r.table_name)).toEqual(APP_TABLES);
  });
});
