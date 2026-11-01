# rxi/fe @ ed4cda96bd582cbb08520964ba627efb40f3dd91

Confidence 0.3 (low): README 1059 chars < 1500 (-0.4); 0 good first issue (-0.1); no dependency file (-0.2).
Labelled from the README and tree at this SHA. Owner spot check pending; `checkedBy` stays `qa-expert` until then.

## Core files (why a reader must open each)

- `src/fe.c`: the interpreter: reader, evaluator, garbage collector
- `src/fe.h`: the C API
- `doc/impl.md`: explains the implementation
- `doc/lang.md`: the language reference

## Concepts

- lisp interpreter
- embeddable language
- garbage collection
- fixed memory region
- closures
