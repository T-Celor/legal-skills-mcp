import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { loadCatalog } from '../catalog.js';
import { createServer } from '../server.js';
import { embedCatalog, writeVectorIndex } from '../semantic.js';
import { createFixtureLibrary, type FixtureLibrary } from './fixtures.js';
import { hashingEmbedder } from './hashing-embedder.js';

interface TextBlock {
  type: string;
  text?: string;
}

/** Connects a client to a server over an in-memory transport. */
async function connect(server: ReturnType<typeof createServer>): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'hybrid-test', version: '0.0.0' });
  await client.connect(clientTransport);
  return client;
}

async function search(client: Client, arguments_: Record<string, unknown>) {
  const result = await client.callTool({ name: 'search_legal_skills', arguments: arguments_ });
  const block = (result as { content: TextBlock[] }).content[0];
  const isError = (result as { isError?: boolean }).isError === true;
  return {
    isError,
    // Error results carry a plain message, not JSON.
    payload: (isError ? {} : JSON.parse(block?.text ?? '{}')) as {
      mode_used?: string;
      note?: string;
      results?: Array<{ id: string; tags: string[] }>;
    },
  };
}

describe('hybrid search over the protocol', () => {
  let fixture: FixtureLibrary;
  let dataDir: string;
  let withIndex: { server: ReturnType<typeof createServer>; client: Client };
  let withoutIndex: { server: ReturnType<typeof createServer>; client: Client };

  before(async () => {
    fixture = await createFixtureLibrary();
    const catalog = await loadCatalog(fixture.root);
    const embedder = hashingEmbedder();
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'legal-skills-hybrid-'));
    await writeVectorIndex(dataDir, await embedCatalog(catalog, embedder, { batchSize: 4 }));

    const indexed = createServer(fixture.root, { dataDir, embedder });
    withIndex = { server: indexed, client: await connect(indexed) };
    const plain = createServer(fixture.root);
    withoutIndex = { server: plain, client: await connect(plain) };
  });

  after(async () => {
    await withIndex.client.close();
    await withIndex.server.close();
    await withoutIndex.client.close();
    await withoutIndex.server.close();
    await rm(dataDir, { recursive: true, force: true });
    await fixture.cleanup();
  });

  it('uses hybrid search by default and says which mode ran', async () => {
    const { payload } = await search(withIndex.client, { query: 'NDA confidentialité' });
    assert.equal(payload.mode_used, 'hybrid');
    assert.equal(payload.note, undefined);
    assert.equal(payload.results?.[0]?.id, 'fr/contracts/skills/revue-nda');
  });

  it('keyword mode uses the keyword ranking only', async () => {
    const { payload } = await search(withIndex.client, { query: 'Rule 12 complaint', mode: 'keyword' });
    assert.equal(payload.mode_used, 'keyword');
    assert.equal(payload.results?.[0]?.id, 'us/litigation/skills/motion-to-dismiss');
  });

  it('semantic mode ranks by vectors and respects the limit', async () => {
    const { payload } = await search(withIndex.client, { query: 'contrat', mode: 'semantic', limit: 2 });
    assert.equal(payload.mode_used, 'semantic');
    assert.equal(payload.results?.length, 2);
  });

  it('applies filters to semantic results', async () => {
    const { payload } = await search(withIndex.client, { query: 'contrat', mode: 'semantic', tag: 'litigation' });
    assert.ok((payload.results ?? []).every((hit) => hit.tags.includes('litigation')));
  });

  it('falls back to keyword search with a note when the index is missing', async () => {
    const { payload } = await search(withoutIndex.client, { query: 'NDA confidentialité' });
    assert.equal(payload.mode_used, 'keyword');
    assert.match(payload.note ?? '', /build:embeddings/);
  });

  it('reports semantic mode as an error when the index is missing', async () => {
    const { isError } = await search(withoutIndex.client, { query: 'contrat', mode: 'semantic' });
    assert.equal(isError, true);
  });
});
