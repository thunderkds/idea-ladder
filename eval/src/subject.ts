import type { Fixture } from "./schema.ts";

/**
 * A pipeline step candidate that the harness can score. It reads only the recorded fixture (offline) and
 * implements one or both steps. Later tasks (T006-T008) add their own subjects under `src/subjects/`.
 */
export interface Subject {
  name: string;
  /** Predicts the core files a reader must open. Paths relative to the repo root. */
  coreFiles?(fixture: Fixture): string[] | Promise<string[]>;
  /** Predicts the concepts a ladder should teach. */
  concepts?(fixture: Fixture): string[] | Promise<string[]>;
}
