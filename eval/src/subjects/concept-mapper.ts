// T007 golden-set subject: the concept mapper on model A. Same env as repo-reader: MODEL_A_BACKEND unset or
// `claude-code` (subscription, usd null); `api` needs ANTHROPIC_API_KEY and a MODEL_A_ID priced in prices.json.
import { createAnthropic } from "@ai-sdk/anthropic";
import { createModelA } from "../../../src/server/model-a.ts";
import { MAP_CONCEPTS_STEP } from "../../../src/server/concept-mapper.ts";
import { createConceptMapperSubject } from "../concept-mapper-subject.ts";
import { loadPrices, logStepCost } from "../cost.ts";
import { loadGolden } from "../golden.ts";

const env = process.env;
const backend = env.MODEL_A_BACKEND || "claude-code";
if (backend !== "claude-code" && backend !== "api") throw new Error("MODEL_A_BACKEND must be claude-code or api");
const runId = `eval-concept-mapper-${new Date().toISOString().replace(/[-:.]/g, "")}`;
console.error(`concept-mapper: back end ${backend}, cost log run id ${runId}`);

function modelA() {
  if (backend === "claude-code") return createModelA({ backend: "claude-code", modelId: env.MODEL_A_ID || undefined });
  const missing = ["ANTHROPIC_API_KEY", "MODEL_A_ID"].filter((n) => !env[n]);
  if (missing.length) throw new Error(`concept-mapper (MODEL_A_BACKEND=api) needs ${missing.join(", ")} (paid run)`);
  const modelId = env.MODEL_A_ID as string;
  if (!Object.hasOwn(loadPrices(), modelId)) throw new Error(`MODEL_A_ID "${modelId}" has no price in eval/prices.json`);
  return createModelA({
    backend: "api",
    model: createAnthropic({ apiKey: env.ANTHROPIC_API_KEY, baseURL: "https://api.anthropic.com/v1" })(modelId),
  });
}

const m = modelA();
const golden = new Map(loadGolden().map((e) => [e.fullName, e.expectedCoreFiles]));

export default createConceptMapperSubject({
  generate: m.generate,
  backend: m.backend,
  coreFilesOf: (fullName) => golden.get(fullName) ?? [],
  logCost: (fx, u) =>
    logStepCost({
      runId,
      ladderKey: `${fx.fullName}@${fx.sha}`,
      step: MAP_CONCEPTS_STEP,
      ...(m.backend === "claude-code" ? { backend: "claude-code" as const } : {}),
      ...u,
    }).usd,
});
