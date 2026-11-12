# sindresorhus/escape-string-regexp

- Pinned SHA: `a7f7dabaf336bda98d2166848af15d9168b10bcf`
- Tier: medium · Language: JavaScript · Expected confidence: low
- Labelled by: qa-expert (agent) on 2026-11-12. A human spot check is still open (`checkedBy` stays `qa-expert` until the owner updates it).

## Core files (why a reader must open each)

- `index.js` — The whole library: one function that throws on non-strings and escapes regex special characters.
- `test.js` — Cases for which characters get escaped.
- `index.d.ts` — Type declaration of the single default export.

## Concepts

- regex escaping
- special characters
- unicode pattern escape
- input type check

Provenance: the README, the file listing and the source files named above were read at this SHA (the sources are short enough to read in full).
