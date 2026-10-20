import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { before, describe, it } from 'node:test';
import { MEMORY, openOrBuildStore, type SkillStore } from '../store.js';

// Runs against the real submodule when it is checked out; skipped otherwise.
const libraryRoot =
  process.env.LEGAL_SKILLS_DIR ?? fileURLToPath(new URL('../../vendor/legal-skills-open', import.meta.url));
const available = existsSync(path.join(libraryRoot, 'README.md'));

describe('real legal-skills-open library', { skip: available ? false : 'submodule not checked out' }, () => {
  let store: SkillStore;

  before(async () => {
    store = await openOrBuildStore(libraryRoot, MEMORY);
  }, { timeout: 600_000 });

  it('indexes thousands of skills', () => {
    assert.ok(store.size > 15_000, `only ${store.size} skills indexed`);
  });

  it('finds data-protection skills for a GDPR query', () => {
    assert.ok(store.search('GDPR data processing agreement', 5).length > 0);
  });

  it('finds German skills for a German query', () => {
    assert.ok(store.search('Kündigung Arbeitsvertrag', 10, { jurisdiction: 'de' }).length > 0);
  });
});
