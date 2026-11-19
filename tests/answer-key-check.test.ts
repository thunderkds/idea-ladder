// T008 (8c) AC 4: answer-key check, port of T001 keycheck (its test cases kept), plus inline-markdown stripping.
import { describe, expect, test } from "bun:test";
import { checkAnswerKey, stripInlineMarkdown } from "../src/server/answer-key-check.ts";

const opts = (...o: string[]) => o;

describe("answer-key-check: T001 cases", () => {
  test("passes when key is an option and appears in the chunk", () => {
    const r = checkAnswerKey({
      options: opts("emit", "fire", "send", "push"),
      key: "emit",
      chunk: "Call emit to dispatch an event.",
    });
    expect(r).toEqual({ pass: true, reason: "ok" });
  });
  test("passes after case, NFKC and whitespace normalisation", () => {
    expect(
      checkAnswerKey({ options: ["Event  Emitter", "b"], key: "Event  Emitter", chunk: "an EVENT\n emitter is small" })
        .pass,
    ).toBe(true);
    expect(checkAnswerKey({ options: ["ﬁle", "b"], key: "ﬁle", chunk: "open the file now" }).pass).toBe(true); // U+FB01 ligature
  });
  test("fails when the key is not in the options (key-not-in-options)", () => {
    expect(checkAnswerKey({ options: ["a", "b"], key: "c", chunk: "c" })).toEqual({
      pass: false,
      reason: "key-not-in-options",
    });
  });
  test("fails when the key is not in the chunk (key-not-in-chunk)", () => {
    expect(checkAnswerKey({ options: ["a", "b"], key: "b", chunk: "only a here" })).toEqual({
      pass: false,
      reason: "key-not-in-chunk",
    });
  });
  test("does not match inside a longer token: map vs bitmap", () => {
    expect(checkAnswerKey({ options: ["map", "set"], key: "map", chunk: "uses a bitmap" }).pass).toBe(false);
    expect(checkAnswerKey({ options: ["map", "set"], key: "map", chunk: "uses a map." }).pass).toBe(true);
    expect(checkAnswerKey({ options: ["map", "set"], key: "map", chunk: "mapping" }).pass).toBe(false);
    expect(checkAnswerKey({ options: ["bitmap", "set"], key: "bitmap", chunk: "uses a map" }).pass).toBe(false);
  });
  test("numeric keys do not match inside bigger numbers: 60 vs 60,000 / 3.5 / 160", () => {
    const o = ["60", "30"];
    expect(checkAnswerKey({ options: o, key: "60", chunk: "limit is 60,000" }).pass).toBe(false);
    expect(checkAnswerKey({ options: o, key: "60", chunk: "limit is 160" }).pass).toBe(false);
    expect(checkAnswerKey({ options: ["5", "6"], key: "5", chunk: "version 3.5" }).pass).toBe(false);
    expect(checkAnswerKey({ options: o, key: "60", chunk: "limit is 60 per hour." }).pass).toBe(true);
    expect(checkAnswerKey({ options: o, key: "60", chunk: "limit is 60, then stop" }).pass).toBe(true);
  });
  test("finds a later valid occurrence after an invalid one", () => {
    expect(checkAnswerKey({ options: ["map", "x"], key: "map", chunk: "bitmap then map" }).pass).toBe(true);
  });
  test("keys that start/end with punctuation are matched on their word edges only", () => {
    expect(checkAnswerKey({ options: ["on()", "x"], key: "on()", chunk: "call on() to listen" }).pass).toBe(true);
  });
  test("empty key never passes", () => {
    expect(checkAnswerKey({ options: ["", "x"], key: "", chunk: "anything" }).pass).toBe(false);
  });
});

describe("answer-key-check: inline markdown (Edge Case Checklist)", () => {
  test("a key wrapped in _x_, *x*, **x** or backticks in the chunk passes (T001 rejected these)", () => {
    expect(
      checkAnswerKey({ options: ["last", "first"], key: "last", chunk: "the _last_ key gets the value" }).pass,
    ).toBe(true);
    expect(checkAnswerKey({ options: ["last", "first"], key: "last", chunk: "the *last* key" }).pass).toBe(true);
    expect(checkAnswerKey({ options: ["last", "first"], key: "last", chunk: "the **last** key" }).pass).toBe(true);
    expect(checkAnswerKey({ options: ["emit", "on"], key: "emit", chunk: "call `emit` now" }).pass).toBe(true);
  });
  test("backticks between words no longer break a multi-word key (T001 dset-31)", () => {
    expect(
      checkAnswerKey({
        options: ["String or Array", "Number"],
        key: "String or Array",
        chunk: "path: `String` or `Array`",
      }).pass,
    ).toBe(true);
  });
  test("a key written in markdown matches the same marks in the chunk", () => {
    expect(checkAnswerKey({ options: ["`mitt()`", "x"], key: "`mitt()`", chunk: "call `mitt()` once" }).pass).toBe(
      true,
    );
    expect(checkAnswerKey({ options: ["__init__", "x"], key: "__init__", chunk: "def __init__(self)" }).pass).toBe(
      true,
    );
  });
  test("stripping keeps snake_case and arithmetic, and still respects token boundaries", () => {
    expect(stripInlineMarkdown("snake_case and 2*3")).toBe("snake_case and 2*3");
    expect(checkAnswerKey({ options: ["case", "x"], key: "case", chunk: "use snake_case here" }).pass).toBe(false);
    expect(checkAnswerKey({ options: ["map", "x"], key: "map", chunk: "a *bitmap* index" }).pass).toBe(false);
  });
});

describe("answer-key-check: documented T001 limits (left for T009's blind solver)", () => {
  test("a key in a negated sentence still passes", () => {
    expect(
      checkAnswerKey({ options: ["retry", "x"], key: "retry", chunk: "There is no retry in this class." }).pass,
    ).toBe(true);
  });
  test("a wrong key that is a distractor also present in the chunk still passes", () => {
    const chunk = "Use on to register a handler and off to remove it.";
    expect(checkAnswerKey({ options: ["on", "off", "emit", "clear"], key: "on", chunk }).pass).toBe(true); // true key: off
  });
});
