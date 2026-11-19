// T008 (8a): splits grounding sources (README, docs/**/*.md, dependency files, core files) at the pinned SHA into
// ~1,500-character chunks with 200 characters of overlap (ADR 0006). Rows keep the raw text.

export const CHUNK_SIZE = 1_500;
export const CHUNK_OVERLAP = 200;

export type ChunkSource = "readme" | "docs" | "dep" | "core";
export type SourceFile = { source: ChunkSource; path: string; text: string };
export type Chunk = {
  source: ChunkSource;
  path: string;
  /** Position of the chunk within its file, from 0. */
  ordinal: number;
  startLine: number;
  endLine: number;
  sha: string;
  text: string;
};
export type TextPiece = { startLine: number; endLine: number; text: string };

/**
 * Windows of at most `size` characters; each next window starts `overlap` characters before the previous end.
 * A window that would cut a line ends after its last newline when that keeps it over half full.
 */
export function chunkText(text: string, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP): TextPiece[] {
  const lineAt = (offset: number) => {
    let n = 1;
    for (let i = 0; i < offset; i++) if (text.charCodeAt(i) === 10) n++;
    return n;
  };
  const pieces: TextPiece[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + size, text.length);
    if (end < text.length) {
      const nl = text.lastIndexOf("\n", end - 1);
      if (nl >= start + size / 2) end = nl + 1;
    }
    const piece = text.slice(start, end);
    if (piece.trim() !== "") pieces.push({ startLine: lineAt(start), endLine: lineAt(end - 1), text: piece });
    if (end >= text.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return pieces;
}

/** Chunks every file (empty files give none); `sha` is the pinned commit SHA. */
export function chunkFiles(sha: string, files: SourceFile[]): Chunk[] {
  return files.flatMap((f) =>
    chunkText(f.text).map((p, ordinal) => ({ source: f.source, path: f.path, ordinal, sha, ...p })),
  );
}
