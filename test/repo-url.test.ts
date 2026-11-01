import { describe, expect, it } from 'vitest';
import { parseRepoUrl, UnsupportedUrlError } from '../src/start/repo-url.js';

const accepted: Array<[string, { owner: string; name: string }]> = [
  ['https://github.com/o/n', { owner: 'o', name: 'n' }],
  ['http://github.com/o/n', { owner: 'o', name: 'n' }],
  ['https://www.github.com/o/n', { owner: 'o', name: 'n' }],
  ['https://github.com/o/n/', { owner: 'o', name: 'n' }],
  ['https://github.com/o/n.git', { owner: 'o', name: 'n' }],
  ['https://github.com/o/n/tree/main', { owner: 'o', name: 'n' }],
  ['https://github.com/o/n/tree/main/src/deep/dir', { owner: 'o', name: 'n' }],
  ['o/n', { owner: 'o', name: 'n' }],
  ['  https://github.com/developit/mitt  ', { owner: 'developit', name: 'mitt' }],
  ['https://GitHub.com/Developit/Mitt', { owner: 'Developit', name: 'Mitt' }],
  ['https://github.com/o/my.repo_name-2', { owner: 'o', name: 'my.repo_name-2' }],
  ['https://github.com/o/n?tab=readme#top', { owner: 'o', name: 'n' }],
];

const rejected: string[] = [
  'javascript:alert(1)',
  'file:///etc/passwd',
  'ftp://github.com/o/n',
  'https://gitlab.com/o/n',
  'https://github.com.evil.example/o/n',
  'https://evil.example/https://github.com/o/n',
  'https://github.com/o',
  'https://github.com/',
  'https://github.com/o/n/issues',
  'https://github.com/o/n/tree',
  'https://github.com//n',
  'https://github.com/o/../n',
  'https://user:pw@github.com/o/n',
  'https://github.com:8443/o/n',
  'https://github.com/-bad_owner!/n',
  'https://github.com/o/%2e%2e',
  'o/n/extra',
  'not a url',
  '',
  `https://github.com/${'a'.repeat(40)}/n`,
  `https://github.com/o/${'n'.repeat(101)}`,
  'https://github.com/o/.git',
];

describe('parseRepoUrl', () => {
  it.each(accepted)('accepts %s', (input, expected) => {
    expect(parseRepoUrl(input)).toEqual(expected);
  });

  it.each(rejected)('rejects %j with UnsupportedUrlError', (input) => {
    expect(() => parseRepoUrl(input)).toThrow(UnsupportedUrlError);
  });

  it('makes no network call for any input', () => {
    const real = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (() => {
      calls++;
      return Promise.reject(new Error('network is off'));
    }) as typeof fetch;
    try {
      for (const [input] of accepted) parseRepoUrl(input);
      for (const input of rejected) expect(() => parseRepoUrl(input)).toThrow(UnsupportedUrlError);
    } finally {
      globalThis.fetch = real;
    }
    expect(calls).toBe(0);
  });
});
