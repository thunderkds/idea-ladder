import { describe, expect, test } from "bun:test";
import { conceptSlug, nameLength, nameProblem, validateConceptNames } from "../src/shared/concepts.ts";

describe("conceptSlug", () => {
  test("lower-case, dash-joined", () => {
    expect(conceptSlug("Event Emitter")).toBe("event-emitter");
    expect(conceptSlug("Rust async/await")).toBe("rust-async-await");
    expect(conceptSlug("  Pub/Sub!! ")).toBe("pub-sub");
  });
  test("names with no ASCII slug chars get a stable, non-empty hash slug", () => {
    const a = conceptSlug("日本語");
    expect(a).toMatch(/^c-[0-9a-f]{8}$/);
    expect(conceptSlug("日本語")).toBe(a);
    expect(conceptSlug("한국어")).not.toBe(a);
    expect(conceptSlug("🎉🎉")).toMatch(/^c-[0-9a-f]{8}$/);
  });
  test("accents fold to ASCII", () => {
    expect(conceptSlug("Café Müller")).toBe("cafe-muller");
  });
});

describe("nameLength / nameProblem", () => {
  test("counts code points, not UTF-16 units", () => {
    expect(nameLength("🎉")).toBe(1);
    expect(nameLength("a🎉b")).toBe(3);
  });
  test("60 emoji pass, 1 emoji fails", () => {
    expect(nameProblem("🎉".repeat(60))).toBeNull();
    expect(nameProblem("🎉".repeat(61))).not.toBeNull();
    expect(nameProblem("🎉")).not.toBeNull();
    expect(nameProblem("🎉🎉")).toBeNull();
  });
  test("2 to 60 code points", () => {
    expect(nameProblem("ab")).toBeNull();
    expect(nameProblem("a")).not.toBeNull();
    expect(nameProblem("")).not.toBeNull();
    expect(nameProblem("   ")).not.toBeNull();
    expect(nameProblem("a".repeat(60))).toBeNull();
    expect(nameProblem("a".repeat(61))).not.toBeNull();
  });
  test("rejects NUL, other C0 controls and DEL", () => {
    expect(nameProblem("ab\u0000c")).not.toBeNull();
    expect(nameProblem("ab\u001fc")).not.toBeNull();
    expect(nameProblem("ab\nc")).not.toBeNull();
    expect(nameProblem("ab\u007fc")).not.toBeNull();
    expect(nameProblem("ab c")).toBeNull();
  });
});

describe("validateConceptNames", () => {
  test("3 to 6 valid unique names pass", () => {
    expect(validateConceptNames(["Event emitter", "Pub/sub", "TypeScript generics"])).toBeNull();
  });
  test("2 or 7 names fail on the list", () => {
    expect(validateConceptNames(["aa", "bb"])?.field).toBe("concepts");
    expect(validateConceptNames(Array.from({ length: 7 }, (_, i) => `name ${i}`))?.field).toBe("concepts");
  });
  test("a bad name names its field", () => {
    expect(validateConceptNames(["aa", "b", "cc"])?.field).toBe("concepts[1].name");
    expect(validateConceptNames(["aa", "bb", "c".repeat(61)])?.field).toBe("concepts[2].name");
  });
  test("duplicate slug or case-folded duplicate names the later item", () => {
    expect(validateConceptNames(["Pub/Sub", "aa", "pub sub"])?.field).toBe("concepts[2].slug");
    expect(validateConceptNames(["Embeddings", "aa", "embeddings"])?.field).toBe("concepts[2].slug");
    expect(validateConceptNames(["Äöü", "bb", "äöü", "cc"])?.field).toBe("concepts[2].slug");
  });
});
