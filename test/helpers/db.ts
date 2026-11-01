import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import pg from 'pg';

const run = promisify(execFile);

export const ADMIN_URL =
  process.env.DATABASE_URL ?? 'postgres://idea_ladder:idea_ladder@localhost:54329/idea_ladder';

export function urlForDatabase(name: string): string {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${name}`;
  return u.toString();
}

export async function runMigrate(databaseUrl: string, direction: 'up' | 'down'): Promise<void> {
  const script = direction === 'up' ? 'db:migrate' : 'db:migrate:down';
  await run('pnpm', ['--silent', script], { env: { ...process.env, DATABASE_URL: databaseUrl } });
}

export interface TempDb {
  url: string;
  name: string;
  drop: () => Promise<void>;
}

export async function recreateDatabase(name: string): Promise<void> {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }
}

export async function createTempDb(): Promise<TempDb> {
  const name = `il_test_${randomBytes(6).toString('hex')}`;
  await recreateDatabase(name);
  return {
    name,
    url: urlForDatabase(name),
    drop: async () => {
      const admin = new pg.Client({ connectionString: ADMIN_URL });
      await admin.connect();
      try {
        await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      } finally {
        await admin.end();
      }
    },
  };
}
