# lukeed/klona

- Pinned SHA: `e563341d88f433e74a9b4c3c0372d4ba55d2f79e`
- Tier: medium · Language: JavaScript · Expected confidence: high
- Labelled by: qa-expert (agent) on 2026-11-12. A human spot check is still open (`checkedBy` stays `qa-expert` until the owner updates it).

## Core files (why a reader must open each)

- `src/index.js` — Default mode: deep clone of objects, arrays, dates, regexps, maps, sets and typed arrays.
- `src/lite.js` — Lite mode: handles plain objects, arrays and a few built-in types for a smaller size.
- `src/full.js` — Full mode: also copies symbols and property descriptors.
- `src/json.js` — JSON mode: clones arrays and objects only (JSON-safe values).
- `index.d.ts` — Type declaration of klona(), shared by all four modes.

## Concepts

- deep clone
- recursive copy
- clone modes json lite default full
- property descriptors
- typed arrays and special types

Provenance: the README, the file listing and the declarations (class, function and type names) of the files named above were read at this SHA. The files were not read line by line.
