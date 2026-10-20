import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { MAX_CONTENT_CHARS } from '../catalog.js';
import { MEMORY, openOrBuildStore, type SkillStore } from '../store.js';
import { createFixtureLibrary, type FixtureLibrary } from './fixtures.js';

describe('skill store', () => {
  let fixture: FixtureLibrary;
  let store: SkillStore;

  before(async () => {
    fixture = await createFixtureLibrary();
    store = await openOrBuildStore(fixture.root, MEMORY);
  });

  after(async () => {
    store.close();
    await fixture.cleanup();
  });

  it('indexes only SKILL.md files inside a skills folder with valid frontmatter', () => {
    assert.deepEqual(store.idList().sort(), [
      'cn/contracts/skills/baomi-xieyi',
      'de/employment/skills/kuendigung-pruefen',
      'de/general/skills/long-frontmatter',
      'fr/contracts/skills/crlf-bom',
      'fr/contracts/skills/revue-nda',
      'fr/contracts/skills/tag-chars',
      'general/consumer/skills/complaint-letter',
      'us/general/skills/huge-skill',
      'us/general/skills/no-jurisdiction',
      'us/litigation/skills/motion-to-dismiss',
    ]);
    // Only the file without frontmatter is rejected. The fr/notes file is not in a skills folder.
    assert.equal(store.skipped, 1);
  });

  it('does not follow links that point outside the library', (t) => {
    if (!fixture.linked) {
      t.skip('junctions are not available on this platform');
      return;
    }
    assert.equal(store.idList().some((id) => id.includes('leak')), false);
  });

  it('reads frontmatter metadata, including tags', () => {
    const meta = store.get('fr/contracts/skills/revue-nda');
    assert.ok(meta);
    assert.equal(meta.title, 'Revue de NDA');
    assert.equal(meta.jurisdiction, 'fr');
    assert.equal(meta.practice, 'contracts');
    assert.equal(meta.language, 'fr');
    assert.equal(meta.license, 'Apache-2.0');
    assert.equal(meta.version, '0.1.0');
    assert.deepEqual(meta.tags, ['drafting', 'nda']);
  });

  it('keeps version strings as written, including CRLF files with a byte order mark', () => {
    const meta = store.get('fr/contracts/skills/crlf-bom');
    assert.ok(meta);
    assert.equal(meta.name, '007-contrat-type');
    assert.equal(meta.title, 'Modèle de contrat');
    assert.equal(meta.version, '1.10');
  });

  it('indexes frontmatter longer than the first read', () => {
    assert.ok(store.get('de/general/skills/long-frontmatter'));
  });

  it('treats an empty jurisdiction as missing', () => {
    assert.equal(store.get('us/general/skills/no-jurisdiction')?.jurisdiction, '');
    assert.equal(store.facets().jurisdictions.some((facet) => facet.code === ''), false);
  });

  it('returns a skill body and lists supporting files without SKILL.md', async () => {
    const doc = await store.readSkill('fr/contracts/skills/revue-nda');
    assert.ok(doc);
    assert.match(doc.content, /# Revue de NDA/);
    assert.equal(doc.truncated, false);
    assert.deepEqual(doc.files, ['scripts/run.py']);
  });

  it('truncates very large skills to the limit', async () => {
    const doc = await store.readSkill('us/general/skills/huge-skill');
    assert.ok(doc);
    assert.equal(doc.truncated, true);
    assert.equal(doc.content.length, MAX_CONTENT_CHARS);
  });

  it('refuses ids that are not indexed, including traversal attempts', async () => {
    assert.equal(await store.readSkill('../../etc/passwd'), null);
    assert.equal(await store.readSkill('..\\..\\secret'), null);
    assert.equal(await store.readSkill('linked/secret/skills/leak'), null);
  });

  it('counts skills per facet, and narrows the counts when filters are given', () => {
    const all = store.facets();
    assert.equal(all.total, 10);
    assert.deepEqual(all.jurisdictions, [
      { code: 'fr', count: 3 },
      { code: 'de', count: 2 },
      { code: 'us', count: 2 },
      { code: 'cn', count: 1 },
      { code: 'general', count: 1 },
    ]);
    assert.deepEqual(
      all.languages.map((facet) => [facet.code, facet.count]),
      [
        ['en', 4],
        ['fr', 3],
        ['de', 2],
        ['zh', 1],
      ],
    );
    assert.equal(all.languages.find((facet) => facet.code === 'fr')?.label, 'Français');
    assert.deepEqual(
      all.practices.map((facet) => [facet.code, facet.count]),
      [
        ['contracts', 4],
        ['general', 3],
        ['consumer', 1],
        ['employment', 1],
        ['litigation', 1],
      ],
    );
    assert.deepEqual(all.tags.slice(0, 2), [
      { code: 'drafting', count: 2 },
      { code: 'letter', count: 1 },
    ]);

    const french = store.facets({ language: 'fr' });
    assert.equal(french.total, 3);
    assert.deepEqual(french.jurisdictions, [{ code: 'fr', count: 3 }]);
    assert.deepEqual(french.practices, [{ code: 'contracts', count: 3 }]);
    assert.deepEqual(french.tags, [
      { code: 'drafting', count: 1 },
      { code: 'nda', count: 1 },
    ]);
  });
});

describe('skill store on an empty folder', () => {
  it('fails with a clear message', async () => {
    const empty = await mkdtemp(path.join(os.tmpdir(), 'legal-skills-empty-'));
    try {
      await assert.rejects(openOrBuildStore(empty, MEMORY), /No SKILL\.md files found/);
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });
});
