# tidwall/jsonc @ 47bcc8d156812b0ba7ee42372b2259b645e9a092

Confidence 0.9 (high): 0 good first issue (-0.1).
Labelled from the README and tree at this SHA. Owner spot check pending; `checkedBy` stays `qa-expert` until then.

## Core files (why a reader must open each)

- `jsonc.go`: converts jsonc to json by removing comments and trailing commas
- `jsonc_test.go`: cases for comments and commas
- `README.md`: format description

## Concepts

- jsonc format
- comment stripping
- trailing commas
- byte scanner
