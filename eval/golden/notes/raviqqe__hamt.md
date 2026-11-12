# raviqqe/hamt

- Pinned SHA: `4301c6ce10320ae5d21c97f98d2d3bf707f95c75`
- Tier: lowkey · Language: Go · Expected confidence: high
- Labelled by: qa-expert (agent) on 2026-11-12. A human spot check is still open (`checkedBy` stays `qa-expert` until the owner updates it).

## Core files (why a reader must open each)

- `hamt.go` — Interior trie node: 32-way array, level-based index, Insert and Delete.
- `node.go` — node interface shared by interior and leaf nodes.
- `bucket.go` — Bucket: a slice of entries that share a hash; Insert replaces an equal entry or appends.
- `map.go` — Public immutable Map built on the HAMT.
- `set.go` — Public immutable Set built on the HAMT.
- `entry.go` — Entry interface (Hash and Equal) that keys must satisfy.
- `key_value.go` — keyValue entry type that Map stores (hash and equality come from the key).

## Concepts

- hash array mapped trie
- immutable collections
- persistent data structures
- generics
- hash collisions
- maps and sets

Provenance: the README, the file listing and the declarations (class, function and type names) of the files named above were read at this SHA. The files were not read line by line.
