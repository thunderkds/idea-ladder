// T008 golden-set subject (`--step ladder`): the level generators on model A. It needs GITHUB_TOKEN (core files and
// docs are read at the pinned SHA) and, for the default back end, the Claude login (`claude -p`). Model A as in the concept-mapper subject: MODEL_A_BACKEND unset or `claude-code` (usd null);
// `api` needs ANTHROPIC_API_KEY and a priced MODEL_A_ID. Fails before any model call when GITHUB_TOKEN is missing.
import { createAnthropic } from "@ai-sdk/anthropic";
import { githubRepoClient } from "../../../src/server/github-repo.ts";
import { createModelA } from "../../../src/server/model-a.ts";
import { loadPrices, logStepCost } from "../cost.ts";
import { loadGolden } from "../golden.ts";
import { createLevelGeneratorsSubject } from "../level-generators-subject.ts";

const env = process.env;
const missing = ["GITHUB_TOKEN"].filter((n) => !env[n]);
if (missing.length) throw new Error(`level-generators needs ${missing.join(", ")} ; no model call was made`);
const backend = env.MODEL_A_BACKEND || "claude-code";
if (backend !== "claude-code" && backend !== "api") throw new Error("MODEL_A_BACKEND must be claude-code or api");
const runId = `eval-level-generators-${new Date().toISOString().replace(/[-:.]/g, "")}`;
console.error(`level-generators: back end ${backend}, cost log run id ${runId}`);

function modelA() {
  if (backend === "claude-code") return createModelA({ backend: "claude-code", modelId: env.MODEL_A_ID || undefined });
  const need = ["ANTHROPIC_API_KEY", "MODEL_A_ID"].filter((n) => !env[n]);
  if (need.length) throw new Error(`level-generators (MODEL_A_BACKEND=api) needs ${need.join(", ")} (paid run)`);
  const modelId = env.MODEL_A_ID as string;
  if (!Object.hasOwn(loadPrices(), modelId)) throw new Error(`MODEL_A_ID "${modelId}" has no price in eval/prices.json`);
  return createModelA({
    backend: "api",
    model: createAnthropic({ apiKey: env.ANTHROPIC_API_KEY, baseURL: "https://api.anthropic.com/v1" })(modelId),
  });
}

const m = modelA();
const github = githubRepoClient({ baseUrl: "https://api.github.com", token: env.GITHUB_TOKEN as string });
const golden = new Map(loadGolden().map((e) => [e.fullName, e]));

export default createLevelGeneratorsSubject({
  generate: m.generate,
  readFile: (fx, path) => github.readFile(fx.fullName, fx.sha, path),
  coreFilesOf: (fullName) => golden.get(fullName)?.expectedCoreFiles ?? [],
  conceptsOf: (fullName) => golden.get(fullName)?.expectedConcepts ?? [],
  logCost: (fx, step, u) =>
    logStepCost({
      runId,
      ladderKey: `${fx.fullName}@${fx.sha}`,
      step,
      // Model A calls are unpriced on the subscription.
      ...(m.backend === "claude-code" ? { backend: "claude-code" as const } : {}),
      ...u,
    }).usd,
});
