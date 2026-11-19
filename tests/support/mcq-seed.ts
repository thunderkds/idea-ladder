// T012: seed a ladder with MCQ pools and review cards for the pass-test tests. Each MCQ cites its own chunk and has
// one review card on that chunk. The key option is `key-<n>`, the wrong ones `w1-<n>`..`w3-<n>`.
import type { SQL } from "bun";

let n = 0;

/** A user; returns its id. */
export async function seedLearner(sql: SQL, login = `learner${n}`): Promise<string> {
  const [{ id }] = await sql`
    INSERT INTO users (github_id, github_login) VALUES (${100_000 + n++}, ${login}) RETURNING id::text AS id`;
  return id;
}

export type SeededLadder = { ladderId: string; repo: string; sha: string };

/** A ladder on a fresh snapshot; returns its id, repo and SHA. */
export async function seedLadder(sql: SQL): Promise<SeededLadder> {
  const repo = `owner/repo-${n++}`;
  const sha = `3f2a9c1${String(n).padStart(33, "0")}`;
  await sql`INSERT INTO repo_snapshots (repo_full_name, commit_sha, default_branch, archived, readme, topics, languages, dep_files, open_issues, good_first_issues, tree, tree_truncated)
    VALUES (${repo}, ${sha}, 'main', false, 'readme', '[]'::jsonb, '{}'::jsonb, '[]'::jsonb, 0, 0, '[]'::jsonb, false)`;
  const [{ id }] = await sql`
    INSERT INTO ladders (repo_full_name, commit_sha, status) VALUES (${repo}, ${sha}, 'unverified') RETURNING id::text AS id`;
  return { ladderId: id, repo, sha };
}

/** A chunk; works with and without the embedding columns (T031 drops them). */
async function seedChunk(sql: SQL, repo: string, sha: string): Promise<string> {
  const cols = (await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'chunks'`).map(
    (r: { column_name: string }) => r.column_name,
  );
  const names = ["repo_full_name", "commit_sha", "source", "path", "ordinal", "start_line", "end_line", "text"];
  const values: unknown[] = [repo, sha, "core", "src/a.ts", n++, 1, 2, "chunk text"];
  if (cols.includes("embedding")) {
    names.push("embedding");
    values.push(`[${new Array(1536).fill(0).join(",")}]`);
  }
  if (cols.includes("embedding_model")) {
    names.push("embedding_model");
    values.push("test-embedding");
  }
  const params = values.map((_, i) => `$${i + 1}`).join(", ");
  const [{ id }] = await sql.unsafe(
    `INSERT INTO chunks (${names.join(", ")}) VALUES (${params}) RETURNING id::text AS id`,
    values,
  );
  return id;
}

export type SeededMcq = { id: string; cardId: string };

/** `count` MCQs on this ladder + level, each with a card on the same chunk. */
export async function seedPool(sql: SQL, ladder: SeededLadder, level: string, count: number): Promise<SeededMcq[]> {
  const out: SeededMcq[] = [];
  for (let p = 0; p < count; p++) {
    const chunkId = await seedChunk(sql, ladder.repo, ladder.sha);
    const options = [`key-${p}`, `w1-${p}`, `w2-${p}`, `w3-${p}`];
    const [{ id }] = await sql`
      INSERT INTO mcqs (ladder_id, level, position, question, options, key, chunk_id)
      VALUES (${ladder.ladderId}, ${level}, ${p}, ${`Question ${level} ${p}?`}, ${options}::jsonb, ${`key-${p}`}, ${chunkId})
      RETURNING id::text AS id`;
    const [{ id: cardId }] = await sql`
      INSERT INTO cards (ladder_id, level, position, front, back, chunk_id)
      VALUES (${ladder.ladderId}, ${level}, ${p}, ${`front ${p}`}, ${`back ${p}`}, ${chunkId}) RETURNING id::text AS id`;
    out.push({ id, cardId });
  }
  return out;
}
