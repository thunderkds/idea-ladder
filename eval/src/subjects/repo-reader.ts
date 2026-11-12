// T006 golden-set subject: the repo reader on model A (Anthropic API back end) with live GitHub reads at each
// fixture's pinned SHA. Paid: needs ANTHROPIC_API_KEY, MODEL_A_ID (priced in prices.json) and GITHUB_TOKEN.
import { createAnthropic } from "@ai-sdk/anthropic";
import { githubRepoClient } from "../../../src/server/github-repo.ts";
import { loadPrices, logStepCost } from "../cost.ts";
import { createRepoReaderSubject, readerLimitsFromEnv } from "../repo-reader-subject.ts";

const env = process.env;
const missing = ["ANTHROPIC_API_KEY", "MODEL_A_ID", "GITHUB_TOKEN"].filter((n) => !env[n]);
if (missing.length) throw new Error(`repo-reader needs ${missing.join(", ")} (paid run on model A)`);
const modelId = env.MODEL_A_ID as string;
// Refuse before the first paid call, not after it (logStepCost never logs usd: 0).
if (!Object.hasOwn(loadPrices(), modelId)) throw new Error(`MODEL_A_ID "${modelId}" has no price in eval/prices.json`);
const limits = readerLimitsFromEnv(env);

const runId = `eval-repo-reader-${new Date().toISOString().replace(/[-:.]/g, "")}`;
const github = githubRepoClient({ baseUrl: "https://api.github.com", token: env.GITHUB_TOKEN as string });
console.error(`repo-reader: cost log run id ${runId}`);

export default createRepoReaderSubject({
  // The API back end, explicit: never an ANTHROPIC_BASE_URL from the environment.
  model: createAnthropic({ apiKey: env.ANTHROPIC_API_KEY, baseURL: "https://api.anthropic.com/v1" })(modelId),
  limits,
  readFile: (fx) => (path) => github.readFile(fx.fullName, fx.sha, path),
  logCost: (fx, u) =>
    logStepCost({ runId, ladderKey: `${fx.fullName}@${fx.sha}`, step: "pick-core-files", ...u }).usd,
});
