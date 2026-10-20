import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer, DISCLAIMER } from '../server.js';
import { createFixtureLibrary, type FixtureLibrary } from './fixtures.js';

interface TextBlock {
  type: string;
  text?: string;
}

function textBlocks(result: unknown): TextBlock[] {
  return (result as { content: TextBlock[] }).content;
}

function firstJson<T>(result: unknown): T {
  return JSON.parse(textBlocks(result)[0]?.text ?? '{}') as T;
}

describe('MCP server over the protocol', () => {
  let fixture: FixtureLibrary;
  let client: Client;
  let server: ReturnType<typeof createServer>;

  before(async () => {
    fixture = await createFixtureLibrary();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    server = createServer(fixture.root);
    await server.connect(serverTransport);
    client = new Client({ name: 'legal-skills-test', version: '0.0.0' });
    await client.connect(clientTransport);
  });

  after(async () => {
    await client.close();
    await server.close();
    await fixture.cleanup();
  });

  it('exposes the three read-only tools', async () => {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((tool) => tool.name).sort(), [
      'get_legal_skill',
      'list_legal_facets',
      'search_legal_skills',
    ]);
    for (const tool of tools) {
      assert.equal(tool.annotations?.readOnlyHint, true, `${tool.name} must be read-only`);
    }
  });

  it('searches and returns a disclaimer', async () => {
    const result = await client.callTool({
      name: 'search_legal_skills',
      arguments: { query: 'NDA confidentialité' },
    });
    const payload = firstJson<{ disclaimer: string; results: Array<{ id: string }> }>(result);
    assert.equal(payload.disclaimer, DISCLAIMER);
    assert.equal(payload.results[0]?.id, 'fr/contracts/skills/revue-nda');
  });

  it('finds a complaint letter from a French query, and filters by tag', async () => {
    const result = await client.callTool({
      name: 'search_legal_skills',
      arguments: { query: 'réclamation', tag: 'letter' },
    });
    const payload = firstJson<{ results: Array<{ id: string; tags: string[] }> }>(result);
    assert.equal(payload.results[0]?.id, 'general/consumer/skills/complaint-letter');
    assert.ok(payload.results.every((hit) => hit.tags.includes('letter')));
  });

  it('returns the full skill text as a second block', async () => {
    const result = await client.callTool({
      name: 'get_legal_skill',
      arguments: { id: 'fr/contracts/skills/revue-nda' },
    });
    const blocks = textBlocks(result);
    const metadata = JSON.parse(blocks[0]?.text ?? '{}') as { supporting_files: string[] };
    assert.deepEqual(metadata.supporting_files, ['scripts/run.py']);
    assert.match(blocks[1]?.text ?? '', /^<untrusted-skill-content id="[0-9a-f-]+" source="legal-skills-open">/);
    assert.match(blocks[1]?.text ?? '', /# Revue de NDA/);
  });

  it('reports unknown or traversal ids as tool errors', async () => {
    const unknown = await client.callTool({
      name: 'get_legal_skill',
      arguments: { id: 'de/unknown/skills/nope' },
    });
    assert.equal((unknown as { isError?: boolean }).isError, true);

    const traversal = await client.callTool({
      name: 'get_legal_skill',
      arguments: { id: '../../../etc/passwd' },
    });
    assert.equal((traversal as { isError?: boolean }).isError, true);
  });

  it('rejects invalid input before searching', async () => {
    const outcome = await client
      .callTool({ name: 'search_legal_skills', arguments: { query: 'a' } })
      .then(
        (result) => ((result as { isError?: boolean }).isError ? 'error' : 'ok'),
        () => 'error',
      );
    assert.equal(outcome, 'error');
  });

  it('lists practice areas for a jurisdiction', async () => {
    const result = await client.callTool({
      name: 'list_legal_facets',
      arguments: { jurisdiction: 'de' },
    });
    const payload = firstJson<{ practices: Array<{ code: string; count: number }> }>(result);
    assert.deepEqual(payload.practices, [
      { code: 'employment', count: 1 },
      { code: 'general', count: 1 },
    ]);
  });

  it('browses facets step by step, starting from a language', async () => {
    const result = await client.callTool({
      name: 'list_legal_facets',
      arguments: { language: 'fr' },
    });
    const payload = firstJson<{
      total: number;
      jurisdictions: Array<{ code: string; count: number }>;
    }>(result);
    assert.equal(payload.total, 3);
    assert.deepEqual(payload.jurisdictions, [{ code: 'fr', count: 3 }]);
  });

  it('strips invisible tag characters from returned text', async () => {
    const result = await client.callTool({
      name: 'search_legal_skills',
      arguments: { query: 'invisibles' },
    });
    const payload = firstJson<{ results: Array<{ id: string; description: string }> }>(result);
    assert.equal(payload.results[0]?.id, 'fr/contracts/skills/tag-chars');
    assert.equal(payload.results[0]?.description.includes(String.fromCodePoint(0xe0041)), false);
  });
});
