import type pg from 'pg';
import type { CoreFile } from './repo-reader.js';

export interface StoredCoreFile extends CoreFile {
  rank: number;
}

export async function getCoreFiles(pool: pg.Pool, repoFullName: string, sha: string): Promise<StoredCoreFile[]> {
  const { rows } = await pool.query<StoredCoreFile>(
    'SELECT rank, path, reason FROM core_files WHERE repo_full_name = $1 AND commit_sha = $2 ORDER BY rank',
    [repoFullName.toLowerCase(), sha],
  );
  return rows;
}

/** One transaction: replace the picks for this repo + SHA (rank 1 = most important) and mark the job `picked`. */
export async function saveCoreFiles(pool: pg.Pool, jobId: string, repoFullName: string, sha: string, coreFiles: CoreFile[]): Promise<void> {
  const key = repoFullName.toLowerCase();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM core_files WHERE repo_full_name = $1 AND commit_sha = $2', [key, sha]);
    for (const [i, f] of coreFiles.entries()) {
      await client.query('INSERT INTO core_files (repo_full_name, commit_sha, rank, path, reason) VALUES ($1, $2, $3, $4, $5)', [key, sha, i + 1, f.path, f.reason]);
    }
    await client.query(`UPDATE generation_jobs SET status = 'picked', reason = NULL, updated_at = now() WHERE id = $1`, [jobId]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
