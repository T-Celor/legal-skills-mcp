import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createFixtureLibrary, type FixtureLibrary } from './fixtures.js';

// Compiled entrypoint: dist/test/stdio.test.js -> dist/index.js
const entry = fileURLToPath(new URL('../index.js', import.meta.url));

describe('stdio entrypoint', () => {
  let fixture: FixtureLibrary;
  let client: Client;

  before(async () => {
    fixture = await createFixtureLibrary();
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) {
        env[key] = value;
      }
    }
    env.LEGAL_SKILLS_DIR = fixture.root;

    client = new Client({ name: 'legal-skills-stdio-test', version: '0.0.0' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [entry], env }));
  });

  after(async () => {
    await client.close();
    await fixture.cleanup();
  });

  it('serves the tools over stdio using LEGAL_SKILLS_DIR', async () => {
    const { tools } = await client.listTools();
    assert.equal(tools.length, 3);

    const result = await client.callTool({
      name: 'search_legal_skills',
      arguments: { query: 'Kündigung', jurisdiction: 'de' },
    });
    const content = (result as { content: Array<{ text?: string }> }).content;
    const payload = JSON.parse(content[0]?.text ?? '{}') as { results: Array<{ id: string }> };
    assert.equal(payload.results[0]?.id, 'de/employment/skills/kuendigung-pruefen');
  });
});
