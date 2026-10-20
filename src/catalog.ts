import { lstat, open, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { LANGUAGE_NAMES } from './labels.js';
import { tokenize } from './text.js';

const SKILL_FILE = 'SKILL.md';
/** First read of each file: enough for typical frontmatter and the start of the body. */
const HEADER_BYTES = 8192;
/** Second read for files whose frontmatter is longer than HEADER_BYTES. */
const MAX_HEADER_BYTES = 65536;
/** Body characters kept for indexing. */
const BODY_CHARS = 6000;
/** Maximum SKILL.md text returned by get_legal_skill. */
export const MAX_CONTENT_CHARS = 200_000;
/** Bytes read from disk for get_legal_skill. UTF-8 uses at most 4 bytes per character. */
const MAX_CONTENT_BYTES = MAX_CONTENT_CHARS * 4;
const MAX_LISTED_FILES = 200;
const SCAN_BATCH = 64;
/** Number of tags returned by facets, most frequent first. */
const TAG_FACET_LIMIT = 60;

export interface SkillMeta {
  /** Relative folder path, e.g. "de/administrative/skills/01-zulaessigkeit-verwaltungsklage". */
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
  /** Lowercase tags, such as "drafting", "litigation" or "analysis". */
  tags: string[];
}

export interface IndexedSkill {
  meta: SkillMeta;
  filePath: string;
  /** Weighted term frequencies: title x3, name and tags x2, description x2, body x1. */
  weights: Map<string, number>;
  /** Sum of the weights, used for BM25 length normalisation. */
  length: number;
}

export interface Catalog {
  root: string;
  /** Root with symbolic links resolved. Files must stay inside it to be read. */
  realRoot: string;
  skills: Map<string, IndexedSkill>;
  documentFrequency: Map<string, number>;
  averageLength: number;
  skipped: number;
}

export interface SkillDocument {
  meta: SkillMeta;
  content: string;
  truncated: boolean;
  files: string[];
}

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

/**
 * Indexes every `<...>/skills/<slug>/SKILL.md` under `root`.
 * Symbolic links are never followed, so nothing outside `root` can be read.
 */
export async function loadCatalog(root: string): Promise<Catalog> {
  // Throws when the library folder is missing.
  const realRoot = await realpath(root);
  const candidates = await findSkillFiles(root);
  const skills = new Map<string, IndexedSkill>();
  let skipped = 0;

  for (let i = 0; i < candidates.length; i += SCAN_BATCH) {
    const batch = candidates.slice(i, i + SCAN_BATCH);
    // One unreadable file must not abort the whole index: count it as skipped.
    const indexed = await Promise.all(
      batch.map((file) => indexSkill(root, file).catch(() => null)),
    );
    for (const skill of indexed) {
      if (skill) {
        skills.set(skill.meta.id, skill);
      } else {
        skipped += 1;
      }
    }
  }

  if (skills.size === 0) {
    throw new Error(
      `No SKILL.md files found under ${root}. Run "git submodule update --init" in the project.`,
    );
  }

  const documentFrequency = new Map<string, number>();
  let totalLength = 0;
  for (const skill of skills.values()) {
    totalLength += skill.length;
    for (const term of skill.weights.keys()) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }

  return {
    root,
    realRoot,
    skills,
    documentFrequency,
    averageLength: totalLength / skills.size,
    skipped,
  };
}

/** True when a skill matches every filter that is set. */
export function matchesFilters(meta: SkillMeta, filters: FacetFilters): boolean {
  if (filters.jurisdiction && meta.jurisdiction !== filters.jurisdiction) {
    return false;
  }
  if (filters.language && meta.language !== filters.language) {
    return false;
  }
  if (filters.practice && meta.practice !== filters.practice) {
    return false;
  }
  if (filters.tag && !meta.tags.includes(filters.tag)) {
    return false;
  }
  return true;
}

/**
 * Reads one skill document, looked up by its id. The id is never used as a path.
 * The file is checked again at read time, because it may have been replaced by a
 * link since it was indexed.
 */
export async function readSkill(catalog: Catalog, id: string): Promise<SkillDocument | null> {
  const skill = catalog.skills.get(id);
  if (!skill) {
    return null;
  }

  const info = await lstat(skill.filePath);
  if (!info.isFile()) {
    return null;
  }
  const realFile = await realpath(skill.filePath);
  if (!isInside(catalog.realRoot, realFile)) {
    return null;
  }

  const { text, size } = await readPrefix(realFile, MAX_CONTENT_BYTES);
  const files = await listSupportingFiles(path.dirname(realFile));

  return {
    meta: skill.meta,
    content: text.slice(0, MAX_CONTENT_CHARS),
    truncated: size > MAX_CONTENT_BYTES || text.length > MAX_CONTENT_CHARS,
    files,
  };
}

/**
 * Counts skills per language, jurisdiction, practice area (theme) and tag (task type).
 * Counts only include the skills matching the filters, so browsing narrows step by step.
 */
export function facets(catalog: Catalog, filters: FacetFilters = {}): Facets {
  const languages = new Map<string, number>();
  const jurisdictions = new Map<string, number>();
  const practices = new Map<string, number>();
  const tags = new Map<string, number>();
  let total = 0;

  for (const { meta } of catalog.skills.values()) {
    if (!matchesFilters(meta, filters)) {
      continue;
    }
    total += 1;
    increment(languages, meta.language);
    increment(jurisdictions, meta.jurisdiction);
    increment(practices, meta.practice);
    for (const tag of meta.tags) {
      increment(tags, tag);
    }
  }

  return {
    total,
    languages: toFacets(languages).map(withLanguageName),
    jurisdictions: toFacets(jurisdictions),
    practices: toFacets(practices),
    tags: toFacets(tags).slice(0, TAG_FACET_LIMIT),
  };
}

function increment(counts: Map<string, number>, code: string): void {
  if (code) {
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
}

function withLanguageName(facet: Facet): Facet {
  const label = LANGUAGE_NAMES[facet.code];
  return label ? { ...facet, label } : facet;
}

function toFacets(counts: Map<string, number>): Facet[] {
  return [...counts.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
}

async function findSkillFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  const pending = [root];

  while (pending.length > 0) {
    const dir = pending.pop();
    if (dir === undefined) {
      break;
    }
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      // The root must exist; an unreadable sub-folder is skipped.
      if (dir === root) {
        throw error;
      }
      continue;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        continue;
      }
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '.git' && entry.name !== 'node_modules') {
          pending.push(full);
        }
      } else if (entry.isFile() && entry.name === SKILL_FILE && isInSkillsFolder(full)) {
        found.push(full);
      }
    }
  }

  return found.sort();
}

