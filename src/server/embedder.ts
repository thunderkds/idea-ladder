// T008 (8a): embeddings for grounding chunks through AI SDK `embedMany` (OpenAI text-embedding-3-small, ADR 0006).
// No mock fallback here: without OPENAI_API_KEY every call fails, naming the key. The test mock is tests/support only.
import { createOpenAI } from "@ai-sdk/openai";
import { embedMany } from "ai";

/** Fixed by the `chunks.embedding vector(1536)` column (migrations/0008_generation.up.sql). */
export const EMBEDDING_DIMENSIONS = 1536;
export const DEFAULT_EMBEDDING_MODEL_ID = "text-embedding-3-small";

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

/** One `embedMany` call per batch of texts (the SDK splits by the model's per-call limit); usage tokens summed. */
export function embedderFromModel(model: EmbeddingModel, modelId: string): Embedder {
  return {
    model: modelId,
    embedTexts: async (texts) => {
      if (texts.length === 0) return { embeddings: [], tokens: 0 };
      const r = await embedMany({ model, values: texts });
      return { embeddings: r.embeddings, tokens: r.usage.tokens };
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
