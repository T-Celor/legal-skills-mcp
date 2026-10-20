import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { tokenize } from '../text.js';

describe('tokenize', () => {
  it('lowercases and folds accents', () => {
    assert.deepEqual(tokenize('Modèle Été'), ['modele', 'ete']);
  });

  it('indexes German umlauts with both the umlaut and the ae/oe/ue spelling', () => {
    const terms = tokenize('Kündigung');
    assert.ok(terms.includes('kundigung'));
    assert.ok(terms.includes('kuendigung'));
    assert.ok(tokenize('Kuendigung').includes('kuendigung'));
  });

  it('folds the German sharp s and Polish letters', () => {
    assert.ok(tokenize('Straße').includes('strasse'));
    assert.ok(tokenize('spółka').includes('spolka'));
  });

  it('keeps single characters, numbers and letter-digit codes', () => {
    assert.deepEqual(tokenize('Article 6 GDPR'), ['article', '6', 'gdpr']);
    assert.deepEqual(tokenize('401(k)'), ['401', 'k']);
    assert.deepEqual(tokenize('S-1'), ['s', '1']);
    assert.deepEqual(tokenize('art6'), ['art', '6']);
  });

  it('normalises full-width letters', () => {
    assert.deepEqual(tokenize('ＧＤＰＲ'), ['gdpr']);
  });

  it('indexes Han text as single characters and adjacent pairs', () => {
    const terms = tokenize('保密协议');
    for (const term of ['保', '密', '协', '议', '保密', '密协', '协议']) {
      assert.ok(terms.includes(term), `missing ${term}`);
    }
  });

  it('returns nothing for punctuation only', () => {
    assert.deepEqual(tokenize('!! ?? -'), []);
  });
});
