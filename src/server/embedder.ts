// T008 (8a): embeddings for grounding chunks through AI SDK `embedMany` (OpenAI text-embedding-3-small, ADR 0006).
// No mock fallback here: without OPENAI_API_KEY every call fails, naming the key. The test mock is tests/support only.
import { createOpenAI } from "@ai-sdk/openai";
import { embedMany } from "ai";

/** Fixed by the `chunks.embedding vector(1536)` column (migrations/0008_generation.up.sql). */
export const EMBEDDING_DIMENSIONS = 1536;
export const DEFAULT_EMBEDDING_MODEL_ID = "text-embedding-3-small";
/** One `embedMany` call gets at most this many texts ... */
export const EMBED_BATCH_MAX_TEXTS = 200;
/** ... and at most this many characters (~100k tokens, far under OpenAI's per-request input cap). */
export const EMBED_BATCH_MAX_CHARS = 400_000;

export type EmbedResult = { embeddings: number[][]; tokens: number };
/** `model` is the id written to the cost log and to `chunks.embedding_model`. */
export type Embedder = { model: string; embedTexts: (texts: string[]) => Promise<EmbedResult> };
type EmbeddingModel = Parameters<typeof embedMany>[0]["model"];

/** OPENAI_API_KEY is missing: a retry cannot help, so the job fails at once. */
export class EmbedderNotConfiguredError extends Error {
  readonly code = "embedder-not-configured";
  constructor() {
    super("embedder-not-configured: OPENAI_API_KEY is not set; embeddings need it (there is no mock fallback)");
    this.name = "EmbedderNotConfiguredError";
  }
}

/**
 * One `embedMany` call per batch, in input order; embeddings concatenated, usage tokens summed. The SDK splits
 * only by count (`maxEmbeddingsPerCall`), never by size, and an OpenAI request has a total-input token cap, so
 * batches are bounded here by EMBED_BATCH_MAX_TEXTS and EMBED_BATCH_MAX_CHARS. Every text is embedded.
 */
export function embedderFromModel(model: EmbeddingModel, modelId: string): Embedder {
  return {
    model: modelId,
    embedTexts: async (texts) => {
      const batches: string[][] = [];
      let batch: string[] = [];
      let chars = 0;
      for (const t of texts) {
        if (batch.length > 0 && (batch.length >= EMBED_BATCH_MAX_TEXTS || chars + t.length > EMBED_BATCH_MAX_CHARS)) {
          batches.push(batch);
          batch = [];
          chars = 0;
        }
        batch.push(t);
        chars += t.length;
      }
      if (batch.length > 0) batches.push(batch);
      const out: EmbedResult = { embeddings: [], tokens: 0 };
      for (const values of batches) {
        const r = await embedMany({ model, values });
        out.embeddings.push(...r.embeddings);
        out.tokens += r.usage.tokens;
      }
      return out;
    },
  };
}

/** The server's embedder. Explicit base URL: never an OPENAI_BASE_URL from the environment. */
export function createOpenAIEmbedder({ apiKey, modelId }: { apiKey?: string; modelId: string }): Embedder {
  if (!apiKey)
    return {
      model: modelId,
      embedTexts: async () => {
        throw new EmbedderNotConfiguredError();
      },
    };
  return embedderFromModel(createOpenAI({ apiKey, baseURL: "https://api.openai.com/v1" }).embedding(modelId), modelId);
}
