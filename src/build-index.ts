#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openOrBuildStore, STORE_FILE } from './store.js';

// Builds the keyword index only: npm run build:index.
const root =
  process.env.LEGAL_SKILLS_DIR?.trim() || fileURLToPath(new URL('../vendor/legal-skills-open', import.meta.url));
const dataDir = process.env.LEGAL_SKILLS_DATA?.trim() || fileURLToPath(new URL('../data', import.meta.url));

const started = Date.now();
const store = await openOrBuildStore(root, path.join(dataDir, STORE_FILE));
const seconds = Math.round((Date.now() - started) / 1000);
console.error(`[legal-skills] index ready: ${store.size} skills, ${store.skipped} skipped, ${seconds} s`);
store.close();
