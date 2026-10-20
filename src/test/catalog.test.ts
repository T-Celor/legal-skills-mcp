import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { facets, loadCatalog, readSkill, type Catalog } from '../catalog.js';
import { createFixtureLibrary, type FixtureLibrary } from './fixtures.js';

describe('loadCatalog', () => {
  let fixture: FixtureLibrary;
  let catalog: Catalog;

  before(async () => {
    fixture = await createFixtureLibrary();
    catalog = await loadCatalog(fixture.root);
  });

  after(async () => {
    await fixture.cleanup();
  });

  it('indexes only SKILL.md files inside a skills folder with valid frontmatter', () => {
    assert.deepEqual([...catalog.skills.keys()].sort(), [
      'de/employment/skills/kuendigung-pruefen',
      'fr/contracts/skills/revue-nda',
      'us/litigation/skills/motion-to-dismiss',
    ]);
    // Only the file without frontmatter is a candidate that gets rejected.
    assert.equal(catalog.skipped, 1);
  });

  it('does not follow links that point outside the library', () => {
    if (!fixture.linked) {
      return;
    }
    assert.equal(
      [...catalog.skills.keys()].some((id) => id.includes('leak')),
      false,
    );
  });

  it('reads frontmatter metadata', () => {
    const meta = catalog.skills.get('fr/contracts/skills/revue-nda')?.meta;
    assert.ok(meta);
    assert.equal(meta.title, 'Revue de NDA');
    assert.equal(meta.jurisdiction, 'fr');
    assert.equal(meta.practice, 'contracts');
    assert.equal(meta.language, 'fr');
    assert.equal(meta.license, 'Apache-2.0');
    assert.equal(meta.version, '0.1.0');
  });

  it('returns a skill body and lists supporting files without SKILL.md', async () => {
    const doc = await readSkill(catalog, 'fr/contracts/skills/revue-nda');
    assert.ok(doc);
    assert.match(doc.content, /# Revue de NDA/);
    assert.equal(doc.truncated, false);
    assert.deepEqual(doc.files, ['scripts/run.py']);
  });

  it('refuses ids that are not indexed, including traversal attempts', async () => {
    assert.equal(await readSkill(catalog, '../../etc/passwd'), null);
    assert.equal(await readSkill(catalog, '..\\..\\secret'), null);
    assert.equal(await readSkill(catalog, 'linked/secret/skills/leak'), null);
  });

  it('counts skills per jurisdiction and per practice area', () => {
    const all = facets(catalog);
    assert.deepEqual(all.jurisdictions, [
      { code: 'de', count: 1 },
      { code: 'fr', count: 1 },
      { code: 'us', count: 1 },
    ]);
    assert.deepEqual(all.practices, []);

    const france = facets(catalog, 'fr');
    assert.deepEqual(france.practices, [{ code: 'contracts', count: 1 }]);
  });
});

describe('loadCatalog on an empty folder', () => {
  it('fails with a clear message', async () => {
    const empty = await mkdtemp(path.join(os.tmpdir(), 'legal-skills-empty-'));
    try {
      await assert.rejects(loadCatalog(empty), /No SKILL\.md files found/);
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });
});
