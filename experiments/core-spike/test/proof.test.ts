import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalJson, hashRecord, signRecord, tamperCases, verifyRecord, type EvidenceRecord } from "../src/proof.js";

// Evidence record example, docs/REQUIREMENT_SOURCE.md § Diagram text.
const example: EvidenceRecord = {
  learner: "github:thunderkds",
  ladder: "repo:owner/name@3f2a9c1",
  level: "L2",
  test: "artifact+diff-questions",
  evidence: {
    branch: "https://github.com/thunderkds/name/tree/add-retry",
    commit: "9b1e2d4",
    diffQuestions: { asked: 5, correct: 4, pass: 4 },
  },
  verifiedBy: "verifier@1.3.0",
  verifiedAt: "2026-11-01T09:12:00Z",
};

const keys = () => generateKeyPairSync("ed25519");

describe("canonicalJson / hashRecord", () => {
  it("is key-order independent, with no whitespace", () => {
    expect(canonicalJson({ b: 1, a: { d: [2, 1], c: "x" } })).toBe('{"a":{"c":"x","d":[2,1]},"b":1}');
  });
  it("shuffled keys give the same hash (record example)", () => {
    const shuffled = {
      verifiedAt: example.verifiedAt,
      evidence: { diffQuestions: { pass: 4, correct: 4 + 0, asked: 5 }, commit: "9b1e2d4", branch: example.evidence.branch },
      test: example.test, level: "L2", verifiedBy: example.verifiedBy, ladder: example.ladder, learner: example.learner,
    } as EvidenceRecord;
    expect(hashRecord(shuffled)).toBe(hashRecord(example));
    expect(hashRecord(example)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
  it("NFC and NFD strings hash the same", () => {
    expect(hashRecord({ ...example, learner: "github:café" })).toBe(hashRecord({ ...example, learner: "github:café" }));
  });
  it("hash and signature fields are excluded from the hash input", () => {
    const h = hashRecord(example);
    expect(hashRecord({ ...example, hash: "sha256:junk", signature: "junk" })).toBe(h);
  });
  it("one changed field changes the hash", () => {
    expect(hashRecord({ ...example, level: "L3" })).not.toBe(hashRecord(example));
  });
  it("rejects values JSON cannot carry (undefined, NaN)", () => {
    expect(() => canonicalJson({ a: undefined })).toThrow();
    expect(() => canonicalJson({ a: NaN })).toThrow();
  });
});

describe("signRecord / verifyRecord", () => {
  it("untouched signed record verifies", () => {
    const { privateKey, publicKey } = keys();
    expect(verifyRecord(signRecord(example, privateKey), publicKey)).toBe(true);
  });
  it("level L2 -> L3 fails verify", () => {
    const { privateKey, publicKey } = keys();
    const signed = signRecord(example, privateKey);
    expect(verifyRecord({ ...signed, level: "L3" }, publicKey)).toBe(false);
  });
  it("wrong hash, wrong signature, other public key all fail", () => {
    const a = keys();
    const b = keys();
    const signed = signRecord(example, a.privateKey);
    expect(verifyRecord({ ...signed, hash: "sha256:" + "0".repeat(64) }, a.publicKey)).toBe(false);
    expect(verifyRecord({ ...signed, signature: Buffer.alloc(64).toString("base64") }, a.publicKey)).toBe(false);
    expect(verifyRecord({ ...signed, signature: "not base64 !!" }, a.publicKey)).toBe(false);
    expect(verifyRecord(signed, b.publicKey)).toBe(false);
  });
  it("tamper a field AND recompute the hash still fails (signature covers the old hash)", () => {
    const { privateKey, publicKey } = keys();
    const signed = signRecord(example, privateKey);
    const forged = { ...signed, level: "L4" };
    forged.hash = hashRecord(forged);
    expect(verifyRecord(forged, publicKey)).toBe(false);
  });
  it("every generated tamper case fails; there is one per leaf field plus add/remove", () => {
    const { privateKey, publicKey } = keys();
    const signed = signRecord(example, privateKey);
    const cases = tamperCases(signed);
    expect(cases.length).toBeGreaterThanOrEqual(12);
    for (const c of cases) expect(verifyRecord(c.record, publicKey), c.name).toBe(false);
  });
  it("signed record never exposes the private key", () => {
    const { privateKey } = keys();
    expect(JSON.stringify(signRecord(example, privateKey))).not.toContain("PRIVATE");
  });
});
