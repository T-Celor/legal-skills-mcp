import type { Embedder } from '../semantic.js';
import { tokenize } from '../text.js';

/**
 * Deterministic stand-in for the model, for tests: each word is hashed into one of
 * a fixed number of buckets, and the vector is normalised. It does not understand
 * meaning, so tests check the mechanics of hybrid search, not its quality.
 */
export function hashingEmbedder(dims = 64): Embedder {
  return {
    model: 'test/hashing',
    async embed(texts) {
      return texts.map((text) => {
        const vector = new Float32Array(dims);
        for (const token of tokenize(text)) {
          let hash = 0;
          for (const character of token) {
            hash = (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0;
          }
          vector[hash % dims] = (vector[hash % dims] ?? 0) + 1;
        }
        const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
        return vector.map((value) => value / norm);
      });
    },
  };
}
