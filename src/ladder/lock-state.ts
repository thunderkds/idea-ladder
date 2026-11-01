export const LEVEL_IDS = ['L0', 'L1', 'L2', 'L3', 'L4'] as const;
export type LevelId = (typeof LEVEL_IDS)[number];
export type LockState = 'open' | 'locked' | 'passed';

/**
 * The one unlock rule. Every passed level is `passed`; the first level not passed is `open`;
 * every later level is `locked`, so a pass recorded after a gap does not open the level after it.
 * Returns one state per level, in L0 to L4 order. T012's server-side unlock check calls this too.
 */
export function levelLockState(passedLevelIds: readonly string[]): LockState[] {
  const passed = new Set(passedLevelIds);
  let openTaken = false;
  return LEVEL_IDS.map((id) => {
    if (passed.has(id)) return 'passed';
    if (openTaken) return 'locked';
    openTaken = true;
    return 'open';
  });
}