function isInSkillsFolder(file: string): boolean {
  // .../skills/<slug>/SKILL.md
  return path.basename(path.dirname(path.dirname(file))) === 'skills';
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== '' && !path.isAbsolute(relative) && relative.split(path.sep)[0] !== '..';
}

async function indexSkill(root: string, filePath: string): Promise<IndexedSkill | null> {
  let split = splitFrontmatter((await readPrefix(filePath, HEADER_BYTES)).text);
  if (!split) {
    // The frontmatter may be longer than the first read: try once with a larger prefix.
    split = splitFrontmatter((await readPrefix(filePath, MAX_HEADER_BYTES)).text);
  }
  if (!split) {
    return null;
  }

  const { data, body } = split;
  const name = asText(data.name);
  const description = asText(data.description);
  if (!name || !description) {
    return null;
  }

  const tags = [...new Set(asList(data.tags).map((tag) => tag.toLowerCase()))];
  const meta: SkillMeta = {
    id: path.relative(root, path.dirname(filePath)).split(path.sep).join('/'),
    name,
    title: asText(data.title) || name,
    description,
    jurisdiction: asText(data.jurisdiction),
    practice: asText(data.practice),
    language: asText(data.language),
    license: asText(data.license),
    author: asText(data.author),
    version: asText(data.version),
    tags,
  };

  const weights = new Map<string, number>();
  let length = 0;
  const add = (value: string, weight: number): void => {
    for (const token of tokenize(value)) {
      weights.set(token, (weights.get(token) ?? 0) + weight);
      length += weight;
    }
  };
  add(meta.title, 3);
  add(meta.name, 2);
  add(tags.join(' '), 2);
  add(meta.description, 2);
  add(body.slice(0, BODY_CHARS), 1);

  return { meta, filePath, weights, length };
}

/** Reads at most maxBytes from the start of a file, and reports its full size. */
async function readPrefix(file: string, maxBytes: number): Promise<{ text: string; size: number }> {
  const handle = await open(file, 'r');
  try {
    const { size } = await handle.stat();
    const length = Math.min(size, maxBytes);
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return { text: buffer.subarray(0, bytesRead).toString('utf8'), size };
  } finally {
    await handle.close();
  }
}

function splitFrontmatter(header: string): { data: Record<string, unknown>; body: string } | null {
  const source = header.replace(/^﻿/, '');
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(source);
  if (!match) {
    return null;
  }

  let data: unknown;
  try {
    // Frontmatter comes from third-party files. Refuse YAML aliases, and read every
    // scalar as text so that "1.10" keeps its spelling instead of becoming 1.1.
    data = parse(match[1] ?? '', { maxAliasCount: 0, schema: 'failsafe' });
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return null;
  }

  return {
    data: data as Record<string, unknown>,
    body: source.slice(match[0].length),
  };
}

function asText(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (typeof value === 'number') {
    return String(value);
  }
  return '';
}

function asList(value: unknown): string[] {
  const items = Array.isArray(value) ? value : [value];
  return items.map(asText).filter((item) => item.length > 0);
}

async function listSupportingFiles(skillFolder: string): Promise<string[]> {
  const files: string[] = [];
  const pending = [skillFolder];

  while (pending.length > 0 && files.length < MAX_LISTED_FILES) {
    const dir = pending.shift();
    if (dir === undefined) {
      break;
    }
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        continue;
      }
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        pending.push(full);
      } else if (entry.isFile() && !(dir === skillFolder && entry.name === SKILL_FILE)) {
        files.push(path.relative(skillFolder, full).split(path.sep).join('/'));
        if (files.length >= MAX_LISTED_FILES) {
          break;
        }
      }
    }
  }

  return files.sort();
}
