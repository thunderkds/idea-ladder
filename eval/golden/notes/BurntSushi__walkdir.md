# BurntSushi/walkdir @ 6fd031c82ba5a4204b4ce6eae73dacb00dc072ec

Confidence 0.9 (high): 0 good first issue (-0.1).
Labelled from the README and tree at this SHA. Owner spot check pending; `checkedBy` stays `qa-expert` until then.

## Core files (why a reader must open each)

- `src/lib.rs`: WalkDir builder, iterator and filter_entry
- `src/dent.rs`: the DirEntry type
- `src/error.rs`: error type with loop detection and I/O cases
- `src/util.rs`: platform helpers

## Concepts

- recursive directory walk
- iterator
- symlink following
- pruning entries
- error handling
