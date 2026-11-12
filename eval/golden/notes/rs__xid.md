# rs/xid

- Pinned SHA: `34d39051ca0d70f40a8cd8c5491ef835e624b71d`
- Tier: medium · Language: Go · Expected confidence: high
- Labelled by: qa-expert (agent) on 2026-11-12. A human spot check is still open (`checkedBy` stays `qa-expert` until the owner updates it).

## Core files (why a reader must open each)

- `id.go` — The whole ID type: New(), 12-byte layout, base32hex encode/decode, JSON/SQL marshalling, sorting.
- `hostid_linux.go` — Reads the machine ID from /etc/machine-id on Linux.
- `hostid_fallback.go` — Fallback machine-ID reader (returns 'not implemented') for systems without their own file.
- `error.go` — ErrInvalidID, returned when an ID fails to decode.

## Concepts

- unique id generation
- mongodb object id layout
- base32hex encoding
- machine id
- sortable ids
- sql and json marshalling

Provenance: the README, the file listing and the declarations (class, function and type names) of the files named above were read at this SHA. The files were not read line by line.
