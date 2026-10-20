import assert from 'node:assert/strict';
import { readFile, stat, writeFile, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { loadCatalog, type Catalog } from '../catalog.js';
import { createFixtureLibrary, type FixtureLibrary } from './fixtures.js';

const REVUE = 'fr/contracts/skills/revue-nda';

describe('catalog cache', () => {
  let fixture: FixtureLibrary;
  let cacheDir: string;
  let cacheFile: string;

  before(async () => {
    fixture = await createFixtureLibrary();
    cacheDir = await mkdtemp(path.join(os.tmpdir(), 'legal-skills-cache-'));
    cacheFile = path.join(cacheDir, 'catalog.json');
  });

  after(async () => {
    await fixture.cleanup();
    await rm(cacheDir, { recursive: true, force: true });
  });

  it('writes the cache on the first load and reuses it on the second', async () => {
    const first = await loadCatalog(fixture.root, { cacheFile });
    assert.ok((await stat(cacheFile)).size > 0);

    const second = await loadCatalog(fixture.root, { cacheFile });
    assert.deepEqual([...second.skills.keys()].sort(), [...first.skills.keys()].sort());
    assert.equal(second.averageLength, first.averageLength);
    assert.equal(second.skipped, first.skipped);
    assert.deepEqual(second.skills.get(REVUE)?.meta, first.skills.get(REVUE)?.meta);
    assert.deepEqual(
      [...(second.skills.get(REVUE)?.weights ?? [])],
      [...(first.skills.get(REVUE)?.weights ?? [])],
    );
  });

  it('rebuilds the index when a skill file changes', async () => {
    const file = path.join(fixture.root, REVUE, 'SKILL.md');
    const original = await readFile(file, 'utf8');
    try {
      await writeFile(file, original.replace('Revue de NDA', 'Revue de NDA modifiée'), 'utf8');
      const changed: Catalog = await loadCatalog(fixture.root, { cacheFile });
      assert.equal(changed.skills.get(REVUE)?.meta.title, 'Revue de NDA modifiée');
    } finally {
      await writeFile(file, original, 'utf8');
    }
  });
});
