/** Minimal --key value parser. A bare `--` (added by `pnpm run x -- args`) is ignored. */
export function parseArgs(argv: string[]): { flags: Record<string, string | true>; rest: string[] } {
  const flags: Record<string, string | true> = {};
  const rest: string[] = [];
  const a = argv.filter((x) => x !== "--");
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    if (x.startsWith("--")) {
      const next = a[i + 1];
      if (next !== undefined && !next.startsWith("--")) { flags[x.slice(2)] = next; i++; } else flags[x.slice(2)] = true;
    } else rest.push(x);
  }
  return { flags, rest };
}
