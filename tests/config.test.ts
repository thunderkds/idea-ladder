import { describe, expect, test } from "bun:test";
import { ConfigError, loadConfig } from "../src/server/config.ts";

const valid = {
  DATABASE_URL: "postgres://u:p@localhost:5432/db",
  GITHUB_CLIENT_ID: "cid",
  GITHUB_CLIENT_SECRET: "csecret",
  GITHUB_APP_TOKEN: "app-token",
  SESSION_SECRET: "s".repeat(32),
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
    expect(loadConfig({ ...valid, NODE_ENV: "production" }).secureCookies).toBe(true);
  });
});
