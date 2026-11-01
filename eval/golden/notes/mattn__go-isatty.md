# mattn/go-isatty @ c44dc0b9c702c76577fdb7898032969e0611efc2

Confidence 0.2 (low): README 1088 chars < 1500 (-0.4); 0 open issues (-0.3); 0 good first issue (-0.1).
Labelled from the README and tree at this SHA. Owner spot check pending; `checkedBy` stays `qa-expert` until then.

## Core files (why a reader must open each)

- `doc.go`: package overview
- `isatty_tiocgwinsz.go`: the ioctl-based check on unix
- `isatty_bsd.go`: the BSD variant
- `isatty_windows.go`: the Windows console check
- `isatty_others.go`: fallback for other platforms

## Concepts

- terminal detection
- build tags
- platform specific code
- cygwin pipes
