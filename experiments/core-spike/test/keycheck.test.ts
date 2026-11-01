import { describe, expect, it } from "vitest";
import { checkAnswerKey } from "../src/keycheck.js";

const opts = (...o: string[]) => o;

describe("checkAnswerKey", () => {
  it("passes when key is an option and appears in the chunk", () => {
    const r = checkAnswerKey({ options: opts("emit", "fire", "send", "push"), key: "emit", chunk: "Call emit to dispatch an event." });
    expect(r).toEqual({ pass: true, reason: "ok" });
  });
  it("passes after case, NFKC and whitespace normalisation", () => {
    expect(checkAnswerKey({ options: ["Event  Emitter", "b"], key: "Event  Emitter", chunk: "an EVENT\n emitter is small" }).pass).toBe(true);
    expect(checkAnswerKey({ options: ["ﬁle", "b"], key: "ﬁle", chunk: "open the file now" }).pass).toBe(true); // U+FB01 ligature -> fi
  });
  it("fails when the key is not in the options (key-not-in-options)", () => {
    expect(checkAnswerKey({ options: ["a", "b"], key: "c", chunk: "c" })).toEqual({ pass: false, reason: "key-not-in-options" });
  });
  it("fails when the key is not in the chunk (key-not-in-chunk)", () => {
    expect(checkAnswerKey({ options: ["a", "b"], key: "b", chunk: "only a here" })).toEqual({ pass: false, reason: "key-not-in-chunk" });
  });
  it("does not match inside a longer token: map vs bitmap", () => {
    expect(checkAnswerKey({ options: ["map", "set"], key: "map", chunk: "uses a bitmap" }).pass).toBe(false);
    expect(checkAnswerKey({ options: ["map", "set"], key: "map", chunk: "uses a map." }).pass).toBe(true);
    expect(checkAnswerKey({ options: ["map", "set"], key: "map", chunk: "mapping" }).pass).toBe(false);
  });
  it("numeric keys do not match inside bigger numbers: 60 vs 60,000 / 3.5 / 160", () => {
    const o = ["60", "30"];
    expect(checkAnswerKey({ options: o, key: "60", chunk: "limit is 60,000" }).pass).toBe(false);
    expect(checkAnswerKey({ options: o, key: "60", chunk: "limit is 160" }).pass).toBe(false);
    expect(checkAnswerKey({ options: ["5", "6"], key: "5", chunk: "version 3.5" }).pass).toBe(false);
    expect(checkAnswerKey({ options: o, key: "60", chunk: "limit is 60 per hour." }).pass).toBe(true);
    expect(checkAnswerKey({ options: o, key: "60", chunk: "limit is 60, then stop" }).pass).toBe(true); // comma not followed by digit
  });
  it("finds a later valid occurrence after an invalid one", () => {
    expect(checkAnswerKey({ options: ["map", "x"], key: "map", chunk: "bitmap then map" }).pass).toBe(true);
  });
  it("keys that start/end with punctuation are matched on their word edges only", () => {
    expect(checkAnswerKey({ options: ["on()", "x"], key: "on()", chunk: "call on() to listen" }).pass).toBe(true);
  });
  it("documented limit: a negated sentence still passes (not solved)", () => {
    expect(checkAnswerKey({ options: ["retry", "x"], key: "retry", chunk: "There is no retry in this class." }).pass).toBe(true);
  });
  it("empty key never passes", () => {
    expect(checkAnswerKey({ options: ["", "x"], key: "", chunk: "anything" }).pass).toBe(false);
  });
});
