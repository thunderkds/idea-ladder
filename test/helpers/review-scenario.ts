import { randomBytes } from 'node:crypto';
import { initialState, stateToJson } from '../../src/review/scheduler.js';
import type { TestApp } from './app.js';

export const days = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
export const minutes = (d: Date, m: number) => new Date(d.getTime() + m * 60_000);

export interface Scenario {
  cookie: string;
  userId: string;
  ladderId: string;
  card: (level: string, front?: string) => Promise<string>;
  /** Gives the learner a stored FSRS state for a card, due at `due`, last reviewed 5 days before. */
  seedDue: (cardId: string, due: Date) => Promise<void>;
}

let seq = 9000;

/** A fresh learner who started a fresh ladder. Rows are never deleted: review_log is append-only. */
export async function scenario(t: TestApp): Promise<Scenario> {
  const githubId = seq++;
  const cookie = await t.signIn(githubId);
  const userId = (await t.pool.query<{ id: string }>('SELECT id FROM users WHERE github_id = $1', [githubId])).rows[0]!.id;
  const repo = `owner/t015repo${githubId}`;
  const sha = randomBytes(20).toString('hex');
  const ladderId = (await t.pool.query<{ id: string }>('INSERT INTO ladders (repo_full_name, commit_sha) VALUES ($1, $2) RETURNING id', [repo, sha])).rows[0]!.id;
  await t.pool.query(`INSERT INTO generation_jobs (repo_full_name, commit_sha, status, started_by) VALUES ($1, $2, 'fetched', $3)`, [repo, sha, userId]);
  return {
    cookie,
    userId,
    ladderId,
    card: async (level, front = `question ${seq++}`) =>
      (await t.pool.query<{ id: string }>(`INSERT INTO cards (ladder_id, level_id, front, back) VALUES ($1, $2, $3, 'answer') RETURNING id`, [ladderId, level, front])).rows[0]!.id,
    seedDue: async (cardId, due) => {
      const s = stateToJson({ ...initialState(due), state: 2, reps: 3, stability: 5, difficulty: 5, lastReview: days(due, -5) });
      await t.pool.query(
        `INSERT INTO card_states (user_id, card_id, due, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps, lapses, state, last_review)
         VALUES ($1, $2, $3, $4, $5, 0, 5, 0, 3, 0, 2, $6)`,
        [userId, cardId, due, s.stability, s.difficulty, days(due, -5)],
      );
    },
  };
}

export function postJson(t: TestApp, path: string, cookie: string | undefined, body: unknown, headers: Record<string, string> = {}) {
  return t.app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}
