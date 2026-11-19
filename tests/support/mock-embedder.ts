// Test-only deterministic embedder (T008 8a): fixed vectors from a SHA-256 of the text. Never used by the server.
import { createHash } from "node:crypto";
import { EMBEDDING_DIMENSIONS, type Embedder } from "../../src/server/embedder.ts";

/** The same text always gives the same vector (values in -0.5..0.5); tokens = ceil(chars / 4) per text. */
export function mockVector(text: string, dims = EMBEDDING_DIMENSIONS): number[] {
  const bytes = createHash("sha256").update(text).digest();
  return Array.from({ length: dims }, (_, i) => (bytes[i % bytes.length] ?? 0) / 255 - 0.5);
}

export function mockEmbedder(dims = EMBEDDING_DIMENSIONS): Embedder & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    model: "mock-embedding",
    calls,
    embedTexts: async (texts) => {
      calls.push(texts);
      return {
        embeddings: texts.map((t) => mockVector(t, dims)),
        tokens: texts.reduce((n, t) => n + Math.ceil(t.length / 4), 0),
      };
    },
  };
}
