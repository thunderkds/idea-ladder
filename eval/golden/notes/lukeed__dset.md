# lukeed/dset @ 05b1ec0f8cebe3b5d5667285bc7da90f38a7215e

Confidence 0.9 (high): 0 good first issue (-0.1).
Labelled from the README and tree at this SHA. Owner spot check pending; `checkedBy` stays `qa-expert` until then.

## Core files (why a reader must open each)

- `src/index.js`: writes a value at a dotted path, creating objects or arrays
- `src/merge.js`: the merge variant that combines instead of replacing
- `test/suites/pollution.js`: shows the prototype-pollution guard
- `src/index.d.ts`: public type signature

## Concepts

- deep property write
- path segments
- prototype pollution
- object merge
