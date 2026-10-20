import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { loadCatalog, type Catalog } from '../catalog.js';
import { searchCatalog } from '../search.js';
import { createFixtureLibrary, type FixtureLibrary } from './fixtures.js';

describe('searchCatalog', () => {
  let fixture: FixtureLibrary;
  let catalog: Catalog;

  before(async () => {
    fixture = await createFixtureLibrary();
    catalog = await loadCatalog(fixture.root);
  });

  after(async () => {
    await fixture.cleanup();
  });

  it('ranks the skill whose title and description match first', () => {
    const hits = searchCatalog(catalog, 'confidentialité NDA', 5);
    assert.equal(hits[0]?.meta.id, 'fr/contracts/skills/revue-nda');
  });

  it('folds diacritics so both spellings match', () => {
    const withUmlaut = searchCatalog(catalog, 'Kündigung', 5);
    const withoutUmlaut = searchCatalog(catalog, 'kundigung', 5);
    assert.equal(withUmlaut[0]?.meta.id, 'de/employment/skills/kuendigung-pruefen');
    assert.equal(withoutUmlaut[0]?.meta.id, 'de/employment/skills/kuendigung-pruefen');
  });

  it('finds skills by words that only appear in the body', () => {
    const hits = searchCatalog(catalog, 'Rule 12 complaint', 5);
    assert.equal(hits[0]?.meta.id, 'us/litigation/skills/motion-to-dismiss');
  });

  it('filters by jurisdiction before ranking', () => {
    assert.deepEqual(searchCatalog(catalog, 'Kündigung', 5, { jurisdiction: 'fr' }), []);
    const german = searchCatalog(catalog, 'Kündigung', 5, { jurisdiction: 'de' });
    assert.equal(german.length, 1);
  });

  it('respects the result limit', () => {
    const hits = searchCatalog(catalog, 'Kündigung Revue dismiss', 2);
    assert.equal(hits.length, 2);
  });

  it('returns nothing for queries without searchable words', () => {
    assert.deepEqual(searchCatalog(catalog, '!! ?? -', 5), []);
    assert.deepEqual(searchCatalog(catalog, 'zzzqqqxxx', 5), []);
  });
});
