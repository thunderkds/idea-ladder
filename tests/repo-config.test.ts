// Guards for repo config that has no runtime: the CI workflow (AC 7) and env/secret hygiene (AC 8).
import { describe, expect, test } from "bun:test";

const root = `${import.meta.dir}/..`;

describe("CI workflow (.github/workflows/ci.yml, AC 7)", async () => {
  type Step = { uses?: string; run?: string; name?: string };
  const ci = Bun.YAML.parse(await Bun.file(`${root}/.github/workflows/ci.yml`).text()) as {
    permissions?: unknown;
    jobs: { ci: { services?: Record<string, { image?: string }>; steps: Step[]; env?: Record<string, string> } };
  };
  const job = ci.jobs.ci;
  const runs = job.steps.flatMap((s) => (s.run ? [s.run.trim()] : []));

  test("runs the required steps in order", () => {
    const expected = [
      "bun install --frozen-lockfile",
      "bun run typecheck",
      "bun run lint",
      "bun test",
      "bun run db:migrate && bun run db:migrate:down && bun run db:migrate",
      "bun run test:e2e -- sign-in",
      "bun run test:e2e -- start-flow",
    ];
    const positions = expected.map((cmd) => runs.indexOf(cmd));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  test("migrations run against a pgvector Postgres service with the down opt-in", () => {
    expect(Object.values(job.services ?? {}).some((s) => /^pgvector\/pgvector:\S+$/.test(s.image ?? ""))).toBe(true);
    expect(job.env?.MIGRATE_ALLOW_DOWN).toBe("1");
  });

  test("permissions are read-only", () => {
    expect(ci.permissions).toEqual({ contents: "read" });
  });

  test("every action is pinned to a full commit SHA", () => {
    const uses = job.steps.flatMap((s) => (s.uses ? [s.uses] : []));
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) expect(u).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
  });
});

describe("env files and secrets (AC 8)", () => {
  test(".env.example lists exactly the variable names (T003's four, T005's three), all empty", async () => {
    const assignments = (await Bun.file(`${root}/.env.example`).text())
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));
    expect(assignments).toEqual([
      "DATABASE_URL=",
      "GITHUB_CLIENT_ID=",
      "GITHUB_CLIENT_SECRET=",
      "GITHUB_APP_TOKEN=",
      "INNGEST_EVENT_KEY=",
      "INNGEST_SIGNING_KEY=",
      "SESSION_SECRET=",
    ]);
  });

  test("git ignores .env and .env.local but not .env.example", () => {
    const ignored = (path: string) => Bun.spawnSync(["git", "check-ignore", "-q", path], { cwd: root }).exitCode === 0;
    expect(ignored(".env")).toBe(true);
    expect(ignored(".env.local")).toBe(true);
    expect(ignored(".env.example")).toBe(false);
  });
});
