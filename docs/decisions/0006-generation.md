# 0006 — Generation: embedding model, chunking, regeneration prompt (T008)

Date: 2026-11-19. Status: accepted (auto mode; the Supervisor flagged decisions 1 and 2 for the user's review,
`tasks/TASK_REVIEW_T008.md` Auto decisions 4 and 5).

The T008 brainstorm settled three points (TASK_GUIDE_T008 § Approach). Number `0002` is taken by the
`ladder_levels` table, so this record is `0006`.

1. **Embedding model.** OpenAI `text-embedding-3-small`, 1536 dimensions, called through the AI SDK `embedMany`
   with `@ai-sdk/openai` pinned at `3.0.142` (it shares `@ai-sdk/provider` 3.0.19 with `ai` 6.0.317 and
   `@ai-sdk/anthropic` 3.0.135). The key is `OPENAI_API_KEY`; the model id comes from `EMBEDDING_MODEL_ID`
   (default `text-embedding-3-small`). The column is `vector(1536)`, so a model with another dimension needs a
   migration. Each chunk row stores `embedding_model` next to the vector. Embeddings are not covered by the Claude
   subscription (user decision 2026-11-12). An OpenAI chat model goes on T009's model B shortlist, so one key may
   serve both.
2. **Missing key.** `OPENAI_API_KEY` is not on the build machine. The server never falls back to a mock: without the
   key the embedder throws `EmbedderNotConfiguredError` naming `OPENAI_API_KEY` before any network call, and step
   `chunk-and-embed` fails the job with reason `embedder-not-configured` (no retry). The deterministic mock embedder
   lives only in `tests/support/`. The paid golden-set run and the live `/start` wait for the owner's key.
3. **Chunking.** About 1,500 characters per chunk with 200 characters of overlap, each chunk with `path`,
   `startLine`, `endLine` and the commit SHA. Sources: README, `docs/**/*.md`, dependency files, T006 core files.
   The row keeps the raw text; inline markdown is stripped only inside the answer-key check (8c).
4. **Regeneration prompt.** A question that fails the answer-key code check is regenerated with the failure reason
   in the prompt, at most 2 times, then dropped `key-check-failed`.

Accepted consequences:

- **Cost.** `chunk-and-embed` logs one cost line per call: `inputTokens` = the `embedMany` usage tokens,
  `outputTokens` 0. The price table has no verified OpenAI price yet, so the owner adds a `text-embedding-3-small`
  entry to `eval/prices.json` (with a real `checkedAt`) together with the key; until then the server refuses to start
  when `OPENAI_API_KEY` is set and the embedding model has no price, the same rule as `MODEL_A_ID`.
