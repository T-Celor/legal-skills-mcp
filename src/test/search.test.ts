import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { loadCatalog, type Catalog } from '../catalog.js';
import { searchCatalog } from '../search.js';
import { createFixtureLibrary, skillFile, type FixtureLibrary } from './fixtures.js';

describe('searchCatalog on the fixture library', () => {
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

  it('matches German spellings with and without umlauts', () => {
    for (const query of ['Kündigung', 'kundigung', 'Kuendigung']) {
      assert.equal(
        searchCatalog(catalog, query, 5)[0]?.meta.id,
        'de/employment/skills/kuendigung-pruefen',
        query,
      );
    }
  });

  it('matches accented French words without accents', () => {
    assert.equal(searchCatalog(catalog, 'Modele contrat', 5)[0]?.meta.id, 'fr/contracts/skills/crlf-bom');
  });

  it('matches Chinese text, which has no spaces between words', () => {
    assert.equal(searchCatalog(catalog, '保密协议', 5)[0]?.meta.id, 'cn/contracts/skills/baomi-xieyi');
  });

  it('finds an English complaint letter from French and German terms', () => {
    const french = searchCatalog(catalog, 'réclamation consommateur', 5);
    assert.equal(french[0]?.meta.id, 'general/consumer/skills/complaint-letter');
    const german = searchCatalog(catalog, 'Beschwerde Verbraucher', 5);
    assert.equal(german[0]?.meta.id, 'general/consumer/skills/complaint-letter');
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

  it('filters by tag', () => {
    const drafting = searchCatalog(catalog, 'confidentialité', 5, { tag: 'drafting' });
    assert.deepEqual(
      drafting.map((hit) => hit.meta.id),
      ['fr/contracts/skills/revue-nda'],
    );
    assert.deepEqual(searchCatalog(catalog, 'confidentialité', 5, { tag: 'litigation' }), []);
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

describe('searchCatalog ranking', () => {
  let root: string;
  let catalog: Catalog;

  before(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'legal-skills-rank-'));
    const files: Record<string, string> = {
      'fr/contracts/skills/dommage-titre': skillFile(
        { name: 'dommage-titre', title: 'Dommage et intérêts', description: 'Calcule le dommage', jurisdiction: 'fr', practice: 'contracts', language: 'fr' },
        '# Dommage\n',
      ),
      'fr/contracts/skills/dommage-contrat': skillFile(
        { name: 'dommage-contrat', title: 'Contrat et dommage', description: 'Clause', jurisdiction: 'fr', practice: 'contracts', language: 'fr' },
        '# Clause\n',
      ),
      'fr/contracts/skills/dommage-corps': skillFile(
        { name: 'dommage-corps', title: 'Autre sujet', description: 'Sujet varié', jurisdiction: 'fr', practice: 'contracts', language: 'fr' },
        'Le dommage est évoqué une fois.\n',
      ),
    };
    for (const [relative, content] of Object.entries(files)) {
      const file = path.join(root, relative, 'SKILL.md');
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, content, 'utf8');
    }
    catalog = await loadCatalog(root);
  });

  after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('ranks title and description matches above body-only matches', () => {
    const ids = searchCatalog(catalog, 'dommage', 10).map((hit) => hit.meta.id);
    assert.equal(ids[0], 'fr/contracts/skills/dommage-titre');
    assert.equal(ids.at(-1), 'fr/contracts/skills/dommage-corps');
  });

  it('ranks a skill matching every query term above one matching only some', () => {
    const ids = searchCatalog(catalog, 'contrat dommage', 10).map((hit) => hit.meta.id);
    assert.equal(ids[0], 'fr/contracts/skills/dommage-contrat');
  });
});
