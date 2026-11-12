# sindresorhus/slash

- Pinned SHA: `2e8a56bd8b2863be09d4fc85283c0e465131a6d3`
- Tier: lowkey · Language: JavaScript · Expected confidence: low
- Labelled by: qa-expert (agent) on 2026-11-12. A human spot check is still open (`checkedBy` stays `qa-expert` until the owner updates it).

## Core files (why a reader must open each)

- `index.js` — The whole library: replaces backslashes with slashes unless the path is an extended-length path.
- `test.js` — Cases for normal and extended-length paths.
- `index.d.ts` — Type declaration of the single default export.

## Concepts

- path normalization
- windows backslashes
- extended length paths

Provenance: the README, the file listing and the source files named above were read at this SHA (the sources are short enough to read in full).
