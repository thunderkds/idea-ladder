// T008 (8c) AC 5: near-duplicate removal by embedding similarity, within one ladder.

/** Cosine similarity; 0 when either vector has no length. */
export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

/** In order: vector i is kept unless its cosine similarity to an EARLIER kept vector is >= `threshold`. */
export function keepDistinct(vectors: number[][], threshold: number): boolean[] {
  const kept: number[][] = [];
  return vectors.map((v) => {
    if (kept.some((k) => cosine(k, v) >= threshold)) return false;
    kept.push(v);
    return true;
  });
}
