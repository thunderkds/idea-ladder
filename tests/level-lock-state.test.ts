import { describe, expect, test } from "bun:test";
import { LEVEL_IDS, levelLockState } from "../src/shared/levels.ts";

describe("levelLockState (T010 AC 2)", () => {
  test("the five levels are L0..L4 in order", () => {
    expect([...LEVEL_IDS]).toEqual(["L0", "L1", "L2", "L3", "L4"]);
  });

  test("no passes: L0 open, L1-L4 locked", () => {
    expect(levelLockState([])).toEqual(["open", "locked", "locked", "locked", "locked"]);
  });

  test("a pass opens the next level", () => {
    expect(levelLockState(["L0"])).toEqual(["passed", "open", "locked", "locked", "locked"]);
    expect(levelLockState(["L0", "L1", "L2"])).toEqual(["passed", "passed", "passed", "open", "locked"]);
  });

  test("all five passed: all passed", () => {
    expect(levelLockState(["L0", "L1", "L2", "L3", "L4"])).toEqual(["passed", "passed", "passed", "passed", "passed"]);
  });

  test("out-of-order passes follow the first gap: L0 + L2 -> L1 open, L2 passed, L3 stays locked", () => {
    expect(levelLockState(["L0", "L2"])).toEqual(["passed", "open", "passed", "locked", "locked"]);
    expect(levelLockState(["L2"])).toEqual(["open", "locked", "passed", "locked", "locked"]);
  });

  test("unknown ids and duplicates are ignored; input order does not matter", () => {
    expect(levelLockState(["L9", "x", "L1", "L0", "L0"])).toEqual(["passed", "passed", "open", "locked", "locked"]);
  });
});
