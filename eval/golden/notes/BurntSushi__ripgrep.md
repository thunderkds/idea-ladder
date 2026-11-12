# BurntSushi/ripgrep

- Pinned SHA: `178cc027e283fd965cb72d0a7395b219eada170c`
- Tier: trending · Language: Rust · Expected confidence: high
- Labelled by: qa-expert (agent) on 2026-11-12. A human spot check is still open (`checkedBy` stays `qa-expert` until the owner updates it).

## Core files (why a reader must open each)

- `crates/core/main.rs` — The rg binary entry point (Cargo.toml [[bin]] path): parses flags, then runs search, files or types mode.
- `crates/core/search.rs` — Glue that runs the searcher with a printer over one haystack.
- `crates/core/flags/parse.rs` — Command-line flag parsing into low-level args.
- `crates/searcher/src/searcher/mod.rs` — Searcher type: reads input line by line and reports matches to a Sink.
- `crates/ignore/src/walk.rs` — Recursive directory walker that applies ignore rules (sequential and parallel).
- `crates/ignore/src/gitignore.rs` — Gitignore matcher: loads and applies .gitignore rules.
- `crates/regex/src/matcher.rs` — RegexMatcher: the regex-crate backed implementation of the Matcher trait.
- `crates/globset/src/lib.rs` — Glob sets: compiles many globs into one matcher used for ignore and type filters.

## Concepts

- line oriented search
- gitignore filtering
- regex matching
- parallel directory traversal
- cargo workspace crates
- glob matching

Provenance: the README, the file listing and the declarations (class, function and type names) of the files named above were read at this SHA. The files were not read line by line.
