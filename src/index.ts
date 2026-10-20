#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';

// Library location: LEGAL_SKILLS_DIR overrides the git submodule checkout.
const root =
  process.env.LEGAL_SKILLS_DIR ?? fileURLToPath(new URL('../vendor/legal-skills-open', import.meta.url));

// stdout carries the MCP protocol, so all logging goes to stderr.
const server = createServer(root);
await server.connect(new StdioServerTransport());
console.error(`[legal-skills] ready on stdio (library: ${root})`);
