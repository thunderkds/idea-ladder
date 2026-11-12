// Runs the same steps as .github/workflows/ci.yml, locally. Keep both lists in sync.
// Needs a pgvector Postgres: `docker compose up -d db` (or DATABASE_URL pointing at one).
import { SQL } from "bun";

const adminUrl = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:54329/idea_ladder";
const ciDb = new URL(adminUrl);
ciDb.pathname = "/il_ci"; // throwaway database, so migrate down never touches dev data

async function resetCiDatabase(drop: boolean) {
  const admin = new SQL(adminUrl, { connectionTimeout: 5 });
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS "il_ci" WITH (FORCE)`);
    if (!drop) await admin.unsafe(`CREATE DATABASE "il_ci"`);
  } catch (err) {
    console.error(
      `ci:local: cannot reach Postgres at the DATABASE_URL host. Start it with: docker compose up -d db\n${err}`,
    );
    process.exit(1);
  } finally {
    await admin.close();
  }
}

const steps: [name: string, cmd: string[], env?: Record<string, string>][] = [
  ["install", ["bun", "install", "--frozen-lockfile"]],
  ["typecheck", ["bun", "run", "typecheck"]],
  ["lint", ["bun", "run", "lint"]],
  ["unit tests", ["bun", "test"]],
  ["migrate up", ["bun", "run", "db:migrate"], { DATABASE_URL: ciDb.toString() }],
  ["migrate down", ["bun", "run", "db:migrate:down"], { DATABASE_URL: ciDb.toString() }],
  ["migrate up again", ["bun", "run", "db:migrate"], { DATABASE_URL: ciDb.toString() }],
  ["e2e sign-in", ["bun", "run", "test:e2e", "--", "sign-in"]],
];

await resetCiDatabase(false);
let failed: string | undefined;
for (const [name, cmd, env] of steps) {
  console.log(`\n== ci:local: ${name}: ${cmd.join(" ")}`);
  const proc = Bun.spawn(cmd, {
    stdout: "inherit",
    stderr: "inherit",
    env: { ...process.env, DATABASE_URL: adminUrl, ...env },
  });
  if ((await proc.exited) !== 0) {
    failed = name;
    break;
  }
}
await resetCiDatabase(true);
console.log(failed ? `\nci:local FAILED at step: ${failed}` : "\nci:local: all steps passed");
process.exit(failed ? 1 : 0);
