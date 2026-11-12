# dtolnay/semver

- Pinned SHA: `280ebcb6edac3aa4cdc545dbff8a26c5ac4861fe`
- Tier: medium · Language: Rust · Expected confidence: high
- Labelled by: qa-expert (agent) on 2026-11-12. A human spot check is still open (`checkedBy` stays `qa-expert` until the owner updates it).

## Core files (why a reader must open each)

- `src/lib.rs` — Public types Version, VersionReq, Comparator, Op, Prerelease, BuildMetadata with the crate docs.
- `src/parse.rs` — Hand-written parser for versions and requirements.
- `src/eval.rs` — Matching of a Version against a VersionReq (exact, greater, less, tilde, caret, pre-release rules).
- `src/identifier.rs` — Compact string type used for prerelease and build identifiers.
- `src/display.rs` — Display implementations.
- `src/impls.rs` — Trait implementations (Default, Hash, Ordering, Deref) for the identifier-backed types.
- `src/error.rs` — Parse error type.

## Concepts

- semantic versioning
- version requirement matching
- caret and tilde operators
- prerelease and build metadata
- parsing
- compact identifier storage

Provenance: the README, the file listing and the declarations (class, function and type names) of the files named above were read at this SHA. The files were not read line by line.
