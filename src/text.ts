/**
 * Lowercases and strips diacritics so that "Kündigung", "kundigung" and
 * "Zulässigkeit" / "zulassigkeit" all index the same way.
 */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/ß/g, 'ss')
    .toLowerCase();
}

/** Splits text into searchable tokens. Single characters are dropped as noise. */
export function tokenize(text: string): string[] {
  return normalize(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= 2);
}
