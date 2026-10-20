import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../server.js';
import { skillFile } from './fixtures.js';

interface TextBlock {
  type: string;
  text?: string;
}

interface SearchPayload {
  preset: string | null;
  filters: { jurisdiction: string | null; language: string | null; practice: string | null; tag: string | null };
  hint?: string;
  results: Array<{ id: string }>;
}

async function search(client: Client, arguments_: Record<string, unknown>): Promise<SearchPayload> {
  const result = await client.callTool({ name: 'search_legal_skills', arguments: arguments_ });
  const block = (result as { content: TextBlock[] }).content[0];
  return JSON.parse(block?.text ?? '{}') as SearchPayload;
}

describe('french-general preset', () => {
  let root: string;
  let server: ReturnType<typeof createServer>;
  let client: Client;

  before(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'legal-skills-preset-'));
    const skills: Record<string, string> = {
      'fr/general/skills/piloter-dossier': skillFile(
        {
          name: 'piloter-dossier',
          title: 'Piloter un dossier',
          description: 'Méthode pour suivre un dossier juridique français.',
          jurisdiction: 'fr',
          practice: 'general',
          language: 'fr',
        },
        '# Piloter un dossier\n',
      ),
      'fr/contracts/skills/contrat-travail': skillFile(
        {
          name: 'contrat-travail',
          title: 'Contrat de travail',
          description: 'Rédiger un contrat de travail français.',
          jurisdiction: 'fr',
          practice: 'contracts',
          language: 'fr',
        },
        '# Contrat de travail\n',
      ),
      'general/general/skills/method-en': skillFile(
        {
          name: 'method-en',
          title: 'Legal research method',
          description: 'Step by step method for legal research.',
          jurisdiction: 'general',
          practice: 'general',
          language: 'en',
        },
        '# Legal research method\n',
      ),
      'general/consumer/skills/complaint-letter': skillFile(
        {
          name: 'complaint-letter',
          title: 'Complaint letter',
          description: 'Drafts a complaint letter.',
          jurisdiction: 'general',
          practice: 'general',
          language: 'fr',
        },
        '# Complaint letter\n',
      ),
    };
    for (const [relative, content] of Object.entries(skills)) {
      const file = path.join(root, relative, 'SKILL.md');
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, content, 'utf8');
    }

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    server = createServer(root);
    await server.connect(serverTransport);
    client = new Client({ name: 'preset-test', version: '0.0.0' });
    await client.connect(clientTransport);
  });

  after(async () => {
    await client.close();
    await server.close();
    await rm(root, { recursive: true, force: true });
  });

  it('returns only the skills that match the preset', async () => {
    const payload = await search(client, { query: 'dossier', preset: 'french-general' });
    assert.equal(payload.preset, 'french-general');
    assert.deepEqual(payload.filters, { jurisdiction: 'fr', language: 'fr', practice: 'general', tag: null });
    assert.deepEqual(
      payload.results.map((hit) => hit.id),
      ['fr/general/skills/piloter-dossier'],
    );
  });

  it('excludes skills outside the preset, even when they match the query', async () => {
    const payload = await search(client, { query: 'complaint', preset: 'french-general' });
    assert.equal(payload.results.length, 0);
    assert.match(payload.hint ?? '', /No skill matches/);
  });

  it('lets explicit filters override the values a preset sets', async () => {
    const payload = await search(client, { query: 'contrat', preset: 'french-general', practice: 'contracts' });
    assert.equal(payload.filters.practice, 'contracts');
    assert.deepEqual(
      payload.results.map((hit) => hit.id),
      ['fr/contracts/skills/contrat-travail'],
    );
  });

  it('method preset covers method skills in any language', async () => {
    const french = await search(client, { query: 'méthode', preset: 'method' });
    assert.equal(french.preset, 'method');
    assert.equal(french.filters.practice, 'general');
    assert.equal(french.filters.jurisdiction, null);
    assert.ok(french.results.some((hit) => hit.id === 'fr/general/skills/piloter-dossier'));

    const english = await search(client, { query: 'legal research', preset: 'method' });
    assert.ok(english.results.some((hit) => hit.id === 'general/general/skills/method-en'));
    assert.ok(english.results.every((hit) => hit.id !== 'fr/contracts/skills/contrat-travail'));
  });
});
