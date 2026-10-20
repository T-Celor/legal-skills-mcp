import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { after, describe, it } from 'node:test';
import { createProcessEmbedder } from '../embedder.js';
import { hashingEmbedder } from './hashing-embedder.js';

// Compiled fake helper: dist/test/fake-embed-worker.js
const script = fileURLToPath(new URL('./fake-embed-worker.js', import.meta.url));

describe('process embedder', () => {
  // A short idle timeout, so that the helper exits between the tests.
  const embedder = createProcessEmbedder('test-model', 'unused-cache', { script, idleMs: 200 });
  after(() => embedder.close?.());

  it('returns the vectors computed by the helper', async () => {
    const texts = ['contrat de travail', 'réclamation consommateur'];
    const expected = await hashingEmbedder().embed(texts, 'query');
    const actual = await embedder.embed(texts, 'query');
    assert.deepEqual(
      actual.map((vector) => Array.from(vector)),
      expected.map((vector) => Array.from(vector)),
    );
  });

  it('starts a new helper after the idle timeout', async () => {
    await new Promise((resolve) => setTimeout(resolve, 600));
    const [vector] = await embedder.embed(['contrat'], 'passage');
    assert.equal(vector?.length, 64);
  });

  it('returns an empty list for no texts', async () => {
    assert.deepEqual(await embedder.embed([], 'query'), []);
  });
});
