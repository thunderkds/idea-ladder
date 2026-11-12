# sindresorhus/is-plain-obj

- Pinned SHA: `666df7c10035f7e26f27ec214fe5ae3173435f34`
- Tier: lowkey · Language: JavaScript · Expected confidence: low
- Labelled by: qa-expert (agent) on 2026-11-12. A human spot check is still open (`checkedBy` stays `qa-expert` until the owner updates it).

## Core files (why a reader must open each)

- `index.js` — The whole library: checks the prototype chain and rejects Symbol.toStringTag and Symbol.iterator objects.
- `test.js` — Cases including null-prototype objects and objects from another realm (vm context).
- `index.d.ts` — Type guard declaration of the single default export.

## Concepts

- plain object detection
- prototype chain
- symbol checks
- cross realm objects

Provenance: the README, the file listing and the source files named above were read at this SHA (the sources are short enough to read in full).
