import { createHash, sign, verify, type KeyObject } from "node:crypto";

export interface EvidenceRecord {
  learner: string;
  ladder: string;
  level: string;
  test: string;
  evidence: { branch: string; commit: string; diffQuestions: { asked: number; correct: number; pass: number } };
  verifiedBy: string;
  verifiedAt: string;
  hash?: string;
  signature?: string;
}
export type SignedRecord = EvidenceRecord & { hash: string; signature: string };

/** Sorted keys, NFC strings (keys too), no insignificant whitespace. Throws on values JSON cannot carry. */
export function canonicalJson(v: unknown): string {
  if (v === null) return "null";
  switch (typeof v) {
    case "string": return JSON.stringify(v.normalize("NFC"));
    case "boolean": return v ? "true" : "false";
    case "number":
      if (!Number.isFinite(v)) throw new Error("canonicalJson: non-finite number");
      return JSON.stringify(v);
    case "object": {
      if (Array.isArray(v)) return "[" + v.map(canonicalJson).join(",") + "]";
      const o = v as Record<string, unknown>;
      const keys = Object.keys(o).map((k) => k.normalize("NFC")).sort();
      if (new Set(keys).size !== keys.length) throw new Error("canonicalJson: duplicate key after NFC");
      const byNfc = new Map(Object.keys(o).map((k) => [k.normalize("NFC"), o[k]]));
      return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(byNfc.get(k))).join(",") + "}";
    }
    default: throw new Error(`canonicalJson: unsupported type ${typeof v}`);
  }
}

export function hashRecord(rec: EvidenceRecord): string {
  const { hash: _h, signature: _s, ...body } = rec;
  return "sha256:" + createHash("sha256").update(canonicalJson(body), "utf8").digest("hex");
}

/** Signature is Ed25519 over the UTF-8 bytes of the `sha256:<hex>` string, base64. */
export function signRecord(rec: EvidenceRecord, privateKey: KeyObject): SignedRecord {
  const { hash: _h, signature: _s, ...body } = rec;
  const hash = hashRecord(body as EvidenceRecord);
  const signature = sign(null, Buffer.from(hash, "utf8"), privateKey).toString("base64");
  return { ...(body as EvidenceRecord), hash, signature };
}

/** Never throws: any malformed input is "not verified". */
export function verifyRecord(rec: SignedRecord, publicKey: KeyObject): boolean {
  try {
    if (hashRecord(rec) !== rec.hash) return false;
    if (typeof rec.signature !== "string" || !/^[A-Za-z0-9+/]{86}==$/.test(rec.signature)) return false; // 64 bytes
    return verify(null, Buffer.from(rec.hash, "utf8"), publicKey, Buffer.from(rec.signature, "base64"));
  } catch {
    return false;
  }
}

/** One tampered copy per leaf field (value changed), plus add-field, remove-field, bad hash, bad signature. */
export function tamperCases(signed: SignedRecord): Array<{ name: string; record: SignedRecord }> {
  const out: Array<{ name: string; record: SignedRecord }> = [];
  const clone = () => JSON.parse(JSON.stringify(signed)) as any;
  const walk = (node: any, path: string[]) => {
    for (const k of Object.keys(node)) {
      if (k === "hash" || k === "signature") continue;
      const p = [...path, k];
      if (node[k] !== null && typeof node[k] === "object") { walk(node[k], p); continue; }
      const c = clone();
      let t = c;
      for (const seg of path) t = t[seg];
      t[k] = typeof node[k] === "number" ? node[k] + 1 : String(node[k]) + "x";
      out.push({ name: `change ${p.join(".")}`, record: c });
    }
  };
  walk(signed, []);
  const added = clone(); added.extra = "x"; out.push({ name: "add field", record: added });
  const removed = clone(); delete removed.verifiedBy; out.push({ name: "remove field", record: removed });
  out.push({ name: "bad hash", record: { ...signed, hash: "sha256:" + "0".repeat(64) } });
  const sig = Buffer.from(signed.signature, "base64"); sig[0] = sig[0]! ^ 1;
  out.push({ name: "flip signature bit", record: { ...signed, signature: sig.toString("base64") } });
  return out;
}
