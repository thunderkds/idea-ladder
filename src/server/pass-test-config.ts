// T012: MCQ pass-test constants. Supervisor choices (the source sets no MCQ numbers); fixed, not per level.

/** Questions asked per attempt: min(MCQ_TEST_SIZE, pool size). */
export const MCQ_TEST_SIZE = 10;
/** Pass iff correct / asked >= 4 / 5 (8 of 10, 8 of 9, 7 of 8). A fraction, so scoring stays integer arithmetic. */
export const MCQ_PASS_RATIO = { numerator: 4, denominator: 5 } as const;
/** Started attempts per learner per ladder level in a rolling 24 h. */
export const MCQ_ATTEMPTS_PER_DAY = 3;
/** An attempt submitted later than this after its start is rejected. */
export const MCQ_ATTEMPT_TTL_MS = 30 * 60_000;
