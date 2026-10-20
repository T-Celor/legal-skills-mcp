import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { expandQuery } from '../glossary.js';

describe('expandQuery', () => {
  it('keeps the words the user typed at full weight', () => {
    assert.equal(expandQuery('réclamation').get('reclamation'), 1);
  });

  it('adds the equivalents of a known concept at half weight', () => {
    const weights = expandQuery('réclamation');
    assert.equal(weights.get('complaint'), 0.5);
    assert.equal(weights.get('beschwerde'), 0.5);
  });

  it('recognises both spellings of German umlauts', () => {
    assert.equal(expandQuery('kundigung').get('dismissal'), 0.5);
    assert.equal(expandQuery('Kuendigung').get('dismissal'), 0.5);
    assert.equal(expandQuery('Kündigung').get('dismissal'), 0.5);
  });

  it('triggers a multi-word concept only when all its words are present', () => {
    assert.equal(expandQuery('mise en demeure').get('demand'), 0.5);
    assert.equal(expandQuery('demeure').get('demand'), undefined);
  });

  it('leaves unknown queries unchanged', () => {
    assert.deepEqual([...expandQuery('zzzqqq')], [['zzzqqq', 1]]);
  });

  it('returns nothing for queries without searchable words', () => {
    assert.equal(expandQuery('!!').size, 0);
  });
});
