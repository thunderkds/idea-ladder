# lukeed/polka @ c36cf8b5d1a57164e64fdd7d4e0d0f80ab262dc0

Confidence 0.9 (high): 0 good first issue (-0.1).
Labelled from the README and tree at this SHA. Owner spot check pending; `checkedBy` stays `qa-expert` until then.

## Core files (why a reader must open each)

- `packages/polka/index.js`: the router app: use, handler and listen
- `packages/url/index.js`: request URL parsing helper
- `packages/send/index.js`: response sending helper
- `packages/send-type/index.js`: sending with a content type
- `tests/polka.js`: shows routing, middleware and sub-app behaviour

## Concepts

- http router
- middleware
- monorepo packages
- request url parsing
- response helpers
