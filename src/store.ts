import { existsSync } from 'node:fs';
import { lstat, mkdir, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import {
  indexSkillFile,
  isInside,
  libraryFingerprint,
  listSkillFiles,
  listSupportingFiles,
  MAX_CONTENT_BYTES,
  MAX_CONTENT_CHARS,
  readPrefix,
  type SkillMeta,
} from './catalog.js';
import { expandQuery } from './glossary.js';
import { LANGUAGE_NAMES } from './labels.js';

/** File name of the index, inside the data folder. */
export const STORE_FILE = 'legal-skills.sqlite';
/** Keeps the index in memory instead of a file (used by tests and by servers without a data folder). */
export const MEMORY = ':memory:';

/** Bump when the schema or the ranking data changes, so that older files are rebuilt. */
const STORE_FORMAT = 1;
/** BM25 parameters. */
const K1 = 1.2;
const B = 0.75;
/** SQLite page cache, in KiB. It bounds how much of the index is kept in memory. */
const PAGE_CACHE_KIB = 16 * 1024;
const TAG_FACET_LIMIT = 60;
const SCAN_BATCH = 64;

export interface FacetFilters {
  jurisdiction?: string;
  language?: string;
  practice?: string;
  tag?: string;
}

export interface Facet {
  code: string;
  count: number;
  /** Display name, when one is known (languages only). */
  label?: string;
}

export interface Facets {
  /** Number of skills matching the filters. */
  total: number;
  languages: Facet[];
  jurisdictions: Facet[];
  /** Practice areas, which are the themes. */
  practices: Facet[];
  /** Tags, which give the task type or topic. Only part of the library is tagged. */
  tags: Facet[];
}

export interface SearchHit {
  meta: SkillMeta;
  score: number;
}

export interface SkillDocument {
  meta: SkillMeta;
  content: string;
  truncated: boolean;
  files: string[];
}

const SCHEMA = `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
CREATE TABLE skills (
  sid INTEGER PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  jurisdiction TEXT NOT NULL,
  practice TEXT NOT NULL,
  language TEXT NOT NULL,
  license TEXT NOT NULL,
  author TEXT NOT NULL,
  version TEXT NOT NULL,
  file TEXT NOT NULL,
  length REAL NOT NULL
);
CREATE TABLE skill_tags (tag TEXT NOT NULL, sid INTEGER NOT NULL, PRIMARY KEY (tag, sid)) WITHOUT ROWID;
CREATE TABLE terms (tid INTEGER PRIMARY KEY, term TEXT NOT NULL UNIQUE, df INTEGER NOT NULL);
CREATE TABLE postings (tid INTEGER NOT NULL, sid INTEGER NOT NULL, weight REAL NOT NULL, PRIMARY KEY (tid, sid)) WITHOUT ROWID;
CREATE INDEX skills_jurisdiction ON skills (jurisdiction);
CREATE INDEX skills_language ON skills (language);
CREATE INDEX skills_practice ON skills (practice);
`;

interface SkillRow {
  sid: number;
  id: string;
  name: string;
  title: string;
  description: string;
  jurisdiction: string;
  practice: string;
  language: string;
  license: string;
  author: string;
  version: string;
  file: string;
  length: number;
}

/** Index of the skill library on disk: postings and metadata are read per query, not kept in memory. */
export class SkillStore {
  private readonly statements = new Map<string, StatementSync>();
  private readonly sidOf = new Map<string, number>();

  private constructor(
    private readonly db: DatabaseSync,
    private readonly root: string,
    private readonly realRoot: string,
    private readonly ids: string[],
    private readonly lengths: number[],
    readonly averageLength: number,
    /** Files that have no usable frontmatter and are therefore not indexed. */
    readonly skipped: number,
  ) {
    ids.forEach((id, sid) => this.sidOf.set(id, sid));
  }

  /** Opens an index that has already been written. */
  static open(db: DatabaseSync, root: string, realRoot: string): SkillStore {
    const meta = new Map(
      all<{ key: string; value: string }>(db.prepare('SELECT key, value FROM meta')).map((row) => [row.key, row.value] as const),
    );
    const count = Number(meta.get('skill_count') ?? 0);
    const ids: string[] = new Array<string>(count).fill('');
    const lengths: number[] = new Array<number>(count).fill(0);
    for (const row of all<{ sid: number; id: string; length: number }>(db.prepare('SELECT sid, id, length FROM skills'))) {
      ids[row.sid] = row.id;
      lengths[row.sid] = row.length;
    }
    return new SkillStore(
      db,
      root,
      realRoot,
      ids,
      lengths,
      Number(meta.get('average_length') ?? 0),
      Number(meta.get('skipped') ?? 0),
    );
  }

  /** Number of indexed skills. */
  get size(): number {
    return this.ids.length;
  }

  /** Ids of every indexed skill. */
  idList(): string[] {
    return [...this.ids];
  }

  /** Metadata of one skill, looked up by id. */
  get(id: string): SkillMeta | undefined {
    const sid = this.sidOf.get(id);
    return sid === undefined ? undefined : this.metaOf(sid);
  }

  /** Metadata of every skill, in index order. */
  allSkills(): SkillMeta[] {
    return this.ids.map((_, sid) => this.metaOf(sid));
  }

  /** Ids that match the filters, or null when no filter is set (every skill matches). */
  allowedIds(filters: FacetFilters): Set<string> | null {
    const sids = this.allowedSids(filters);
    if (sids === null) {
      return null;
    }
    return new Set([...sids].map((sid) => this.ids[sid] ?? ''));
  }

  /** BM25 ranking over the indexed terms, with the glossary expansions of the query. */
  search(query: string, limit: number, filters: FacetFilters = {}): SearchHit[] {
    const weights = expandQuery(query);
    if (weights.size === 0) {
      return [];
    }
    const allowed = this.allowedSids(filters);
    const termStatement = this.prepare('SELECT tid, df FROM terms WHERE term = ?');
    const postingStatement = this.prepare('SELECT sid, weight FROM postings WHERE tid = ?');
    const scores = new Map<number, number>();

    for (const [term, queryWeight] of weights) {
      const info = one<{ tid: number; df: number }>(termStatement, term);
      if (!info) {
        continue;
      }
      const idf = Math.log(1 + (this.size - info.df + 0.5) / (info.df + 0.5));
      for (const posting of all<{ sid: number; weight: number }>(postingStatement, info.tid)) {
        if (allowed && !allowed.has(posting.sid)) {
          continue;
        }
        const length = this.lengths[posting.sid] ?? 0;
        const norm = posting.weight + K1 * (1 - B + (B * length) / this.averageLength);
        scores.set(
          posting.sid,
          (scores.get(posting.sid) ?? 0) + queryWeight * idf * ((posting.weight * (K1 + 1)) / norm),
        );
      }
    }

    return [...scores]
      .sort((a, b) => b[1] - a[1] || compareIds(this.ids[a[0]] ?? '', this.ids[b[0]] ?? ''))
      .slice(0, limit)
      .map(([sid, score]) => ({ meta: this.metaOf(sid), score }));
  }

  /** Counts skills per language, jurisdiction, practice area and tag. Counts follow the filters. */
  facets(filters: FacetFilters = {}): Facets {
    const { where, params } = filterSql(filters);
    const total = one<{ n: number }>(this.prepare(`SELECT COUNT(*) AS n FROM skills s WHERE ${where}`), ...params)?.n ?? 0;
    const group = (column: 'language' | 'jurisdiction' | 'practice'): Facet[] =>
      all<{ code: string; n: number }>(
        this.prepare(
          `SELECT s.${column} AS code, COUNT(*) AS n FROM skills s WHERE ${where} AND s.${column} <> '' ` +
            `GROUP BY s.${column} ORDER BY n DESC, code ASC`,
        ),
        ...params,
      ).map((row) => ({ code: row.code, count: Number(row.n) }));
    const languages = group('language').map((facet) => {
      const label = LANGUAGE_NAMES[facet.code];
      return label ? { ...facet, label } : facet;
    });
    const tags = all<{ code: string; n: number }>(
      this.prepare(
        `SELECT t.tag AS code, COUNT(*) AS n FROM skill_tags t JOIN skills s ON s.sid = t.sid ` +
          `WHERE ${where} GROUP BY t.tag ORDER BY n DESC, code ASC LIMIT ?`,
      ),
      ...params,
      TAG_FACET_LIMIT,
    ).map((row) => ({ code: row.code, count: Number(row.n) }));
    return { total: Number(total), languages, jurisdictions: group('jurisdiction'), practices: group('practice'), tags };
  }

  /** Full text of one skill, read from the library. The id is only a lookup key, never a path. */
  async readSkill(id: string): Promise<SkillDocument | null> {
    const sid = this.sidOf.get(id);
    if (sid === undefined) {
      return null;
    }
    const meta = this.metaOf(sid);
    const row = one<{ file: string }>(this.prepare('SELECT file FROM skills WHERE sid = ?'), sid);
    if (!row) {
      return null;
    }
    const file = path.join(this.root, ...row.file.split('/'));
    // Checked again at read time: the file may have been replaced by a link since indexing.
    const info = await lstat(file);
    if (!info.isFile()) {
      return null;
    }
    const realFile = await realpath(file);
    if (!isInside(this.realRoot, realFile)) {
      return null;
    }
    const { text, size } = await readPrefix(realFile, MAX_CONTENT_BYTES);
    const files = await listSupportingFiles(path.dirname(realFile));
    return {
      meta,
      content: text.slice(0, MAX_CONTENT_CHARS),
      truncated: size > MAX_CONTENT_BYTES || text.length > MAX_CONTENT_CHARS,
      files,
    };
  }

  close(): void {
    this.db.close();
  }

  private allowedSids(filters: FacetFilters): Set<number> | null {
    const { where, params } = filterSql(filters);
    if (where === '1 = 1') {
      return null;
    }
    const rows = all<{ sid: number }>(this.prepare(`SELECT s.sid AS sid FROM skills s WHERE ${where}`), ...params);
    return new Set(rows.map((row) => row.sid));
  }

  private metaOf(sid: number): SkillMeta {
    const row = one<SkillRow>(
      this.prepare(
        'SELECT sid, id, name, title, description, jurisdiction, practice, language, license, author, version, file, length ' +
          'FROM skills WHERE sid = ?',
      ),
      sid,
    );
    if (!row) {
      throw new Error(`Skill index ${sid} is missing from the store`);
    }
    const tags = all<{ tag: string }>(this.prepare('SELECT tag FROM skill_tags WHERE sid = ? ORDER BY tag'), sid).map(
      (tagRow) => tagRow.tag,
    );
    return {
      id: row.id,
      name: row.name,
      title: row.title,
      description: row.description,
      jurisdiction: row.jurisdiction,
      practice: row.practice,
      language: row.language,
      license: row.license,
      author: row.author,
      version: row.version,
      tags,
    };
  }

  private prepare(sql: string): StatementSync {
    let statement = this.statements.get(sql);
    if (!statement) {
      statement = this.db.prepare(sql);
      this.statements.set(sql, statement);
    }
    return statement;
  }
}

/**
 * Returns the index for the library. The file is reused when no skill file has changed
 * since it was written, and rebuilt otherwise. MEMORY builds a throwaway index.
 */
export async function openOrBuildStore(root: string, file: string): Promise<SkillStore> {
  const realRoot = await realpath(root);
  const files = await listSkillFiles(root);
  const fingerprint = await libraryFingerprint(root, files);
  const persistent = file !== MEMORY;

  if (persistent && fingerprint) {
    const fresh = openFresh(file, fingerprint, root, realRoot);
    if (fresh) {
      return fresh;
    }
  }

  if (persistent) {
    await mkdir(path.dirname(file), { recursive: true });
    await rm(file, { force: true });
  }
  const db = new DatabaseSync(file);
  try {
    db.exec('PRAGMA journal_mode = OFF');
    db.exec('PRAGMA synchronous = OFF');
    await writeStore(db, root, files, fingerprint);
  } catch (error) {
    db.close();
    throw error;
  }
  return finishOpen(db, root, realRoot);
}

function openFresh(file: string, fingerprint: string, root: string, realRoot: string): SkillStore | null {
  if (!existsSync(file)) {
    return null;
  }
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(file);
  } catch {
    return null;
  }
  try {
    const meta = new Map(
      all<{ key: string; value: string }>(db.prepare('SELECT key, value FROM meta')).map((row) => [row.key, row.value] as const),
    );
    if (meta.get('format') !== String(STORE_FORMAT) || meta.get('fingerprint') !== fingerprint) {
      db.close();
      return null;
    }
    return finishOpen(db, root, realRoot);
  } catch {
    db.close();
    return null;
  }
}

