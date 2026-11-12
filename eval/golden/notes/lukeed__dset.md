# lukeed/dset

- Pinned SHA: `05b1ec0f8cebe3b5d5667285bc7da90f38a7215e`
- Tier: medium · Language: JavaScript · Expected confidence: high
- Labelled by: qa-expert (agent) on 2026-11-12. A human spot check is still open (`checkedBy` stays `qa-expert` until the owner updates it).

## Core files (why a reader must open each)

- `src/index.js` — dset(): walks a dot path or key array and writes a value, creating objects or arrays on the way.
- `src/merge.js` — dset/merge variant: merges into an existing value instead of replacing it.
- `test/index.js` — Test entry that loads the arrays, assigns, pollution and preserve suites.
- `test/suites/pollution.js` — Shows the guard against __proto__, constructor and prototype keys.

## Concepts

- deep object assignment
- dot path keys
- prototype pollution guard
- merge mode
- array or object inference

Provenance: the README, the file listing and the source files named above were read at this SHA (the sources are short enough to read in full).
