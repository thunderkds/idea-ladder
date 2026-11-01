# tidwall/btree @ 142fe5941ebbd69a37eddfa5fdc34d197faa188a

Confidence 0.9 (high): 0 good first issue (-0.1).
Labelled from the README and tree at this SHA. Owner spot check pending; `checkedBy` stays `qa-expert` until then.

## Core files (why a reader must open each)

- `btree.go`: the original B-tree with interface items
- `btreeg.go`: the generic B-tree
- `map.go`: ordered Map on top of the B-tree
- `set.go`: ordered Set on top of the B-tree

## Concepts

- b-tree
- generics
- copy on write
- path hinting
- ordered map
