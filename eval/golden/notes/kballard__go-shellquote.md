# kballard/go-shellquote

- Pinned SHA: `95032a82bc518f77982ea72343cc1ade730072f0`
- Tier: lowkey · Language: Go · Expected confidence: low
- Labelled by: qa-expert (agent) on 2026-11-12. A human spot check is still open (`checkedBy` stays `qa-expert` until the owner updates it).

## Core files (why a reader must open each)

- `quote.go` — Join(): quotes each argument so /bin/sh splits it back to the original arguments.
- `unquote.go` — Split(): word splitting by sh rules with the three Unterminated* errors.
- `quote_test.go` — Round-trip and quoting cases.
- `unquote_test.go` — Splitting and error cases.

## Concepts

- shell word splitting
- quoting and escaping
- sh semantics
- unterminated quote errors

Provenance: the README, the file listing and the declarations (class, function and type names) of the files named above were read at this SHA. The files were not read line by line.
