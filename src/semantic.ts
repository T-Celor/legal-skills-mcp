import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Catalog, SkillMeta } from './catalog.js';

/** Multilingual sentence-embedding model (MIT licence), loaded in 8-bit quantised form. */
export const EMBEDDING_MODEL = 'Xenova/multilingual-e5-small';

/** Characters of each skill sent to the model: title, description and tags. */
const MAX_PASSAGE_CHARS = 600;
/** Candidates taken from each ranking before fusion. */
export const CANDIDATES = 100;

const INDEX_FILE = 'embeddings.json';
const VECTOR_FILE = 'embeddings.f32';

/** Turns texts into unit-length vectors. Queries and passages may be embedded differently. */
export interface Embedder {
  readonly model: string;
  embed(texts: string[], kind: 'query' | 'passage'): Promise<Float32Array[]>;
}

/** One vector per skill, stored row by row in the order of `ids`. */
export interface VectorIndex {
  model: string;
  dims: number;
  ids: string[];
  vectors: Float32Array;
}

export interface Scored {
  id: string;
  score: number;
}

interface IndexHeader {
  model: string;
  dims: number;
  count: number;
  idsSha256: string;
  ids: string[];
}

/** The text that represents one skill in the vector index. */
export function skillPassage(meta: SkillMeta): string {
  const tags = meta.tags.length > 0 ? ` Tags: ${meta.tags.join(', ')}.` : '';
  return `${meta.title}. ${meta.description}${tags}`.slice(0, MAX_PASSAGE_CHARS);
}

/** Embeds every skill of the catalog, in batches. */
export async function embedCatalog(
  catalog: Catalog,
  embedder: Embedder,
  options: { batchSize: number; onProgress?: (done: number, total: number) => void },
): Promise<VectorIndex> {
  const ids = [...catalog.skills.keys()].sort(compareIds);
  let dims = 0;
  let vectors = new Float32Array(0);

  for (let start = 0; start < ids.length; start += options.batchSize) {
    const batch = ids.slice(start, start + options.batchSize);
    const texts = batch.map((id) => {
      const skill = catalog.skills.get(id);
      if (!skill) {
        throw new Error(`Skill vanished during embedding: ${id}`);
      }
      return skillPassage(skill.meta);
    });
    const embedded = await embedder.embed(texts, 'passage');
    if (dims === 0) {
      dims = embedded[0]?.length ?? 0;
      vectors = new Float32Array(ids.length * dims);
    }
    embedded.forEach((vector, offset) => {
      if (vector.length !== dims) {
        throw new Error(`Embedding size changed: expected ${dims}, got ${vector.length}`);
      }
      vectors.set(vector, (start + offset) * dims);
    });
    options.onProgress?.(Math.min(start + batch.length, ids.length), ids.length);
  }

  return { model: embedder.model, dims, ids, vectors };
}

/** The `count` skills most similar to the query, among those `allowed` accepts. */
export function topBySimilarity(
  index: VectorIndex,
  query: Float32Array,
  limit: number,
  allowed: (id: string) => boolean,
): Scored[] {
  const { dims, ids, vectors } = index;
  const scored: Scored[] = [];
  for (let row = 0; row < ids.length; row++) {
    const id = ids[row];
    if (id === undefined || !allowed(id)) {
      continue;
    }
    const offset = row * dims;
    let score = 0;
    for (let d = 0; d < dims; d++) {
      score += (query[d] ?? 0) * (vectors[offset + d] ?? 0);
    }
    scored.push({ id, score });
  }
  scored.sort((a, b) => b.score - a.score || compareIds(a.id, b.id));
  return scored.slice(0, limit);
}

/**
 * Alternates between rankings: the best item of each, then the second best of each,
 * and so on, without repeats. Each method keeps its best match in view. Reciprocal
 * rank fusion would push down an item that only one method found, even when it is
 * that method's clear winner.
 */
export function interleaveRankings(rankings: string[][], limit: number): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();
  const depth = Math.max(0, ...rankings.map((ranking) => ranking.length));
  for (let rank = 0; rank < depth && merged.length < limit; rank++) {
    for (const ranking of rankings) {
      const id = ranking[rank];
      if (id !== undefined && !seen.has(id) && merged.length < limit) {
        seen.add(id);
        merged.push(id);
      }
    }
  }
  return merged;
}

export async function writeVectorIndex(dir: string, index: VectorIndex): Promise<void> {
  await mkdir(dir, { recursive: true });
  const header: IndexHeader = {
    model: index.model,
    dims: index.dims,
    count: index.ids.length,
    idsSha256: idsFingerprint(index.ids),
    ids: index.ids,
  };
  await writeFile(path.join(dir, INDEX_FILE), JSON.stringify(header), 'utf8');
  await writeFile(
    path.join(dir, VECTOR_FILE),
    new Uint8Array(index.vectors.buffer, index.vectors.byteOffset, index.vectors.byteLength),
  );
}

/**
 * Reads the vector index from `dir`. Returns null when it is missing, was built with
 * another model, or does not list exactly the skills of the current library.
 */
export async function readVectorIndex(
  dir: string,
  expected: { model: string; ids: string[] },
): Promise<VectorIndex | null> {
  let header: IndexHeader;
  let bytes: Buffer;
  try {
    header = JSON.parse(await readFile(path.join(dir, INDEX_FILE), 'utf8')) as IndexHeader;
    bytes = await readFile(path.join(dir, VECTOR_FILE));
  } catch {
    return null;
  }

  if (header.model !== expected.model || !Array.isArray(header.ids) || !header.ids.every((id) => typeof id === 'string')) {
    return null;
  }
  if (header.count !== header.ids.length || !(header.dims > 0)) {
    return null;
  }
  if (idsFingerprint(header.ids) !== header.idsSha256 || idsFingerprint(expected.ids) !== header.idsSha256) {
    return null;
  }
  if (bytes.byteLength !== header.ids.length * header.dims * Float32Array.BYTES_PER_ELEMENT) {
    return null;
  }

  // Copy into a fresh, aligned buffer before viewing it as floats.
  const aligned = new Uint8Array(bytes);
  return {
    model: header.model,
    dims: header.dims,
    ids: header.ids,
    vectors: new Float32Array(aligned.buffer),
  };
}

/** Fingerprint of a set of skill ids, independent of their order. */
export function idsFingerprint(ids: string[]): string {
  return createHash('sha256').update([...ids].sort(compareIds).join('\n')).digest('hex');
}

function compareIds(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}
