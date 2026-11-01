import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

describe('design tokens', () => {
  it('has no hex color literal outside public/tokens.css', () => {
    const candidates = [...files('src'), 'public/app.css'];
    const offenders = candidates.filter((f) => /#[0-9a-fA-F]{3,8}\b/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
  it('defines color, font, type and spacing tokens', () => {
    const css = readFileSync('public/tokens.css', 'utf8');
    for (const t of ['--color-text', '--color-bg', '--color-accent', '--font-family-base', '--font-size-h1', '--space-3']) {
      expect(css).toContain(t);
    }
  });
});
