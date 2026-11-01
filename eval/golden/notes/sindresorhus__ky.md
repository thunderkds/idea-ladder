# sindresorhus/ky @ 3541888878c4d303a8bc2ad61815f4e048f55a5d

Confidence 0.6 (medium): 0 open issues (-0.3); 0 good first issue (-0.1).
Labelled from the README and tree at this SHA. Owner spot check pending; `checkedBy` stays `qa-expert` until then.

## Core files (why a reader must open each)

- `source/core/Ky.ts`: the main client class that builds and sends the request
- `source/index.ts`: public entry: the ky function and its method shortcuts
- `source/utils/merge.ts`: merges default and per-call options
- `source/utils/timeout.ts`: request timeout handling
- `source/core/retry-timing.ts`: retry delay calculation
- `source/types/hooks.ts`: the hook types (beforeRequest, afterResponse, ...)

## Concepts

- fetch wrapper
- retry with backoff
- hooks
- timeout
- http errors
