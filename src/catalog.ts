import { open, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { tokenize } from './text.js';

const SKILL_FILE = 'SKILL.md';
/** Bytes read per file: enough for the frontmatter and the start of the body. */
const HEADER_BYTES = 8192;
/** Body characters kept for indexing. */
const BODY_CHARS = 6000;
/** Maximum SKILL.md size returned by get_legal_skill. */
export const MAX_CONTENT_CHARS = 200_000;
const MAX_LISTED_FILES = 200;
const SCAN_BATCH = 64;

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
}

export interface IndexedSkill {
  meta: SkillMeta;
  filePath: string;
  /** Weighted term frequencies: title x3, description x2, body x1. */
  weights: Map<string, number>;
  /** Sum of the weights, used for BM25 length normalisation. */
  length: number;
}

export interface Catalog {
  root: string;
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

/**
 * Indexes every `<...>/skills/<slug>/SKILL.md` under `root`.
 * Symbolic links are never followed, so nothing outside `root` can be read.
 */
export async function loadCatalog(root: string): Promise<Catalog> {
  const candidates = await findSkillFiles(root);
  const skills = new Map<string, IndexedSkill>();
  let skipped = 0;

  for (let i = 0; i < candidates.length; i += SCAN_BATCH) {
    const batch = candidates.slice(i, i + SCAN_BATCH);
    const indexed = await Promise.all(batch.map((file) => indexSkill(root, file)));
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
    skills,
    documentFrequency,
    averageLength: totalLength / skills.size,
    skipped,
  };
}

/** Reads one skill document, looked up by its id. The id is never used as a path. */
export async function readSkill(catalog: Catalog, id: string): Promise<SkillDocument | null> {
  const skill = catalog.skills.get(id);
  if (!skill) {
    return null;
  }

  const raw = await readFile(skill.filePath, 'utf8');
  const truncated = raw.length > MAX_CONTENT_CHARS;
  const files = await listSupportingFiles(path.dirname(skill.filePath));

  return {
    meta: skill.meta,
    content: truncated ? raw.slice(0, MAX_CONTENT_CHARS) : raw,
    truncated,
    files,
  };
}

export interface Facet {
  code: string;
  count: number;
}

export interface Facets {
  jurisdictions: Facet[];
  practices: Facet[];
}

/** Counts skills per jurisdiction, and per practice area when a jurisdiction is given. */
export function facets(catalog: Catalog, jurisdiction?: string): Facets {
  const jurisdictionCounts = new Map<string, number>();
  const practiceCounts = new Map<string, number>();

  for (const { meta } of catalog.skills.values()) {
    jurisdictionCounts.set(meta.jurisdiction, (jurisdictionCounts.get(meta.jurisdiction) ?? 0) + 1);
    if (jurisdiction && meta.jurisdiction === jurisdiction) {
      practiceCounts.set(meta.practice, (practiceCounts.get(meta.practice) ?? 0) + 1);
    }
  }

  return {
    jurisdictions: toFacets(jurisdictionCounts),
    practices: toFacets(practiceCounts),
  };
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
    const entries = await readdir(dir, { withFileTypes: true });
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

async function indexSkill(root: string, filePath: string): Promise<IndexedSkill | null> {
  const header = await readHeader(filePath);
  const split = splitFrontmatter(header);
  if (!split) {
    return null;
  }

  const { data, body } = split;
  const name = asText(data.name);
  const description = asText(data.description);
  if (!name || !description) {
    return null;
  }

  const folder = path.dirname(filePath);
  const meta: SkillMeta = {
    id: path.relative(root, folder).split(path.sep).join('/'),
    name,
    title: asText(data.title) || name,
    description,
    jurisdiction: asText(data.jurisdiction),
    practice: asText(data.practice),
    language: asText(data.language),
    license: asText(data.license),
    author: asText(data.author),
    version: asText(data.version),
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
  add(meta.description, 2);
  add(body.slice(0, BODY_CHARS), 1);

  return { meta, filePath, weights, length };
}

async function readHeader(filePath: string): Promise<string> {
  const handle = await open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(HEADER_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, HEADER_BYTES, 0);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
}

function splitFrontmatter(
  header: string,
): { data: Record<string, unknown>; body: string } | null {
  const source = header.replace(/^﻿/, '');
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(source);
  if (!match) {
    return null;
  }

  let data: unknown;
  try {
    // Frontmatter comes from third-party files: refuse YAML aliases.
    data = parse(match[1] ?? '', { maxAliasCount: 0 });
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

async function listSupportingFiles(skillFolder: string): Promise<string[]> {
  const files: string[] = [];
  const pending = [skillFolder];

  while (pending.length > 0 && files.length < MAX_LISTED_FILES) {
    const dir = pending.shift();
    if (dir === undefined) {
      break;
    }
    const entries = await readdir(dir, { withFileTypes: true });
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
