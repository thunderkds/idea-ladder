# developit/mitt

- Pinned SHA: `6b41670516ed8e8b738612f60491995470aa63b3`
- Tier: trending · Language: TypeScript · Expected confidence: high
- Labelled by: qa-expert (agent) on 2026-11-12. A human spot check is still open (`checkedBy` stays `qa-expert` until the owner updates it).

## Core files (why a reader must open each)

- `src/index.ts` — The whole library: Emitter type plus on/off/emit over a Map of handler arrays, with the '*' wildcard.
- `test/index_test.ts` — Behaviour spec for on(), off() (first match only; no handler removes all), emit() and '*' handlers.
- `test/test-types-compilation.ts` — Shows how the Events generic types handler payloads.

## Concepts

- event emitter
- publish subscribe
- wildcard handlers
- handler registration on off
- typescript generics

Provenance: the README, the file listing and the source files named above were read at this SHA (the sources are short enough to read in full).
