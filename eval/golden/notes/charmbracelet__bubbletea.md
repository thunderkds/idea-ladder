# charmbracelet/bubbletea

- Pinned SHA: `e4d617e7e0c0dd595cc553a856236221c678470f`
- Tier: trending · Language: Go · Expected confidence: high
- Labelled by: qa-expert (agent) on 2026-11-12. A human spot check is still open (`checkedBy` stays `qa-expert` until the owner updates it).

## Core files (why a reader must open each)

- `tea.go` — Model interface (Init, Update, View), Msg, Cmd, NewProgram, Program.Run and the event loop.
- `commands.go` — Batch and Sequence commands and the other built-in Cmd helpers.
- `key.go` — Key and KeyPressMsg types for keyboard input.
- `options.go` — ProgramOption functions that configure a Program.
- `renderer.go` — The renderer interface the program draws through.
- `cursed_renderer.go` — Default cell-based renderer implementation (the 'high-performance renderer' in the README).

## Concepts

- elm architecture
- model update view
- commands and messages
- event loop
- terminal rendering
- keyboard input

Provenance: the README, the file listing and the declarations (class, function and type names) of the files named above were read at this SHA. The files were not read line by line.
