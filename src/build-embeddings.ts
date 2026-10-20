#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTransformersEmbedder } from './embedder.js';
import { EMBEDDING_MODEL, embedSkills, writeVectorIndex } from './semantic.js';
import { openOrBuildStore, STORE_FILE } from './store.js';

// Builds the semantic index once: npm run build:embeddings.
// The first run downloads the model (about 118 MB) into .cache/models.
const root =
  process.env.LEGAL_SKILLS_DIR?.trim() || fileURLToPath(new URL('../vendor/legal-skills-open', import.meta.url));
const dataDir = process.env.LEGAL_SKILLS_DATA?.trim() || fileURLToPath(new URL('../data', import.meta.url));
const cacheDir = fileURLToPath(new URL('../.cache/models', import.meta.url));

// The keyword index is built first, and the semantic index covers the same skills.
const store = await openOrBuildStore(root, path.join(dataDir, STORE_FILE));
console.error(`[legal-skills] embedding ${store.size} skills with ${EMBEDDING_MODEL}`);

const embedder = createTransformersEmbedder(EMBEDDING_MODEL, cacheDir);
const started = Date.now();
const index = await embedSkills(store.allSkills(), embedder, {
  batchSize: 32,
  onProgress: (done, total) => {
    if (done % 1024 < 32 || done === total) {
      const seconds = Math.round((Date.now() - started) / 1000);
      console.error(`[legal-skills] ${done}/${total} after ${seconds}s`);
    }
  },
});
store.close();

await writeVectorIndex(dataDir, index);
console.error(`[legal-skills] wrote ${index.ids.length} vectors of ${index.dims} dimensions to ${dataDir}`);
