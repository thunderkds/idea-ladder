import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { migrateUp } from "../src/server/migrate.ts";
import { createTestDatabase } from "./support/db.ts";

let db: Awaited<ReturnType<typeof createTestDatabase>>;
let learnerId: string;
let ladderId: string;
beforeAll(async () => {
  db = await createTestDatabase();
  await migrateUp(db.sql);
  [{ id: learnerId }] =
    await db.sql`INSERT INTO users (github_id, github_login) VALUES (1, 'a') RETURNING id::text AS id`;
  [{ id: ladderId }] = await db.sql`
    INSERT INTO ladders (repo_full_name, commit_sha, status) VALUES ('o/r', ${"a".repeat(40)}, 'unverified')
    RETURNING id::text AS id`;
});
afterAll(async () => {
  await db.drop();
});

const record = (level: string) => ({ level, hash: `sha256:${"0".repeat(64)}` });
const insert = (level: string) => db.sql`
  INSERT INTO evidence_records (learner_id, ladder_id, level, record)
  VALUES (${learnerId}, ${ladderId}, ${level}, ${record(level)}::jsonb) RETURNING id::text AS id`;

describe("T012 evidence_records table (migration 0011)", () => {
  test("SC 4: UPDATE and DELETE are rejected by the database; the row is unchanged", async () => {
    const [{ id }] = await insert("L3");
    await expect(
      (async () => await db.sql`UPDATE evidence_records SET level = 'L4' WHERE id = ${id}`)(),
    ).rejects.toThrow(/append-only/);
    await expect((async () => await db.sql`DELETE FROM evidence_records WHERE id = ${id}`)()).rejects.toThrow(
      /append-only/,
    );
    const [row] = await db.sql`SELECT level, record FROM evidence_records WHERE id = ${id}`;
    expect(row.level).toBe("L3");
    expect(row.record).toEqual(record("L3"));
  });

  test("one record per learner + ladder + level", async () => {
    await insert("L0");
    await expect((async () => await insert("L0"))()).rejects.toThrow(/unique|duplicate/i);
  });

  test("the record's level must match its level column, and its hash must be sha256:<hex>", async () => {
    await expect(
      (async () =>
        await db.sql`
        INSERT INTO evidence_records (learner_id, ladder_id, level, record)
        VALUES (${learnerId}, ${ladderId}, 'L1', ${record("L2")}::jsonb)`)(),
    ).rejects.toThrow(/check/i);
    await expect(
      (async () =>
        await db.sql`
        INSERT INTO evidence_records (learner_id, ladder_id, level, record)
        VALUES (${learnerId}, ${ladderId}, 'L1', ${{ level: "L1", hash: "md5:x" }}::jsonb)`)(),
    ).rejects.toThrow(/check/i);
  });
});
