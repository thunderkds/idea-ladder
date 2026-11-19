// L0-L4 fixed facts shared by the server (ladder loader, T012's unlock check) and the client (ladder view).
// Titles and pass tests come from docs/REQUIREMENT_SOURCE.md § Repo to ladder engine.

export const LEVEL_IDS = ["L0", "L1", "L2", "L3", "L4"] as const;
export type LevelId = (typeof LEVEL_IDS)[number];
export type LevelLock = "open" | "locked" | "passed";

export type PassTest = { kind: string; description: string };

/** Shown for a level whose row T008 has not written yet. */
export const FIXED_LEVELS: Record<LevelId, { title: string; passTest: PassTest }> = {
  L0: { title: "Prerequisites", passTest: { kind: "concept-ladder-tests", description: "Concept ladder tests" } },
  L1: {
    title: "Run it",
    passTest: {
      kind: "run-mcq",
      description: "MCQs on setting up and running it; a run log and a 3-sentence explanation are optional feedback",
    },
  },
  L2: {
    title: "Modify",
    passTest: { kind: "diff-questions", description: "Branch or diff link + questions generated from your diff" },
  },
  L3: { title: "Understand", passTest: { kind: "core-mcq", description: "Verified MCQs on core files" } },
  L4: { title: "Rebuild or contribute", passTest: { kind: "repo-or-pr-link", description: "Repo link or PR link" } },
};

/**
 * The one unlock rule: every passed level is `passed`, the first level not passed is `open`, all later levels are
 * `locked`. A pass recorded after a gap (L2 without L1) stays `passed` but does not open L3: locks follow the first gap.
 */
export function levelLockState(passedLevelIds: readonly string[]): LevelLock[] {
  const passed = new Set(passedLevelIds);
  const firstGap = LEVEL_IDS.findIndex((id) => !passed.has(id));
  return LEVEL_IDS.map((id, i) => (passed.has(id) ? "passed" : i === firstGap ? "open" : "locked"));
}
