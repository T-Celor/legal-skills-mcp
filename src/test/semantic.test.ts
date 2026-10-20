import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import {
  interleaveRankings,
  readVectorIndex,
  topBySimilarity,
  writeVectorIndex,
  type VectorIndex,
} from '../semantic.js';

describe('interleaveRankings', () => {
  it('alternates the best item of each ranking, without repeats', () => {
    assert.deepEqual(interleaveRankings([['a', 'b', 'c'], ['c', 'a', 'd']], 4), ['a', 'c', 'b', 'd']);
  });

  it('keeps the best item of a ranking even when the other ranking is strong', () => {
    const merged = interleaveRankings([['only-keyword'], ['x', 'y', 'z']], 2);
    assert.deepEqual(merged, ['only-keyword', 'x']);
  });

  it('respects the limit', () => {
    assert.deepEqual(interleaveRankings([['a', 'b', 'c']], 2), ['a', 'b']);
  });
});

describe('topBySimilarity', () => {
  const index: VectorIndex = {
    model: 'test/model',
    dims: 2,
    ids: ['east', 'north', 'north-east'],
    vectors: new Float32Array([1, 0, 0, 1, Math.SQRT1_2, Math.SQRT1_2]),
  };

  it('orders skills by cosine similarity to the query', () => {
    const ranked = topBySimilarity(index, new Float32Array([1, 0]), 3, () => true);
    assert.deepEqual(
      ranked.map((hit) => hit.id),
      ['east', 'north-east', 'north'],
    );
  });

  it('skips skills that the filter rejects', () => {
    const ranked = topBySimilarity(index, new Float32Array([1, 0]), 3, (id) => id !== 'east');
    assert.deepEqual(
      ranked.map((hit) => hit.id),
      ['north-east', 'north'],
    );
  });
});

describe('vector index files', () => {
  const index: VectorIndex = {
    model: 'test/model',
    dims: 2,
    ids: ['b', 'a'],
    vectors: new Float32Array([0.5, 0.25, -1, 0]),
  };
  let dir: string;

  before(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'legal-skills-vectors-'));
  });

  after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('reads back what was written, when the model and the skills match', async () => {
    await writeVectorIndex(dir, index);
    const loaded = await readVectorIndex(dir, { model: 'test/model', ids: ['a', 'b'] });
    assert.ok(loaded);
    assert.deepEqual(loaded.ids, ['b', 'a']);
    assert.deepEqual([...loaded.vectors], [0.5, 0.25, -1, 0]);
  });

  it('refuses an index built with another model', async () => {
    assert.equal(await readVectorIndex(dir, { model: 'other/model', ids: ['a', 'b'] }), null);
  });

  it('refuses an index that does not list the current skills', async () => {
    assert.equal(await readVectorIndex(dir, { model: 'test/model', ids: ['a', 'c'] }), null);
  });

  it('refuses a vector file whose size does not match the header', async () => {
    await writeVectorIndex(dir, index);
    await writeFile(path.join(dir, 'embeddings.f32'), new Uint8Array(4));
    assert.equal(await readVectorIndex(dir, { model: 'test/model', ids: ['a', 'b'] }), null);
  });

  it('returns null when no index exists', async () => {
    const empty = await mkdtemp(path.join(os.tmpdir(), 'legal-skills-empty-vectors-'));
    try {
      assert.equal(await readVectorIndex(empty, { model: 'test/model', ids: ['a', 'b'] }), null);
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });
});
