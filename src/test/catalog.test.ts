import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { facets, loadCatalog, MAX_CONTENT_CHARS, readSkill, type Catalog } from '../catalog.js';
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
      'cn/contracts/skills/baomi-xieyi',
      'de/employment/skills/kuendigung-pruefen',
      'de/general/skills/long-frontmatter',
      'fr/contracts/skills/crlf-bom',
      'fr/contracts/skills/revue-nda',
      'fr/contracts/skills/tag-chars',
      'us/general/skills/huge-skill',
      'us/general/skills/no-jurisdiction',
      'us/litigation/skills/motion-to-dismiss',
    ]);
    // Only the file without frontmatter is rejected. The fr/notes file is not in a skills folder.
    assert.equal(catalog.skipped, 1);
  });

  it('does not follow links that point outside the library', (t) => {
    if (!fixture.linked) {
      t.skip('junctions are not available on this platform');
      return;
    }
    assert.equal([...catalog.skills.keys()].some((id) => id.includes('leak')), false);
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

  it('keeps version strings as written, including CRLF files with a byte order mark', () => {
    const meta = catalog.skills.get('fr/contracts/skills/crlf-bom')?.meta;
    assert.ok(meta);
    assert.equal(meta.name, '007-contrat-type');
    assert.equal(meta.title, 'Modèle de contrat');
    assert.equal(meta.version, '1.10');
  });

  it('indexes frontmatter longer than the first read', () => {
    assert.ok(catalog.skills.has('de/general/skills/long-frontmatter'));
  });

  it('treats an empty jurisdiction as missing', () => {
    assert.equal(catalog.skills.get('us/general/skills/no-jurisdiction')?.meta.jurisdiction, '');
    assert.equal(facets(catalog).jurisdictions.some((facet) => facet.code === ''), false);
  });

  it('returns a skill body and lists supporting files without SKILL.md', async () => {
    const doc = await readSkill(catalog, 'fr/contracts/skills/revue-nda');
    assert.ok(doc);
    assert.match(doc.content, /# Revue de NDA/);
    assert.equal(doc.truncated, false);
    assert.deepEqual(doc.files, ['scripts/run.py']);
  });

  it('truncates very large skills to the limit', async () => {
    const doc = await readSkill(catalog, 'us/general/skills/huge-skill');
    assert.ok(doc);
    assert.equal(doc.truncated, true);
    assert.equal(doc.content.length, MAX_CONTENT_CHARS);
  });

  it('refuses ids that are not indexed, including traversal attempts', async () => {
    assert.equal(await readSkill(catalog, '../../etc/passwd'), null);
    assert.equal(await readSkill(catalog, '..\\..\\secret'), null);
    assert.equal(await readSkill(catalog, 'linked/secret/skills/leak'), null);
  });

  it('counts skills per jurisdiction and per practice area', () => {
    const all = facets(catalog);
    assert.deepEqual(all.jurisdictions, [
      { code: 'fr', count: 3 },
      { code: 'de', count: 2 },
      { code: 'us', count: 2 },
      { code: 'cn', count: 1 },
    ]);
    assert.deepEqual(all.practices, []);
    assert.deepEqual(facets(catalog, 'fr').practices, [{ code: 'contracts', count: 3 }]);
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
