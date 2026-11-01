import pg from 'pg';

export function createPool(databaseUrl: string): pg.Pool {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
  // Without a listener, a dropped idle connection is an unhandled 'error' event and stops the process.
  pool.on('error', (err) => console.error('Idle database connection lost:', err.message));
  return pool;
}
