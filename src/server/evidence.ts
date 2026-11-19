// T012: evidence records. One append-only record per learner + ladder + level passed, hashed with SHA-256 over its
// canonical JSON (ported from experiments/core-spike/src/proof.ts, T001: 17/17 tamper cases rejected).
// T013, T014 and T019 reuse this module. Never calls an LLM.
import { createHash } from "node:crypto";
import type { SQL } from "bun";
import type { PassedLevels } from "./ladder-view.ts";

export type EvidenceRecord = {
  learner: string;
  ladder: string;
  level: string;
  test: string;
  evidence: Record<string, unknown>;
  verifiedBy: string;
  verifiedAt: string;
  hash?: string;
  signature?: string;
};

/** Sorted keys, NFC strings (keys too), no insignificant whitespace. Throws on values JSON cannot carry. */
export function canonicalJson(v: unknown): string {
  if (v === null) return "null";
  switch (typeof v) {
    case "string":
      return JSON.stringify(v.normalize("NFC"));
    case "boolean":
      return v ? "true" : "false";
    case "number":
      if (!Number.isFinite(v)) throw new Error("canonicalJson: non-finite number");
      return JSON.stringify(v);
    case "object": {
      if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
      const o = v as Record<string, unknown>;
      const keys = Object.keys(o)
        .map((k) => k.normalize("NFC"))
        .sort();
      if (new Set(keys).size !== keys.length) throw new Error("canonicalJson: duplicate key after NFC");
      const byNfc = new Map(Object.keys(o).map((k) => [k.normalize("NFC"), o[k]]));
      return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(byNfc.get(k))}`).join(",")}}`;
    }
    default:
      throw new Error(`canonicalJson: unsupported type ${typeof v}`);
  }
}

/** `sha256:<hex>` over the canonical JSON of the record without `hash` and `signature`. */
export function hashRecord(rec: EvidenceRecord): string {
  const { hash: _h, signature: _s, ...body } = rec;
  return `sha256:${createHash("sha256").update(canonicalJson(body), "utf8").digest("hex")}`;
}

/**
 * Hashes and appends the record for learner + ladder + level, inside the caller's transaction. A level already
 * passed keeps its first record: nothing is written and that stored record is returned.
 */
export async function writeEvidenceRecord(
  tx: SQL,
  learnerId: string,
  ladderId: string,
  record: Omit<EvidenceRecord, "hash" | "signature">,
): Promise<{ record: EvidenceRecord; created: boolean }> {
  const hashed: EvidenceRecord = { ...record, hash: hashRecord(record) };
  const [inserted] = await tx`
    INSERT INTO evidence_records (learner_id, ladder_id, level, record)
    VALUES (${learnerId}, ${ladderId}, ${record.level}, ${hashed}::jsonb)
    ON CONFLICT (learner_id, ladder_id, level) DO NOTHING RETURNING id`;
  if (inserted) return { record: hashed, created: true };
  const [existing] = await tx`
    SELECT record FROM evidence_records
    WHERE learner_id = ${learnerId} AND ladder_id = ${ladderId} AND level = ${record.level}`;
  return { record: existing.record as EvidenceRecord, created: false };
}

/** The real `passedLevels` seam (T010): the levels with an evidence record for this learner + ladder. */
export function evidencePassedLevels(sql: SQL): PassedLevels {
  return async (ladderId, userId) => {
    if (!/^[1-9][0-9]{0,17}$/.test(ladderId)) return [];
    const rows = await sql`
      SELECT level FROM evidence_records WHERE ladder_id = ${ladderId} AND learner_id = ${userId} ORDER BY level`;
    return rows.map((r: { level: string }) => r.level);
  };
}
