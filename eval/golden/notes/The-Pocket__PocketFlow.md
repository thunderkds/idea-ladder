# The-Pocket/PocketFlow

- Pinned SHA: `f74d023f93607b8c3268133339a5e532a949898c`
- Tier: trending · Language: Python · Expected confidence: high
- Labelled by: qa-expert (agent) on 2026-11-12. A human spot check is still open (`checkedBy` stays `qa-expert` until the owner updates it).

## Core files (why a reader must open each)

- `pocketflow/__init__.py` — The whole framework in 99 lines: BaseNode, Node (retries), Flow, Batch* and Async* classes.
- `pocketflow/__init__.pyi` — Type stubs that show the public API surface of those classes.
- `docs/core_abstraction/node.md` — Defines a Node as the prep -> exec -> post building block.
- `docs/core_abstraction/flow.md` — Explains how a Flow chains Nodes and branches on the action returned by post().
- `docs/core_abstraction/communication.md` — Explains the shared store that Nodes use to pass data.
- `docs/core_abstraction/batch.md` — Explains BatchNode and BatchFlow for large inputs and reruns.
- `tests/test_flow_basic.py` — Runnable examples of default (>>) and action-based (-) transitions between nodes.

## Concepts

- graph abstraction
- node lifecycle prep exec post
- flow orchestration
- shared store
- batch processing
- async execution

Provenance: the README, the file listing and the declarations (class, function and type names) of the files named above were read at this SHA. The files were not read line by line.
