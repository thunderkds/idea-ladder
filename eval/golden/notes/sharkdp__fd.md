# sharkdp/fd @ 8b14e8dc5f1bd8c2656d735e80f1e6335b335bbf

Confidence 0.9 (high): 0 good first issue (-0.1).
Labelled from the README and tree at this SHA. Owner spot check pending; `checkedBy` stays `qa-expert` until then.

## Core files (why a reader must open each)

- `src/main.rs`: program entry: builds the config and starts the walk
- `src/walk.rs`: the parallel directory traversal and result sending
- `src/cli.rs`: command-line options
- `src/filesystem.rs`: path and file-type helpers
- `src/filter/mod.rs`: size, time and owner filters
- `src/exec/mod.rs`: running a command on each result

## Concepts

- parallel directory walk
- regex and glob patterns
- ignore files
- result filtering
- command execution
