# mattn/go-isatty

- Pinned SHA: `c44dc0b9c702c76577fdb7898032969e0611efc2`
- Tier: medium · Language: Go · Expected confidence: low
- Labelled by: qa-expert (agent) on 2026-11-12. A human spot check is still open (`checkedBy` stays `qa-expert` until the owner updates it).

## Core files (why a reader must open each)

- `isatty_tiocgwinsz.go` — Linux/AIX IsTerminal using the TIOCGWINSZ ioctl (comment explains why not TCGETS).
- `isatty_bsd.go` — BSD and macOS IsTerminal using TIOCGETA through x/sys/unix.
- `isatty_windows.go` — Windows IsTerminal (GetConsoleMode) and IsCygwinTerminal (named-pipe name check).
- `isatty_others.go` — Fallback that returns false on js, appengine, tinygo and wasm.
- `isatty_solaris.go` — Solaris IsTerminal.

## Concepts

- terminal detection
- file descriptors
- build tags per platform
- cygwin and msys terminals
- ioctl system calls

Provenance: the README, the file listing and the declarations (class, function and type names) of the files named above were read at this SHA. The files were not read line by line.