function finishOpen(db: DatabaseSync, root: string, realRoot: string): SkillStore {
  db.exec(`PRAGMA cache_size = -${PAGE_CACHE_KIB}`);
  db.exec('PRAGMA query_only = ON');
  return SkillStore.open(db, root, realRoot);
}

/** Writes every skill, its tags and its postings. Postings are written as they are computed. */
async function writeStore(db: DatabaseSync, root: string, files: string[], fingerprint: string | null): Promise<void> {
  db.exec(SCHEMA);
  const insertSkill = db.prepare(
    'INSERT INTO skills (sid, id, name, title, description, jurisdiction, practice, language, license, author, version, file, length) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const insertTag = db.prepare('INSERT OR IGNORE INTO skill_tags (tag, sid) VALUES (?, ?)');
  const insertTerm = db.prepare('INSERT INTO terms (tid, term, df) VALUES (?, ?, 0)');
  const insertPosting = db.prepare('INSERT INTO postings (tid, sid, weight) VALUES (?, ?, ?)');
  const termIds = new Map<string, number>();
  const documentFrequency = new Map<number, number>();
  let sid = 0;
  let skipped = 0;
  let totalLength = 0;

  db.exec('BEGIN');
  for (let i = 0; i < files.length; i += SCAN_BATCH) {
    const batch = files.slice(i, i + SCAN_BATCH);
    const indexed = await Promise.all(batch.map((file) => indexSkillFile(root, file).catch(() => null)));
    for (const skill of indexed) {
      if (!skill) {
        skipped += 1;
        continue;
      }
      const { meta } = skill;
      insertSkill.run(
        sid,
        meta.id,
        meta.name,
        meta.title,
        meta.description,
        meta.jurisdiction,
        meta.practice,
        meta.language,
        meta.license,
        meta.author,
        meta.version,
        path.relative(root, skill.filePath).split(path.sep).join('/'),
        skill.length,
      );
      for (const tag of meta.tags) {
        insertTag.run(tag, sid);
      }
      for (const [term, weight] of skill.weights) {
        let tid = termIds.get(term);
        if (tid === undefined) {
          tid = termIds.size + 1;
          termIds.set(term, tid);
          insertTerm.run(tid, term);
        }
        insertPosting.run(tid, sid, weight);
        documentFrequency.set(tid, (documentFrequency.get(tid) ?? 0) + 1);
      }
      totalLength += skill.length;
      sid += 1;
    }
  }

  if (sid === 0) {
    db.exec('ROLLBACK');
    throw new Error(`No SKILL.md files found under ${root}. Run "git submodule update --init" in the project.`);
  }

  const updateDf = db.prepare('UPDATE terms SET df = ? WHERE tid = ?');
  for (const [tid, count] of documentFrequency) {
    updateDf.run(count, tid);
  }
  // Written last: a file without these rows is treated as incomplete and rebuilt.
  const putMeta = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)');
  putMeta.run('format', String(STORE_FORMAT));
  putMeta.run('fingerprint', fingerprint ?? '');
  putMeta.run('skill_count', String(sid));
  putMeta.run('average_length', String(totalLength / sid));
  putMeta.run('skipped', String(skipped));
  db.exec('COMMIT');
}

/** SQL filter on the skills table, aliased as `s`. */
function filterSql(filters: FacetFilters): { where: string; params: string[] } {
  const clauses: string[] = [];
  const params: string[] = [];
  if (filters.jurisdiction) {
    clauses.push('s.jurisdiction = ?');
    params.push(filters.jurisdiction);
  }
  if (filters.language) {
    clauses.push('s.language = ?');
    params.push(filters.language);
  }
  if (filters.practice) {
    clauses.push('s.practice = ?');
    params.push(filters.practice);
  }
  if (filters.tag) {
    clauses.push('s.sid IN (SELECT sid FROM skill_tags WHERE tag = ?)');
    params.push(filters.tag);
  }
  return { where: clauses.length > 0 ? clauses.join(' AND ') : '1 = 1', params };
}

function all<T>(statement: StatementSync, ...params: Array<string | number>): T[] {
  return statement.all(...params) as unknown as T[];
}

function one<T>(statement: StatementSync, ...params: Array<string | number>): T | undefined {
  return statement.get(...params) as unknown as T | undefined;
}

function compareIds(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}
