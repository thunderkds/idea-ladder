# developit/mitt @ 6b41670516ed8e8b738612f60491995470aa63b3

Confidence 0.9 (high): 0 good first issue (-0.1).
Labelled from the README and tree at this SHA. Owner spot check pending; `checkedBy` stays `qa-expert` until then.

## Core files (why a reader must open each)

- `src/index.ts`: the whole library: a handler map with on, off and emit
- `test/index_test.ts`: shows wildcard and removal behaviour
- `package.json`: build outputs and entry points

## Concepts

- event emitter
- publish subscribe
- wildcard handler
- handler map
- typescript generics
