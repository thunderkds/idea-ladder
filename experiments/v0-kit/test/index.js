import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, '..', 'build-anki.mjs');
const realLadders = join(here, '..', 'ladders');
const SHA = 'a'.repeat(40);

const LEVELS = [
  ['L0', 'Prerequisites'],
  ['L1', 'Run it'],
  ['L2', 'Modify'],
  ['L3', 'Understand'],
  ['L4', 'Rebuild or contribute'],
];

function levelBlock(id, name, cardRows) {
  return [
    `## ${id} ${name}`,
    '',
    '**Goal:** do the thing.',
    '',
    '**Pass test (proof):** show the log.',
    '',
    '| Front | Back |',
    '|---|---|',
    ...cardRows,
    '',
  ].join('\n');
}

function cardRows(n, back = 'An original answer.') {
  return Array.from({ length: n }, (_, i) => `| Question ${i + 1}? | ${back} |`);
}

function ladder({ skip = [], rowsFor = {}, header } = {}) {
  const head = header ?? `# Ladder: fix/ture\n\n- Repo: fix/ture\n- Commit: ${SHA}\n\n`;
  const body = LEVELS.filter(([id]) => !skip.includes(id))
    .map(([id, name]) => levelBlock(id, name, rowsFor[id] ?? cardRows(3)))
    .join('\n');
  return head + body;
}

function run(files, extraArgs = [], { readmes } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'v0kit-'));
  const ladders = join(root, 'ladders');
  const out = join(root, 'anki');
  mkdirSync(ladders);
  for (const [name, text] of Object.entries(files)) writeFileSync(join(ladders, name), text);
  const args = [script, '--ladders', ladders, '--out', out, ...extraArgs];
  if (readmes) {
    const rd = join(root, 'readmes');
    mkdirSync(rd);
    for (const [name, text] of Object.entries(readmes)) writeFileSync(join(rd, name), text);
    args.push('--readmes', rd);
  }
  const r = spawnSync(process.execPath, args, { encoding: 'utf8' });
  return { ...r, out };
}

test('happy path on the 3 real ladders: exit 0, 3 files, headers and tab-separated rows', () => {
  const root = mkdtempSync(join(tmpdir(), 'v0kit-real-'));
  const out = join(root, 'anki');
  const r = spawnSync(process.execPath, [script, '--ladders', realLadders, '--out', out], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(readdirSync(out).sort(), ['dset.txt', 'mitt.txt', 'pocketflow.txt']);
  for (const name of ['pocketflow', 'mitt', 'dset']) {
    const lines = readFileSync(join(out, `${name}.txt`), 'utf8').split('\n').filter(Boolean);
    assert.deepEqual(lines.slice(0, 3), ['#separator:tab', '#html:false', '#tags column:3']);
    const cards = lines.slice(3);
    assert.ok(cards.length >= 15, `${name} has ${cards.length} cards`);
    for (const line of cards) {
      const cols = line.split('\t');
      assert.equal(cols.length, 3, line);
      assert.match(cols[2], new RegExp(`^idea-ladder ${name} L[0-4]$`));
      assert.ok(cols[1].length <= 300, `Back too long: ${line}`);
    }
    for (const lvl of ['L0', 'L1', 'L2', 'L3', 'L4']) {
      assert.ok(cards.filter((c) => c.endsWith(` ${lvl}`)).length >= 3, `${name} ${lvl} < 3 cards`);
    }
  }
  assert.match(r.stdout, /pocketflow: \d+ cards/);
  assert.match(r.stdout, /mitt: \d+ cards/);
  assert.match(r.stdout, /dset: \d+ cards/);
});

test('real ladders carry repo, 40-hex commit SHA; dset states low confidence and concept-only L0-L1', () => {
  const expected = { pocketflow: 'The-Pocket/PocketFlow', mitt: 'developit/mitt', dset: 'lukeed/dset' };
  for (const [name, repo] of Object.entries(expected)) {
    const text = readFileSync(join(realLadders, `${name}.md`), 'utf8');
    assert.ok(text.includes(`- Repo: ${repo}`), `${name} repo`);
    assert.match(text, /^- Commit: [0-9a-f]{40}$/m, `${name} sha`);
    assert.match(text, /^- Confidence: /m, `${name} confidence`);
  }
  const dset = readFileSync(join(realLadders, 'dset.md'), 'utf8');
  assert.match(dset, /^- Confidence: (low|medium-low)/m);
  assert.match(dset, /concept-only/i);
});

test('valid fixture builds; escaped pipe is unescaped to a real pipe', () => {
  const text = ladder({ rowsFor: { L0: ['| What is a\\|b? | Either a\\|b works. |', ...cardRows(2)] } });
  const r = run({ 'fix.md': text });
  assert.equal(r.status, 0, r.stderr);
  const body = readFileSync(join(r.out, 'fix.txt'), 'utf8');
  assert.ok(body.includes('What is a|b?\tEither a|b works.\tidea-ladder fix L0'));
});

test('tab inside a Back field fails and names file and card', () => {
  const text = ladder({ rowsFor: { L1: ['| Q1? | has\ta tab |', ...cardRows(2)] } });
  const r = run({ 'fix.md': text });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /fix\.md/);
  assert.match(r.stderr, /L1 card 1/);
  assert.match(r.stderr, /tab/);
});

test('missing L3 section fails', () => {
  const r = run({ 'fix.md': ladder({ skip: ['L3'] }) });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /fix\.md/);
  assert.match(r.stderr, /L3/);
});

test('a level with only 2 cards fails', () => {
  const r = run({ 'fix.md': ladder({ rowsFor: { L2: cardRows(2) } }) });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /L2/);
  assert.match(r.stderr, /at least 3/);
});

test('Back longer than 300 chars fails', () => {
  const r = run({ 'fix.md': ladder({ rowsFor: { L0: cardRows(3, 'x'.repeat(301)) } }) });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /L0 card 1/);
  assert.match(r.stderr, /300/);
});

test('a fenced code block in a Back field fails', () => {
  const r = run({ 'fix.md': ladder({ rowsFor: { L0: cardRows(3, 'see ```code``` here') } }) });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /fenced/);
});

test('a field starting with a double quote fails (Anki would read it as CSV quoting)', () => {
  const r = run({ 'fix.md': ladder({ rowsFor: { L0: ['| Q? | "quoted" answer |', ...cardRows(2)] } }) });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /double quote/);
});

test('missing Repo or Commit header fails', () => {
  const r = run({ 'fix.md': ladder({ header: '# Ladder: fix\n\n' }) });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Repo|Commit/);
});

test('a missing Goal or Pass test line in a level fails', () => {
  const text = ladder().replace('**Pass test (proof):** show the log.', '');
  const r = run({ 'fix.md': text });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Pass test/);
});

test('--readmes: a Back that equals a README line verbatim fails; original text passes', () => {
  const copied = 'This line was copied straight from the readme file.';
  const bad = run({ 'fix.md': ladder({ rowsFor: { L0: cardRows(3, copied) } }) }, [], {
    readmes: { 'fix.md': `# Title\n\n${copied}\n` },
  });
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /README/);
  const ok = run({ 'fix.md': ladder() }, [], { readmes: { 'fix.md': '# Title\n\nSomething else entirely here.\n' } });
  assert.equal(ok.status, 0, ok.stderr);
});
