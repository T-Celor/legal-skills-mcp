import { matchesFilters, type Catalog, type FacetFilters, type SkillMeta } from './catalog.js';
import { expandQuery } from './glossary.js';

/** BM25 parameters. */
const K1 = 1.2;
const B = 0.75;

export type SearchFilters = FacetFilters;

export interface SearchHit {
  meta: SkillMeta;
  score: number;
}

/**
 * Ranks skills against a free-text query with BM25 over weighted terms.
 * Query terms are expanded with cross-language equivalents at half weight.
 * A skill matches when at least one of the (expanded) terms appears in it.
 */
export function searchCatalog(
  catalog: Catalog,
  query: string,
  limit: number,
  filters: SearchFilters = {},
): SearchHit[] {
  const weights = expandQuery(query);
  if (weights.size === 0) {
    return [];
  }

  const total = catalog.skills.size;
  const hits: SearchHit[] = [];

  for (const skill of catalog.skills.values()) {
    if (!matchesFilters(skill.meta, filters)) {
      continue;
    }

    let score = 0;
    for (const [term, queryWeight] of weights) {
      const tf = skill.weights.get(term);
      if (!tf) {
        continue;
      }
      const df = catalog.documentFrequency.get(term) ?? 1;
      const idf = Math.log(1 + (total - df + 0.5) / (df + 0.5));
      const norm = tf + K1 * (1 - B + (B * skill.length) / catalog.averageLength);
      score += queryWeight * idf * ((tf * (K1 + 1)) / norm);
    }

    if (score > 0) {
      hits.push({ meta: skill.meta, score });
    }
  }

  hits.sort((a, b) => b.score - a.score || compareIds(a.meta.id, b.meta.id));
  return hits.slice(0, limit);
}

function compareIds(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}
