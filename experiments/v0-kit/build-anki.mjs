#!/usr/bin/env node
// Builds one Anki plain-text import file per ladder in ./ladders.
// Usage: node build-anki.mjs [--ladders DIR] [--out DIR] [--readmes DIR]
// --readmes DIR (optional): DIR/<ladder>.md holds the repo README; a card Back that
// repeats a README line verbatim fails the build (Grill #9: cards are original text).
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const LEVELS = [
  ['L0', 'Prerequisites'],
  ['L1', 'Run it'],
  ['L2', 'Modify'],
  ['L3', 'Understand'],
  ['L4', 'Rebuild or contribute'],
];
const MIN_CARDS = 3;
const MAX_BACK = 300;
const MIN_README_LINE = 25;

const norm = (s) => s.replace(/\s+/g, ' ').trim();

// Splits a markdown table row on unescaped pipes; "\|" becomes "|".
function splitRow(line) {
  const cells = [];
  let cur = '';
  const s = line.trim().replace(/^\|/, '').replace(/\|$/, (m, off, whole) => (whole[off - 1] === '\\' ? m : ''));
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') { cur += '|'; i++; }
    else if (s[i] === '|') { cells.push(cur); cur = ''; }
    else cur += s[i];
  }
  cells.push(cur);
  return cells.map((c) => c.replace(/^ /, '').replace(/ $/, ''));
}

export function parseLadder(text, file) {
  const fail = (msg) => { throw new Error(`${file}: ${msg}`); };
  const repo = /^- Repo: (\S+)$/m.exec(text)?.[1];
  if (!repo) fail('missing "- Repo: owner/name" header line');
  const sha = /^- Commit: ([0-9a-f]{40})$/m.exec(text)?.[1];
  if (!sha) fail('missing "- Commit: <40-hex sha>" header line');

  const levels = [];
  for (const [id, name] of LEVELS) {
    const start = text.search(new RegExp(`^## ${id} ${name}\\s*$`, 'm'));
    if (start < 0) fail(`missing level section "## ${id} ${name}"`);
    const rest = text.slice(start + 1);
    const nextIdx = rest.search(/^## /m);
    const section = nextIdx < 0 ? rest : rest.slice(0, nextIdx);
    if (!/^\*\*Goal:\*\* \S/m.test(section)) fail(`${id}: missing "**Goal:**" line`);
    if (!/^\*\*Pass test \(proof\):\*\* \S/m.test(section)) fail(`${id}: missing "**Pass test (proof):**" line`);
    const rows = section.split('\n').filter((l) => l.trim().startsWith('|'));
    const header = rows[0] && splitRow(rows[0]);
    if (!header || header[0] !== 'Front' || header[1] !== 'Back') fail(`${id}: missing "| Front | Back |" cards table`);
    const cards = rows.slice(2).map((r, i) => {
      const cells = splitRow(r);
      if (cells.length !== 2) fail(`${id} card ${i + 1}: expected 2 columns, found ${cells.length}`);
      return { front: cells[0], back: cells[1], n: i + 1 };
    });
    levels.push({ id, cards });
  }
  return { repo, sha, levels };
}

export function validateLadder(ladder, file, readmeText) {
  const fail = (id, n, msg) => { throw new Error(`${file}: ${id} card ${n}: ${msg}`); };
  const readmeLines = readmeText
    ? readmeText.split('\n').map(norm).filter((l) => l.length >= MIN_README_LINE)
    : [];
  for (const { id, cards } of ladder.levels) {
    if (cards.length < MIN_CARDS) throw new Error(`${file}: ${id} has ${cards.length} cards, needs at least ${MIN_CARDS}`);
    for (const { front, back, n } of cards) {
      for (const [label, v] of [['Front', front], ['Back', back]]) {
        if (!v) fail(id, n, `${label} is empty`);
        if (/\t/.test(v)) fail(id, n, `${label} contains a tab ("${v.slice(0, 40)}")`);
        if (/[\r\n]/.test(v)) fail(id, n, `${label} contains a newline`);
        if (v.startsWith('"')) fail(id, n, `${label} starts with a double quote (Anki reads it as CSV quoting)`);
      }
      if (back.length > MAX_BACK) fail(id, n, `Back is ${back.length} chars, max ${MAX_BACK}`);
      if (/```/.test(front) || /```/.test(back)) fail(id, n, 'contains a fenced code block');
      const nb = norm(back);
      const hit = readmeLines.find((l) => l === nb || nb.includes(l));
      if (hit) fail(id, n, `Back repeats a README line verbatim ("${hit.slice(0, 40)}...")`);
    }
  }
}

export function toAnki(ladder, name) {
  const lines = ['#separator:tab', '#html:false', '#tags column:3'];
  for (const { id, cards } of ladder.levels) {
    for (const { front, back } of cards) lines.push(`${front}\t${back}\tidea-ladder ${name} ${id}`);
  }
  return lines.join('\n') + '\n';
}

export function buildAll({ laddersDir, outDir, readmesDir }) {
  const files = readdirSync(laddersDir).filter((f) => f.endsWith('.md')).sort();
  if (files.length === 0) throw new Error(`${laddersDir}: no ladder .md files found`);
  // Validate everything first, so a bad ladder writes nothing.
  const built = files.map((f) => {
    const name = basename(f, '.md');
    const ladder = parseLadder(readFileSync(join(laddersDir, f), 'utf8'), f);
    const readmePath = readmesDir && join(readmesDir, f);
    const readme = readmePath && existsSync(readmePath) ? readFileSync(readmePath, 'utf8') : undefined;
    validateLadder(ladder, f, readme);
    return { name, ladder };
  });
  mkdirSync(outDir, { recursive: true });
  return built.map(({ name, ladder }) => {
    writeFileSync(join(outDir, `${name}.txt`), toAnki(ladder, name));
    return { name, counts: ladder.levels.map((l) => l.cards.length) };
  });
}

function main(argv) {
  const here = dirname(fileURLToPath(import.meta.url));
  const opt = (flag, dflt) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : dflt; };
  try {
    const results = buildAll({
      laddersDir: opt('--ladders', join(here, 'ladders')),
      outDir: opt('--out', join(here, 'anki')),
      readmesDir: opt('--readmes', undefined),
    });
    for (const { name, counts } of results) {
      const per = counts.map((c, i) => `L${i}=${c}`).join(' ');
      console.log(`${name}: ${counts.reduce((a, b) => a + b, 0)} cards (${per})`);
    }
  } catch (e) {
    console.error(`build-anki: ${e.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv.slice(2));
