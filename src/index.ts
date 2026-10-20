#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createTransformersEmbedder } from './embedder.js';
import { createServer } from './server.js';
import { EMBEDDING_MODEL } from './semantic.js';

// Library location: LEGAL_SKILLS_DIR overrides the git submodule checkout.
const override = process.env.LEGAL_SKILLS_DIR?.trim();
const root = override ? override : fileURLToPath(new URL('../vendor/legal-skills-open', import.meta.url));

// Semantic index location: LEGAL_SKILLS_DATA overrides the default data folder.
const dataOverride = process.env.LEGAL_SKILLS_DATA?.trim();
const dataDir = dataOverride ? dataOverride : fileURLToPath(new URL('../data', import.meta.url));

// The embedding model is loaded only on the first semantic or hybrid search.
const server = createServer(root, {
  dataDir,
  embedder: createTransformersEmbedder(EMBEDDING_MODEL, fileURLToPath(new URL('../.cache/models', import.meta.url))),
});

// stdout carries the MCP protocol, so all logging goes to stderr.
await server.connect(new StdioServerTransport());
console.error(`[legal-skills] ready on stdio (library: ${root})`);
