import { describe, expect, it } from 'vitest';
import { levelLockState } from '../src/ladder/lock-state.js';

describe('levelLockState', () => {
  it('no passes: L0 open, L1 to L4 locked', () => {
    expect(levelLockState([])).toEqual(['open', 'locked', 'locked', 'locked', 'locked']);
  });

  it('opens the first level not passed', () => {
    expect(levelLockState(['L0'])).toEqual(['passed', 'open', 'locked', 'locked', 'locked']);
    expect(levelLockState(['L0', 'L1', 'L2'])).toEqual(['passed', 'passed', 'passed', 'open', 'locked']);
  });

  it('all five passed: all passed', () => {
    expect(levelLockState(['L0', 'L1', 'L2', 'L3', 'L4'])).toEqual(['passed', 'passed', 'passed', 'passed', 'passed']);
  });

  it('a pass after a gap does not open the level after it (locks follow the first gap)', () => {
    expect(levelLockState(['L0', 'L2'])).toEqual(['passed', 'open', 'passed', 'locked', 'locked']);
    expect(levelLockState(['L2'])).toEqual(['open', 'locked', 'passed', 'locked', 'locked']);
  });

  it('ignores unknown ids and duplicates, and does not depend on order', () => {
    expect(levelLockState(['L1', 'L0', 'L0', 'L9', ''])).toEqual(['passed', 'passed', 'open', 'locked', 'locked']);
  });
});
