import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, before } from 'node:test';
import { loadCatalog, type Catalog } from '../catalog.js';
import { searchCatalog } from '../search.js';

// Runs against the real submodule when it is checked out; skipped otherwise.
const libraryRoot =
  process.env.LEGAL_SKILLS_DIR ?? fileURLToPath(new URL('../../vendor/legal-skills-open', import.meta.url));
const available = existsSync(path.join(libraryRoot, 'README.md'));

describe('real legal-skills-open library', { skip: available ? false : 'submodule not checked out' }, () => {
  let catalog: Catalog;

  before(async () => {
    catalog = await loadCatalog(libraryRoot);
  }, { timeout: 600_000 });

  it('indexes thousands of skills', () => {
    assert.ok(catalog.skills.size > 15_000, `only ${catalog.skills.size} skills indexed`);
  });

  it('finds data-protection skills for a GDPR query', () => {
    const hits = searchCatalog(catalog, 'GDPR data processing agreement', 5);
    assert.ok(hits.length > 0);
  });

  it('finds German skills for a German query', () => {
    const hits = searchCatalog(catalog, 'Kündigung Arbeitsvertrag', 10, { jurisdiction: 'de' });
    assert.ok(hits.length > 0);
  });
});
