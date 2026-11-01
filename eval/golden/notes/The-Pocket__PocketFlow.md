# The-Pocket/PocketFlow @ f74d023f93607b8c3268133339a5e532a949898c

Confidence 0.9 (high): 0 good first issue (-0.1).
Labelled from the README and tree at this SHA. Owner spot check pending; `checkedBy` stays `qa-expert` until then.

## Core files (why a reader must open each)

- `pocketflow/__init__.py`: the whole framework: Node, Flow, batch and async variants in one file
- `pocketflow/__init__.pyi`: type stubs that show the public API shape
- `docs/core_abstraction/node.md`: explains the Node prep/exec/post lifecycle
- `docs/core_abstraction/flow.md`: explains how actions route between nodes
- `docs/core_abstraction/communication.md`: explains the shared store that nodes use to pass data

## Concepts

- node lifecycle
- flow graph
- shared store
- batch processing
- async nodes
