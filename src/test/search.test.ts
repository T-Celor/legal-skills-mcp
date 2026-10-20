import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { MEMORY, openOrBuildStore, type SkillStore } from '../store.js';
import { createFixtureLibrary, skillFile, type FixtureLibrary } from './fixtures.js';

describe('SkillStore.search on the fixture library', () => {
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

  it('ranks the skill whose title and description match first', () => {
    const hits = store.search('confidentialité NDA', 5);
    assert.equal(hits[0]?.meta.id, 'fr/contracts/skills/revue-nda');
  });

  it('matches German spellings with and without umlauts', () => {
    for (const query of ['Kündigung', 'kundigung', 'Kuendigung']) {
      assert.equal(store.search(query, 5)[0]?.meta.id, 'de/employment/skills/kuendigung-pruefen', query);
    }
  });

  it('matches accented French words without accents', () => {
    assert.equal(store.search('Modele contrat', 5)[0]?.meta.id, 'fr/contracts/skills/crlf-bom');
  });

  it('matches Chinese text, which has no spaces between words', () => {
    assert.equal(store.search('保密协议', 5)[0]?.meta.id, 'cn/contracts/skills/baomi-xieyi');
  });

  it('finds an English complaint letter from French and German terms', () => {
    assert.equal(store.search('réclamation consommateur', 5)[0]?.meta.id, 'general/consumer/skills/complaint-letter');
    assert.equal(store.search('Beschwerde Verbraucher', 5)[0]?.meta.id, 'general/consumer/skills/complaint-letter');
  });

  it('finds skills by words that only appear in the body', () => {
    assert.equal(store.search('Rule 12 complaint', 5)[0]?.meta.id, 'us/litigation/skills/motion-to-dismiss');
  });

  it('filters by jurisdiction before ranking', () => {
    assert.deepEqual(store.search('Kündigung', 5, { jurisdiction: 'fr' }), []);
    assert.equal(store.search('Kündigung', 5, { jurisdiction: 'de' }).length, 1);
  });

  it('filters by tag', () => {
    assert.deepEqual(
      store.search('confidentialité', 5, { tag: 'drafting' }).map((hit) => hit.meta.id),
      ['fr/contracts/skills/revue-nda'],
    );
    assert.deepEqual(store.search('confidentialité', 5, { tag: 'litigation' }), []);
  });

  it('respects the result limit', () => {
    assert.equal(store.search('Kündigung Revue dismiss', 2).length, 2);
  });

  it('returns nothing for queries without searchable words', () => {
    assert.deepEqual(store.search('!! ?? -', 5), []);
    assert.deepEqual(store.search('zzzqqqxxx', 5), []);
  });
});

describe('SkillStore.search ranking', () => {
  let root: string;
  let store: SkillStore;

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
    store = await openOrBuildStore(root, MEMORY);
  });

  after(async () => {
    store.close();
    await rm(root, { recursive: true, force: true });
  });

  it('ranks title and description matches above body-only matches', () => {
    const ids = store.search('dommage', 10).map((hit) => hit.meta.id);
    assert.equal(ids[0], 'fr/contracts/skills/dommage-titre');
    assert.equal(ids.at(-1), 'fr/contracts/skills/dommage-corps');
  });

  it('ranks a skill matching every query term above one matching only some', () => {
    const ids = store.search('contrat dommage', 10).map((hit) => hit.meta.id);
    assert.equal(ids[0], 'fr/contracts/skills/dommage-contrat');
  });
});
