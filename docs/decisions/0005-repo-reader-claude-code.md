# 0005 — Repo reader on the claude-code back end (T006)

Date: 2026-11-12. Status: accepted.

Model A has two back ends behind `MODEL_A_BACKEND` (user decision 2026-11-12: subscription first, API key
optional). `claude-code` (default) runs the repo reader through headless `claude -p` on the owner's subscription,
with the same three read-only tools (`list`, `read`, `search`, built by `createReaderTools`) served by a stdio MCP
server (`src/server/reader-mcp.ts`), every built-in tool off and only that server loaded (TASK_GUIDE_T006 AC 9).
`api` runs the AI SDK tool loop with `ANTHROPIC_API_KEY`.

Accepted consequences of the claude-code path:

- **Session transcripts.** The CLI writes a session transcript under `~/.claude/projects`; this is accepted
  housekeeping, because the one repair run needs `--resume` on that session.
- **Live GitHub reads, no file cache.** The MCP server reads GitHub live at the pinned SHA and does not use
  `repo_file_cache`, so a retried step re-reads its files. Unauthenticated GitHub reads allow 60 requests per hour,
  so the app token is passed to the MCP server (only in its own env, never to the `claude` process), with the
  configured `GITHUB_API_BASE_URL`.
- **Token budget.** `READER_TOKEN_BUDGET` counts cached input tokens (cache reads and cache writes) the same way the
  API back end counts input tokens: total = input + output + cache read + cache creation.
