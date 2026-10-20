/** Scripts written without spaces between words: Han, kana, Hangul and Thai. */
const SPACELESS_RUN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}]+/gu;
/** Anything that is not a letter, digit or combining mark separates two terms. */
const WORD_SEPARATOR = /[^\p{L}\p{N}\p{M}]+/u;
/** Letter/digit boundaries split codes such as "401k" or "art6" into two terms. */
const LETTER_DIGIT_BOUNDARY = /(?<=\p{N})(?=\p{L})|(?<=\p{L})(?=\p{N})/u;
const NON_ASCII = /[^\x00-\x7f]/;
const UMLAUT = /[äöü]/;
const COMBINING_LATIN_MARKS = /[̀-ͯ]/g;
const LETTER_FOLDS: Record<string, string> = {
  ß: 'ss',
  ł: 'l',
  ø: 'o',
  đ: 'd',
  ı: 'i',
  æ: 'ae',
  œ: 'oe',
};
const LETTER_FOLD_PATTERN = /[ßłøđıæœ]/g;

/**
 * Splits text into search terms. The text is NFKC-normalised and lowercased, and
 * accents are folded. German umlauts are also indexed as ae/oe/ue, so "Kündigung"
 * and "Kuendigung" match each other. Scripts without spaces index single characters
 * and adjacent character pairs.
 */
export function tokenize(text: string): string[] {
  const terms: string[] = [];
  const lower = text.normalize('NFKC').toLowerCase();

  for (const run of lower.matchAll(SPACELESS_RUN)) {
    addCharacterTerms(run[0] ?? '', terms);
  }
  for (const word of lower.replace(SPACELESS_RUN, ' ').split(WORD_SEPARATOR)) {
    for (const part of word.split(LETTER_DIGIT_BOUNDARY)) {
      addWordTerms(part, terms);
    }
  }
  return terms;
}

function addCharacterTerms(run: string, terms: string[]): void {
  const characters = [...run];
  characters.forEach((character, index) => {
    terms.push(character);
    const next = characters[index + 1];
    if (next !== undefined) {
      terms.push(character + next);
    }
  });
}

function addWordTerms(word: string, terms: string[]): void {
  if (word.length === 0) {
    return;
  }
  const folded = foldWord(word);
  if (folded.length > 0) {
    terms.push(folded);
  }
  if (UMLAUT.test(word)) {
    const spelled = foldWord(word.replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue'));
    if (spelled.length > 0 && spelled !== folded) {
      terms.push(spelled);
    }
  }
}

function foldWord(word: string): string {
  if (!NON_ASCII.test(word)) {
    return word;
  }
  return word
    .normalize('NFKD')
    .replace(COMBINING_LATIN_MARKS, '')
    .replace(LETTER_FOLD_PATTERN, (letter) => LETTER_FOLDS[letter] ?? letter);
}
