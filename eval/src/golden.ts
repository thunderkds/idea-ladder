import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FixtureSchema, GoldenSetSchema, type Fixture, type GoldenEntry } from "./schema.ts";

export const GOLDEN_DIR = join(import.meta.dir, "..", "golden");

export const fixtureFile = (fullName: string, dir = join(GOLDEN_DIR, "fixtures")) =>
  join(dir, `${fullName.replace("/", "__")}.json`);

export function loadGolden(path = join(GOLDEN_DIR, "repos.json")): GoldenEntry[] {
  return GoldenSetSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

/** Offline replay: reads the recorded fixture, never the network. */
export function loadFixture(fullName: string, dir?: string): Fixture {
  return FixtureSchema.parse(JSON.parse(readFileSync(fixtureFile(fullName, dir), "utf8")));
}

/** trending >= 5,000 stars; medium 500-4,999; lowkey < 500 (stars as recorded in the fixture). */
export function tierForStars(stars: number): GoldenEntry["tier"] {
  return stars >= 5000 ? "trending" : stars >= 500 ? "medium" : "lowkey";
}

/**
 * Cross-checks labels against recorded fixtures. Returns one message per problem (empty = ok).
 * Paths are case-sensitive and must be files (blobs), not directories.
 */
export function checkGolden(entries: GoldenEntry[], getFixture: (fullName: string) => Fixture): string[] {
  const errors: string[] = [];
  for (const e of entries) {
    const fx = getFixture(e.fullName);
    if (fx.fullName !== e.fullName) errors.push(`${e.fullName}: fixture is for ${fx.fullName}`);
    if (fx.sha !== e.sha) errors.push(`${e.fullName}: sha ${e.sha} differs from fixture sha ${fx.sha}`);
    const blobs = new Set(fx.tree.filter((t) => t.type === "blob").map((t) => t.path));
    for (const p of e.expectedCoreFiles) {
      if (!blobs.has(p)) errors.push(`${e.fullName}: expectedCoreFiles path not in tree at ${e.sha.slice(0, 7)}: ${p}`);
    }
  }
  return errors;
}
