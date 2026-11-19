import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { canonicalJson, type EvidenceRecord, hashRecord } from "../src/server/evidence.ts";

const RECORD: EvidenceRecord = {
  learner: "github:thunderkds",
  ladder: "repo:owner/name@3f2a9c1",
  level: "L3",
  test: "mcq",
  evidence: { asked: 10, correct: 8, pass: true, questionIds: ["4", "9", "12"] },
  verifiedBy: "verifier@0.0.0",
  verifiedAt: "2026-11-01T09:12:00.000Z",
};

describe("T012 canonicalJson", () => {
  test("sorts keys at every depth and drops insignificant whitespace", () => {
    expect(canonicalJson({ b: 1, a: { d: [true, null], c: "x" } })).toBe('{"a":{"c":"x","d":[true,null]},"b":1}');
  });

  test("is key-order independent", () => {
    const reordered = JSON.parse(
      '{"verifiedAt":"2026-11-01T09:12:00.000Z","evidence":{"questionIds":["4","9","12"],"pass":true,"correct":8,"asked":10},"verifiedBy":"verifier@0.0.0","test":"mcq","level":"L3","ladder":"repo:owner/name@3f2a9c1","learner":"github:thunderkds"}',
    );
    expect(canonicalJson(reordered)).toBe(canonicalJson(RECORD));
  });

  test("normalises strings and keys to NFC", () => {
    const nfd = "Nguy\u0302\u0303n"; // y + combining circumflex + tilde
    expect(canonicalJson({ [nfd]: nfd })).toBe(canonicalJson({ [nfd.normalize("NFC")]: nfd.normalize("NFC") }));
  });

  test("rejects values JSON cannot carry", () => {
    expect(() => canonicalJson(Number.NaN)).toThrow();
    expect(() => canonicalJson({ a: undefined })).toThrow();
    expect(() => canonicalJson({ "e\u0301": 1, "\u00e9": 2 })).toThrow(/duplicate key/);
  });
});

describe("T012 hashRecord", () => {
  test("is sha256: + hex of the canonical JSON without hash", () => {
    const expected = `sha256:${createHash("sha256").update(canonicalJson(RECORD), "utf8").digest("hex")}`;
    expect(hashRecord(RECORD)).toBe(expected);
    expect(hashRecord({ ...RECORD, hash: "sha256:whatever" })).toBe(expected);
    expect(hashRecord(RECORD)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test("SC 3: a record with keys in another order hashes the same; another level hashes differently", () => {
    const reordered = Object.fromEntries(Object.entries(RECORD).reverse()) as EvidenceRecord;
    expect(hashRecord(reordered)).toBe(hashRecord(RECORD));
    expect(hashRecord({ ...RECORD, level: "L4" })).not.toBe(hashRecord(RECORD));
  });

  test("a Unicode login in NFD hashes like its NFC form", () => {
    const nfd = { ...RECORD, learner: "github:jose\u0301" };
    const nfc = { ...RECORD, learner: "github:jos\u00e9" };
    expect(hashRecord(nfd)).toBe(hashRecord(nfc));
  });
});
