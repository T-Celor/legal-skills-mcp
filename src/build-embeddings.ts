#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCatalog } from './catalog.js';
import { createTransformersEmbedder } from './embedder.js';
import { EMBEDDING_MODEL, embedCatalog, writeVectorIndex } from './semantic.js';

// Builds the semantic index once: npm run build:embeddings.
// The first run downloads the model (about 118 MB) into .cache/models.
const root =
  process.env.LEGAL_SKILLS_DIR?.trim() || fileURLToPath(new URL('../vendor/legal-skills-open', import.meta.url));
const dataDir = process.env.LEGAL_SKILLS_DATA?.trim() || fileURLToPath(new URL('../data', import.meta.url));
const cacheDir = fileURLToPath(new URL('../.cache/models', import.meta.url));

// Loading the catalog here also writes the keyword cache that the server reuses.
const catalog = await loadCatalog(root, { cacheFile: path.join(dataDir, 'catalog.json') });
console.error(`[legal-skills] embedding ${catalog.skills.size} skills with ${EMBEDDING_MODEL}`);

const embedder = createTransformersEmbedder(EMBEDDING_MODEL, cacheDir);
const started = Date.now();
const index = await embedCatalog(catalog, embedder, {
  batchSize: 32,
  onProgress: (done, total) => {
    if (done % 1024 < 32 || done === total) {
      const seconds = Math.round((Date.now() - started) / 1000);
      console.error(`[legal-skills] ${done}/${total} after ${seconds}s`);
    }
  },
});

await writeVectorIndex(dataDir, index);
console.error(`[legal-skills] wrote ${index.ids.length} vectors of ${index.dims} dimensions to ${dataDir}`);
