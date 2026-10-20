#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createProcessEmbedder } from './embedder.js';
import { createServer } from './server.js';
import { EMBEDDING_MODEL } from './semantic.js';

// Library location: LEGAL_SKILLS_DIR overrides the git submodule checkout.
const override = process.env.LEGAL_SKILLS_DIR?.trim();
const root = override ? override : fileURLToPath(new URL('../vendor/legal-skills-open', import.meta.url));

// Semantic index location: LEGAL_SKILLS_DATA overrides the default data folder.
const dataOverride = process.env.LEGAL_SKILLS_DATA?.trim();
const dataDir = dataOverride ? dataOverride : fileURLToPath(new URL('../data', import.meta.url));

// The embedding model runs in a helper process, started on the first semantic or hybrid search (see embedder.ts).
// Both this process and the helper run with --max-semi-space-size=1 (see the start script and .mcp.json).
const server = createServer(root, {
  dataDir,
  embedder: createProcessEmbedder(EMBEDDING_MODEL, fileURLToPath(new URL('../.cache/models', import.meta.url)), {
    execArgv: ['--max-semi-space-size=1'],
  }),
});

// stdout carries the MCP protocol, so all logging goes to stderr.
await server.connect(new StdioServerTransport());
console.error(`[legal-skills] ready on stdio (library: ${root})`);
