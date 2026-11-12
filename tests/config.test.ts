import { describe, expect, test } from "bun:test";
import { ConfigError, loadConfig } from "../src/server/config.ts";

const valid = {
  DATABASE_URL: "postgres://u:p@localhost:5432/db",
  GITHUB_CLIENT_ID: "cid",
  GITHUB_CLIENT_SECRET: "csecret",
  GITHUB_APP_TOKEN: "app-token",
  SESSION_SECRET: "s".repeat(32),
  ANTHROPIC_API_KEY: "sk-ant-test",
  MODEL_A_ID: "test-model",
};

const prod = {
  ...valid,
  NODE_ENV: "production",
  INNGEST_SIGNING_KEY: "signkey-prod-test",
  INNGEST_EVENT_KEY: "eventkey",
  INNGEST_SERVE_ORIGIN: "https://ladder.example",
};

describe("loadConfig", () => {
  test("valid env gives production GitHub defaults", () => {
    const config = loadConfig(valid);
    expect(config.githubOauthBaseUrl).toBe("https://github.com");
    expect(config.githubApiBaseUrl).toBe("https://api.github.com");
    expect(config.port).toBe(3000);
    expect(config.secureCookies).toBe(true);
  });

  test("missing variables are named in the error", () => {
    const { GITHUB_CLIENT_SECRET: _a, SESSION_SECRET: _b, ...partial } = valid;
    expect(() => loadConfig(partial)).toThrow(ConfigError);
    expect(() => loadConfig(partial)).toThrow(/GITHUB_CLIENT_SECRET.*SESSION_SECRET/);
  });

  test("GITHUB_APP_TOKEN is required (T005: repo reads use the app's own token)", () => {
    const { GITHUB_APP_TOKEN: _t, ...partial } = valid;
    expect(() => loadConfig(partial)).toThrow(/GITHUB_APP_TOKEN/);
    expect(loadConfig(valid).githubAppToken).toBe("app-token");
  });

  test("empty value counts as missing", () => {
    expect(() => loadConfig({ ...valid, DATABASE_URL: "" })).toThrow(/DATABASE_URL/);
  });

  test("short SESSION_SECRET is rejected", () => {
    expect(() => loadConfig({ ...valid, SESSION_SECRET: "short" })).toThrow(/SESSION_SECRET.*32/);
  });

  test("invalid base URL and port are rejected by name", () => {
    expect(() => loadConfig({ ...valid, GITHUB_API_BASE_URL: "not a url" })).toThrow(/GITHUB_API_BASE_URL/);
    expect(() => loadConfig({ ...valid, PORT: "abc" })).toThrow(/PORT/);
  });

  test("cookies are not Secure only in development and test", () => {
    expect(loadConfig({ ...valid, NODE_ENV: "development" }).secureCookies).toBe(false);
    expect(loadConfig({ ...valid, NODE_ENV: "test" }).secureCookies).toBe(false);
    expect(loadConfig({ ...prod }).secureCookies).toBe(true);
  });

  test("START_MAX_NEW_JOBS_PER_HOUR defaults to 20 and must be a positive integer", () => {
    expect(loadConfig(valid).startMaxNewJobsPerHour).toBe(20);
    expect(loadConfig({ ...valid, START_MAX_NEW_JOBS_PER_HOUR: "5" }).startMaxNewJobsPerHour).toBe(5);
    for (const bad of ["0", "-1", "2.5", "abc", "1e3x"]) {
      expect(() => loadConfig({ ...valid, START_MAX_NEW_JOBS_PER_HOUR: bad })).toThrow(/START_MAX_NEW_JOBS_PER_HOUR/);
    }
  });

  test("production refuses INNGEST_DEV and requires the Inngest keys and serve origin", () => {
    expect(() => loadConfig({ ...prod, INNGEST_DEV: "1" })).toThrow(/INNGEST_DEV/);
    for (const name of ["INNGEST_SIGNING_KEY", "INNGEST_EVENT_KEY", "INNGEST_SERVE_ORIGIN"] as const) {
      const { [name]: _drop, ...partial } = prod;
      expect(() => loadConfig(partial)).toThrow(new RegExp(name));
    }
    // dev and test: none of them needed, INNGEST_DEV allowed
    expect(() => loadConfig({ ...valid, NODE_ENV: "development", INNGEST_DEV: "1" })).not.toThrow();
    expect(() => loadConfig({ ...valid, NODE_ENV: "test" })).not.toThrow();
  });

  test("INNGEST_SERVE_ORIGIN is an origin, not taken from the request Host", () => {
    expect(loadConfig(prod).inngestServeOrigin).toBe("https://ladder.example");
    expect(loadConfig({ ...valid, NODE_ENV: "test" }).inngestServeOrigin).toBeUndefined();
    expect(() => loadConfig({ ...prod, INNGEST_SERVE_ORIGIN: "not a url" })).toThrow(/INNGEST_SERVE_ORIGIN/);
  });

  test("T006: model A and reader limits; defaults 15 steps / 80,000 tokens; bad limits are refused", () => {
    const c = loadConfig(valid);
    expect({ m: c.modelAId, k: c.anthropicApiKey, s: c.readerMaxSteps, b: c.readerTokenBudget }).toEqual({
      m: "test-model",
      k: "sk-ant-test",
      s: 15,
      b: 80_000,
    });
    expect(loadConfig({ ...valid, READER_MAX_STEPS: "8", READER_TOKEN_BUDGET: "20000" }).readerMaxSteps).toBe(8);
    const { ANTHROPIC_API_KEY: _k, MODEL_A_ID: _m, ...noModel } = valid;
    expect(() => loadConfig(noModel)).toThrow(/ANTHROPIC_API_KEY, MODEL_A_ID/);
    expect(() => loadConfig({ ...valid, READER_MAX_STEPS: "0" })).toThrow(
      /READER_MAX_STEPS must be a positive integer/,
    );
    expect(() => loadConfig({ ...valid, READER_TOKEN_BUDGET: "-5" })).toThrow(/READER_TOKEN_BUDGET/);
    // upper bounds: a typo must not lift the cap or the budget
    expect(loadConfig({ ...valid, READER_MAX_STEPS: "50", READER_TOKEN_BUDGET: "500000" }).readerMaxSteps).toBe(50);
    expect(() => loadConfig({ ...valid, READER_MAX_STEPS: "51" })).toThrow(/READER_MAX_STEPS must be .* at most 50/);
    expect(() => loadConfig({ ...valid, READER_TOKEN_BUDGET: "500001" })).toThrow(/at most 500000/);
  });
});
