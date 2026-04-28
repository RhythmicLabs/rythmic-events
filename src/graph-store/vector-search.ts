/**
 * Pure vector similarity utilities for in-memory RAG search.
 * No external dependencies — all math is done inline.
 */

/**
 * Compute cosine similarity between two embedding vectors.
 * Returns a value in [-1, 1] where 1 = identical direction.
 *
 * Returns 0 when either vector is zero-length or dimensions mismatch.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) {
    return 0;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const ai = a[i]!;
    const bi = b[i]!;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) {
    return 0;
  }

  return dot / denominator;
}

export interface SimilarityResult<T> {
  item: T;
  similarity: number;
}

/**
 * Search a collection for the topK most similar items by cosine similarity.
 *
 * @param items        - Collection to search over
 * @param queryEmbedding - The query vector
 * @param getEmbedding - Accessor that extracts the embedding from an item (return undefined to skip)
 * @param topK         - Maximum results to return
 * @returns Sorted array (highest similarity first) of items with scores
 */
export function searchTopK<T>(
  items: T[],
  queryEmbedding: number[],
  getEmbedding: (item: T) => number[] | undefined,
  topK: number
): SimilarityResult<T>[] {
  if (queryEmbedding.length === 0 || topK <= 0) {
    return [];
  }

  const scored: SimilarityResult<T>[] = [];

  for (const item of items) {
    const embedding = getEmbedding(item);
    if (!embedding || embedding.length === 0) {
      continue;
    }

    const similarity = cosineSimilarity(queryEmbedding, embedding);
    scored.push({ item, similarity });
  }

  // Sort descending by similarity and take topK
  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, topK);
}
