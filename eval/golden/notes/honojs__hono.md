# honojs/hono

- Pinned SHA: `f6fbaf0299c48eea9e656e03e2ffe7ac755e8823`
- Tier: trending · Language: TypeScript · Expected confidence: high
- Labelled by: qa-expert (agent) on 2026-11-12. A human spot check is still open (`checkedBy` stays `qa-expert` until the owner updates it).

## Core files (why a reader must open each)

- `src/hono.ts` — Hono class: HonoBase with SmartRouter over RegExpRouter and TrieRouter.
- `src/hono-base.ts` — Route registration (#addRoute), sub-app mounting, and #dispatch which matches a route and runs the handlers.
- `src/compose.ts` — Middleware composition (koa-compose style) with error and not-found handlers.
- `src/context.ts` — Context object passed to handlers: request, response helpers, variables.
- `src/request.ts` — HonoRequest wrapper: param, query, header and body parsing.
- `src/router.ts` — Router interface and the constants that every router implements.
- `src/router/reg-exp-router/router.ts` — RegExpRouter: compiles all routes into one regular expression (the README's 'ultrafast' router).
- `src/router/trie-router/router.ts` — TrieRouter: trie-based matcher used as the fallback.
- `src/router/smart-router/router.ts` — SmartRouter: tries each router and keeps the first one that can handle the route set.

## Concepts

- routing
- middleware composition
- request context
- router selection
- web standard apis
- multi runtime adapters

Provenance: the README, the file listing and the declarations (class, function and type names) of the files named above were read at this SHA. The files were not read line by line.
