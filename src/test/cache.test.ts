import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { openOrBuildStore, STORE_FILE } from '../store.js';
import { createFixtureLibrary, type FixtureLibrary } from './fixtures.js';

const REVUE = 'fr/contracts/skills/revue-nda';

describe('stored index', () => {
  let fixture: FixtureLibrary;
  let dataDir: string;
  let storeFile: string;

  before(async () => {
    fixture = await createFixtureLibrary();
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'legal-skills-store-'));
    storeFile = path.join(dataDir, STORE_FILE);
  });

  after(async () => {
    await fixture.cleanup();
    await rm(dataDir, { recursive: true, force: true });
  });

  it('writes the index file and reuses it while no skill file changes', async () => {
    const first = await openOrBuildStore(fixture.root, storeFile);
    first.close();
    const written = (await stat(storeFile)).mtimeMs;

    const second = await openOrBuildStore(fixture.root, storeFile);
    assert.equal(second.get(REVUE)?.title, 'Revue de NDA');
    second.close();
    assert.equal((await stat(storeFile)).mtimeMs, written);
  });

  it('rebuilds the index when a skill file changes', async () => {
    const file = path.join(fixture.root, REVUE, 'SKILL.md');
    const original = await readFile(file, 'utf8');
    try {
      await writeFile(file, original.replace('Revue de NDA', 'Revue de NDA modifiée'), 'utf8');
      const changed = await openOrBuildStore(fixture.root, storeFile);
      assert.equal(changed.get(REVUE)?.title, 'Revue de NDA modifiée');
      changed.close();
    } finally {
      await writeFile(file, original, 'utf8');
    }
  });
});
