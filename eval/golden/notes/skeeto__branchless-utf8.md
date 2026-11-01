# skeeto/branchless-utf8 @ e4d82fd5ddae98658f8c129006e3bc5acd0ae9f1

Confidence 0.3 (low): README 526 chars < 1500 (-0.4); 0 good first issue (-0.1); no dependency file (-0.2).
Labelled from the README and tree at this SHA. Owner spot check pending; `checkedBy` stays `qa-expert` until then.

## Core files (why a reader must open each)

- `utf8.h`: the branchless decoder
- `test/tests.c`: correctness tests
- `test/benchmark.c`: speed comparison
- `README.md`: usage example and padding requirement

## Concepts

- utf-8 decoding
- branchless code
- code points
- error detection
