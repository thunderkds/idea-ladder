# dtolnay/itoa

- Pinned SHA: `9339ca99a43c550b5ee36e2afe524d1c90413461`
- Tier: lowkey · Language: Rust · Expected confidence: high
- Labelled by: qa-expert (agent) on 2026-11-12. A human spot check is still open (`checkedBy` stays `qa-expert` until the owner updates it).

## Core files (why a reader must open each)

- `src/lib.rs` — Buffer type, sealed Integer trait and the macro-generated impls for every integer type.
- `src/u128_ext.rs` — mulhi(): upper 128 bits of a 128-bit multiply, used by the u128 formatting path.
- `tests/test.rs` — Macro-generated tests of format() output for each integer type.
- `benches/bench.rs` — Benchmark against the standard formatter (the README's performance claim).

## Concepts

- integer to string
- stack buffer
- sealed trait
- macro generated impls
- avoiding fmt overhead

Provenance: the README, the file listing and the declarations (class, function and type names) of the files named above were read at this SHA. The files were not read line by line.
