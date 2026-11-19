// T007: a learner's own concept list for one ladder. The shared `repo_concepts` rows (one per repo + SHA) are only
// read here, never written: an edit changes what this learner sees and nothing for other learners.
import type { SQL } from "bun";
import { conceptSlug, type ListProblem, validateConceptNames } from "../shared/concepts.ts";

export type ConceptItem = { name: string; slug: string; reason?: string };
export type ConceptsView = { concepts: ConceptItem[]; edited: boolean; fallbackToConcepts: boolean };

const LADDER_ID = /^[1-9][0-9]{0,17}$/; // same rule as ladder-view.ts: fits a bigint
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are stripped on purpose
const CONTROL_RUNS = /[\u0000-\u001f\u007f]+/g;
const clean = (text: string) => text.replace(CONTROL_RUNS, " ").trim();

async function ladderRepo(sql: SQL, ladderId: string) {
  if (!LADDER_ID.test(ladderId)) return undefined;
  const [l] = await sql`SELECT repo_full_name, commit_sha FROM ladders WHERE id = ${ladderId}`;
  return l as { repo_full_name: string; commit_sha: string } | undefined;
}

const sharedConcepts = async (sql: SQL, repo: string, sha: string) =>
  (await sql`
    SELECT name, slug, reason FROM repo_concepts
    WHERE repo_full_name = ${repo} AND commit_sha = ${sha} ORDER BY position`) as ConceptItem[];

/** `not-found` for an unknown ladder, `concepts-not-found` for one whose repo has no shared concepts. */
export async function getConcepts(
  sql: SQL,
  ladderId: string,
  userId: string,
): Promise<ConceptsView | "not-found" | "concepts-not-found"> {
  const ladder = await ladderRepo(sql, ladderId);
  if (!ladder) return "not-found";
  const shared = await sharedConcepts(sql, ladder.repo_full_name, ladder.commit_sha);
  if (shared.length === 0) return "concepts-not-found";
  const [conf] = await sql`
    SELECT fallback_to_concepts FROM repo_confidence
    WHERE repo_full_name = ${ladder.repo_full_name} AND commit_sha = ${ladder.commit_sha}`;
  const fallbackToConcepts = conf?.fallback_to_concepts === true;
  const [own] = await sql`SELECT concepts FROM learner_concepts WHERE user_id = ${userId} AND ladder_id = ${ladderId}`;
  if (own) return { concepts: own.concepts as ConceptItem[], edited: true, fallbackToConcepts };
  return {
    concepts: shared.map(({ name, slug, reason }) => ({ name, slug, reason })),
    edited: false,
    fallbackToConcepts,
  };
}

/** Checks the PUT body; the first problem names its field. Server rules are the source of truth (3-6, 2-60, unique slug). */
export function checkConceptsBody(body: unknown): { names: string[] } | ListProblem {
  const list = (body as { concepts?: unknown } | null | undefined)?.concepts;
  if (!Array.isArray(list)) return { field: "concepts", message: "concepts must be an array of { name }" };
  const names: string[] = [];
  for (const [i, item] of list.entries()) {
    const name = (item as { name?: unknown } | null)?.name;
    if (typeof name !== "string") return { field: `concepts[${i}].name`, message: "name must be a string" };
    // The control-character check must see the raw text, so only trim here.
    names.push(name.trim());
  }
  return validateConceptNames(names) ?? { names };
}

/**
 * Saves the learner's list (upsert on user + ladder). Last write wins: two tabs saving at once both succeed and the
 * later statement stays. A reason is carried over only when the name matches a shared concept's slug.
 */
export async function putConcepts(
  sql: SQL,
  ladderId: string,
  userId: string,
  names: string[],
): Promise<"ok" | "not-found" | "concepts-not-found"> {
  const ladder = await ladderRepo(sql, ladderId);
  if (!ladder) return "not-found";
  const shared = await sharedConcepts(sql, ladder.repo_full_name, ladder.commit_sha);
  if (shared.length === 0) return "concepts-not-found";
  const reasonBySlug = new Map(shared.map((c) => [c.slug, c.reason]));
  const items: ConceptItem[] = names.map((raw) => {
    const name = raw.replace(/\s+/g, " ");
    const slug = conceptSlug(name);
    const reason = reasonBySlug.get(slug);
    return reason ? { name, slug, reason: clean(reason) } : { name, slug };
  });
  await sql`
    INSERT INTO learner_concepts (user_id, ladder_id, concepts)
    VALUES (${userId}, ${ladderId}, ${items}::jsonb)
    ON CONFLICT (user_id, ladder_id) DO UPDATE SET concepts = EXCLUDED.concepts, updated_at = now()`;
  return "ok";
}
