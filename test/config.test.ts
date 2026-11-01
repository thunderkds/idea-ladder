import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config.js';

const full = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  GITHUB_CLIENT_ID: 'cid',
  GITHUB_CLIENT_SECRET: 'csecret',
  SESSION_SECRET: 'x'.repeat(40),
};

describe('loadConfig', () => {
  it('names every missing variable', () => {
    try {
      loadConfig({ GITHUB_CLIENT_ID: 'cid' });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      expect((e as ConfigError).problems.join(' ')).toContain('DATABASE_URL');
      expect((e as ConfigError).problems.join(' ')).toContain('GITHUB_CLIENT_SECRET');
      expect((e as ConfigError).problems.join(' ')).toContain('SESSION_SECRET');
    }
  });

  it('rejects a short SESSION_SECRET and names it', () => {
    expect(() => loadConfig({ ...full, SESSION_SECRET: 'short' })).toThrow(/SESSION_SECRET/);
  });

  it('defaults to production GitHub URLs and local base url', () => {
    const c = loadConfig(full);
    expect(c.githubOauthBaseUrl).toBe('https://github.com');
    expect(c.githubApiBaseUrl).toBe('https://api.github.com');
    expect(c.appBaseUrl).toBe('http://localhost:3000');
    expect(c.secureCookies).toBe(false);
  });

  it('marks cookies Secure outside local dev', () => {
    expect(loadConfig({ ...full, APP_BASE_URL: 'https://ladder.example' }).secureCookies).toBe(true);
    expect(loadConfig({ ...full, APP_BASE_URL: 'http://127.0.0.1:4011' }).secureCookies).toBe(false);
  });
});
