import { describe, it, expect } from '@jest/globals';
import { cosineSimilarity, searchTopK } from '../vector-search';

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    const v = [1, 2, 3];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 10);
  });

  it('returns -1 for opposite vectors', () => {
    const a = [1, 0, 0];
    const b = [-1, 0, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0, 10);
  });

  it('returns 0 for orthogonal vectors', () => {
    const a = [1, 0];
    const b = [0, 1];
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.0, 10);
  });

  it('returns 0 for empty vectors', () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });

  it('returns 0 for mismatched dimensions', () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
  });

  it('returns 0 for zero vectors', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
  });

  it('computes correct similarity for known vectors', () => {
    const a = [1, 2, 3];
    const b = [4, 5, 6];
    // dot = 32, normA = sqrt(14), normB = sqrt(77)
    const expected = 32 / (Math.sqrt(14) * Math.sqrt(77));
    expect(cosineSimilarity(a, b)).toBeCloseTo(expected, 10);
  });
});

describe('searchTopK', () => {
  const items = [
    { name: 'a', embedding: [1, 0, 0] },
    { name: 'b', embedding: [0, 1, 0] },
    { name: 'c', embedding: [0.9, 0.1, 0] },
    { name: 'no-emb' },
    { name: 'empty-emb', embedding: [] },
  ];

  const getEmbedding = (item) => item.embedding;

  it('returns items sorted by similarity', () => {
    const query = [1, 0, 0]; // Most similar to 'a', then 'c', then 'b'
    const results = searchTopK(items, query, getEmbedding, 3);

    expect(results).toHaveLength(3);
    expect(results[0].item.name).toBe('a');
    expect(results[0].similarity).toBeCloseTo(1.0, 5);
    expect(results[1].item.name).toBe('c');
    expect(results[2].item.name).toBe('b');
  });

  it('respects topK limit', () => {
    const query = [1, 0, 0];
    const results = searchTopK(items, query, getEmbedding, 1);
    expect(results).toHaveLength(1);
    expect(results[0].item.name).toBe('a');
  });

  it('skips items without embeddings', () => {
    const query = [1, 0, 0];
    const results = searchTopK(items, query, getEmbedding, 10);
    // Only 3 items have valid embeddings
    expect(results).toHaveLength(3);
  });

  it('returns empty for empty query embedding', () => {
    const results = searchTopK(items, [], getEmbedding, 5);
    expect(results).toHaveLength(0);
  });

  it('returns empty for topK <= 0', () => {
    const results = searchTopK(items, [1, 0, 0], getEmbedding, 0);
    expect(results).toHaveLength(0);
  });

  it('returns empty for empty items', () => {
    const results = searchTopK([], [1, 0, 0], getEmbedding, 5);
    expect(results).toHaveLength(0);
  });
});
