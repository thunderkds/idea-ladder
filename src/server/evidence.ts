// T012: evidence records. One append-only record per learner + ladder + level passed, hashed with SHA-256 over its
// canonical JSON (ported from experiments/core-spike/src/proof.ts, T001: 17/17 tamper cases rejected).
// T013, T014 and T019 reuse this module. Never calls an LLM.
import { createHash } from "node:crypto";

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
