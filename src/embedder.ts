import type { Embedder } from './semantic.js';

/** The part of a transformers.js feature-extraction pipeline that this project uses. */
type Extractor = (
  texts: string[],
  options: { pooling: 'mean'; normalize: boolean },
) => Promise<{ dims: number[]; data: ArrayLike<number> }>;

/**
 * Embedder backed by a transformers.js model, run locally with ONNX Runtime.
 * The model is downloaded once into `cacheDir`, and loaded on the first call only.
 */
export function createTransformersEmbedder(model: string, cacheDir: string): Embedder {
  let extractor: Promise<Extractor> | undefined;
  const load = (): Promise<Extractor> => {
    extractor ??= import('@huggingface/transformers').then(async ({ env, pipeline }) => {
      env.cacheDir = cacheDir;
      const loaded = await pipeline('feature-extraction', model, { dtype: 'q8' });
      return loaded as unknown as Extractor;
    });
    return extractor;
  };

  return {
    model,
    async embed(texts, kind) {
      if (texts.length === 0) {
        return [];
      }
      const run = await load();
      // E5 models expect a prefix that tells queries from documents.
      const prefix = kind === 'query' ? 'query: ' : 'passage: ';
      const output = await run(
        texts.map((text) => prefix + text),
        { pooling: 'mean', normalize: true },
      );
      const dims = output.dims[output.dims.length - 1] ?? 0;
      const data = output.data as Float32Array;
      return texts.map((_, row) => data.slice(row * dims, (row + 1) * dims));
    },
  };
}
