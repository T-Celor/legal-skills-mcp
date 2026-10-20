import type { Catalog, SkillMeta } from './catalog.js';
import { tokenize } from './text.js';

/** BM25 parameters. */
const K1 = 1.2;
const B = 0.75;

export interface SearchFilters {
  jurisdiction?: string;
  practice?: string;
  language?: string;
}

export interface SearchHit {
  meta: SkillMeta;
  score: number;
}

/**
 * Ranks skills against a free-text query with BM25 over weighted terms.
 * A skill matches when at least one query term appears in it.
 */
export function searchCatalog(
  catalog: Catalog,
  query: string,
  limit: number,
  filters: SearchFilters = {},
): SearchHit[] {
  const terms = [...new Set(tokenize(query))];
  if (terms.length === 0) {
    return [];
  }

  const total = catalog.skills.size;
  const hits: SearchHit[] = [];

  for (const skill of catalog.skills.values()) {
    const { meta } = skill;
    if (filters.jurisdiction && meta.jurisdiction !== filters.jurisdiction) {
      continue;
    }
    if (filters.practice && meta.practice !== filters.practice) {
      continue;
    }
    if (filters.language && meta.language !== filters.language) {
      continue;
    }

    let score = 0;
    for (const term of terms) {
      const tf = skill.weights.get(term);
      if (!tf) {
        continue;
      }
      const df = catalog.documentFrequency.get(term) ?? 1;
      const idf = Math.log(1 + (total - df + 0.5) / (df + 0.5));
      const norm = tf + K1 * (1 - B + (B * skill.length) / catalog.averageLength);
      score += idf * ((tf * (K1 + 1)) / norm);
    }

    if (score > 0) {
      hits.push({ meta, score });
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
