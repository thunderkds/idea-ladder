// T006 golden-set subject: the repo reader on model A with live GitHub reads at each fixture's pinned SHA.
// MODEL_A_BACKEND unset or `claude-code` (default): `claude -p` on the owner's subscription; no ANTHROPIC_API_KEY,
// no price (usd: null), MODEL_A_ID optional, GITHUB_TOKEN optional (unauthenticated: 60 GitHub requests per hour).
// MODEL_A_BACKEND=api: paid, needs ANTHROPIC_API_KEY, MODEL_A_ID (priced in prices.json) and GITHUB_TOKEN.
import { createAnthropic } from "@ai-sdk/anthropic";
import { githubRepoClient } from "../../../src/server/github-repo.ts";
import { loadPrices, logStepCost } from "../cost.ts";
import { createRepoReaderSubject, readerLimitsFromEnv } from "../repo-reader-subject.ts";

const env = process.env;
const backend = env.MODEL_A_BACKEND || "claude-code";
if (backend !== "claude-code" && backend !== "api") throw new Error("MODEL_A_BACKEND must be claude-code or api");
const limits = readerLimitsFromEnv(env);
const runId = `eval-repo-reader-${new Date().toISOString().replace(/[-:.]/g, "")}`;
console.error(`repo-reader: back end ${backend}, cost log run id ${runId}`);

function apiSubject() {
  const missing = ["ANTHROPIC_API_KEY", "MODEL_A_ID", "GITHUB_TOKEN"].filter((n) => !env[n]);
  if (missing.length) throw new Error(`repo-reader (MODEL_A_BACKEND=api) needs ${missing.join(", ")} (paid run)`);
  const modelId = env.MODEL_A_ID as string;
  // Refuse before the first paid call, not after it (logStepCost never logs usd: 0).
  if (!Object.hasOwn(loadPrices(), modelId)) throw new Error(`MODEL_A_ID "${modelId}" has no price in eval/prices.json`);
  const github = githubRepoClient({ baseUrl: "https://api.github.com", token: env.GITHUB_TOKEN as string });
  return createRepoReaderSubject({
    // The API back end, explicit: never an ANTHROPIC_BASE_URL from the environment.
    model: createAnthropic({ apiKey: env.ANTHROPIC_API_KEY, baseURL: "https://api.anthropic.com/v1" })(modelId),
    limits,
    readFile: (fx) => (path) => github.readFile(fx.fullName, fx.sha, path),
    logCost: (fx, u) =>
      logStepCost({ runId, ladderKey: `${fx.fullName}@${fx.sha}`, step: "pick-core-files", ...u }).usd,
  });
}

function claudeCodeSubject() {
  if (!env.GITHUB_TOKEN)
    console.error(
      "repo-reader: no GITHUB_TOKEN, unauthenticated GitHub reads (60 requests per hour); a rate-limited read shows the model a github-rate-limited tool error",
    );
  return createRepoReaderSubject({
    claudeCode: { modelId: env.MODEL_A_ID || undefined, githubToken: env.GITHUB_TOKEN || undefined },
    limits,
    logCost: (fx, u) =>
      logStepCost({
        runId,
        ladderKey: `${fx.fullName}@${fx.sha}`,
        step: "pick-core-files",
        backend: "claude-code",
        ...u,
      }).usd,
  });
}

export default backend === "api" ? apiSubject() : claudeCodeSubject();
