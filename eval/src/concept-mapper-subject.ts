// T007: the concept mapper as an eval subject. The factory takes model A's `generate`, so tests run it offline.
// `src/subjects/concept-mapper.ts` wires the real model A. Core files come from the golden entry's
// `expectedCoreFiles` (not from concept labels), so the expected concepts never reach the prompt.
import { mapConcepts } from "../../src/server/concept-mapper.ts";
import type { Generate } from "../../src/server/model-a.ts";
import type { CallUsage } from "../../src/server/repo-reader.ts";
import { confidenceScore } from "./confidence.ts";
import type { Fixture } from "./schema.ts";
import type { MeasuredSubject, RunStats } from "./subject.ts";

export type ConceptMapperDeps = {
  generate: Generate;
  backend: "api" | "claude-code";
  /** Logs one model call for one repo; returns its USD cost (null on the subscription). */
  logCost: (fx: Fixture, usage: CallUsage) => number | null;
  /** Golden core files of a repo (paths). */
  coreFilesOf: (fullName: string) => string[];
};

export function createConceptMapperSubject(deps: ConceptMapperDeps): MeasuredSubject {
  const stats = new Map<string, RunStats>();
  return {
    name: "concept-mapper",
    async concepts(fx) {
      // usd stays null until the first priced call, and always on claude-code: never a fake 0.
      const s: RunStats = { modelCalls: 0, usd: null, hitLimit: false, tokens: 0 };
      stats.set(fx.fullName, s);
      const { concepts } = await mapConcepts({
        snapshot: { repo: fx.fullName, readme: fx.readme, topics: fx.topics, languages: fx.languages, depFiles: fx.depFiles },
        coreFiles: deps.coreFilesOf(fx.fullName).map((path) => ({ path, reason: "golden core file" })),
        confidence: confidenceScore(fx),
        generate: deps.generate,
        onUsage: (u) => {
          s.modelCalls++;
          s.tokens = (s.tokens ?? 0) + u.inputTokens + u.cachedInputTokens + u.outputTokens;
          const usd = deps.logCost(fx, u);
          if (deps.backend !== "claude-code" && usd !== null) s.usd = (s.usd ?? 0) + usd;
        },
      });
      return concepts.map((c) => c.name);
    },
    runStats: (fullName) => stats.get(fullName),
    verdicts: () => [],
  };
}
