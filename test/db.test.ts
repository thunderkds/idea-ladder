import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createPool } from '../src/db.js';
import { createTempDb, type TempDb } from './helpers/db.js';

let db: TempDb;
let pool: pg.Pool;

beforeAll(async () => {
  db = await createTempDb();
  pool = createPool(db.url);
});
afterAll(async () => {
  await pool.end();
  await db.drop();
});

describe('createPool', () => {
  it('survives losing an idle connection and serves the next query', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { rows } = await pool.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
    const lost = new Promise((resolve) => pool.once('remove', resolve));

    const admin = new pg.Client({ connectionString: db.url });
    await admin.connect();
    await admin.query('SELECT pg_terminate_backend($1)', [rows[0]?.pid]);
    await admin.end();
    await lost;

    expect((await pool.query('SELECT 1 AS ok')).rows).toEqual([{ ok: 1 }]);
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});
