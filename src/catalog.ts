import { createHash } from 'node:crypto';
import { open, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Dirent } from 'node:fs';
import { parse } from 'yaml';
import { tokenize } from './text.js';

const SKILL_FILE = 'SKILL.md';
/** First read of each file: enough for typical frontmatter and the start of the body. */
const HEADER_BYTES = 8192;
/** Second read for files whose frontmatter is longer than HEADER_BYTES. */
const MAX_HEADER_BYTES = 65536;
/** Body characters kept for indexing. */
const BODY_CHARS = 6000;
const MAX_LISTED_FILES = 200;
const SCAN_BATCH = 64;
/** Folders listed at once. Listing a whole level at once holds every directory entry in memory. */
const LIST_BATCH = 32;

/** Maximum SKILL.md text returned by get_legal_skill. */
export const MAX_CONTENT_CHARS = 200_000;
/** Bytes read from disk for get_legal_skill. UTF-8 uses at most 4 bytes per character. */
export const MAX_CONTENT_BYTES = MAX_CONTENT_CHARS * 4;

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

/** Every `<...>/skills/<slug>/SKILL.md` under `root`. Symbolic links are never followed. */
export async function listSkillFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  let level = [root];

  while (level.length > 0) {
    const next: string[] = [];
    // The folders of one level are listed in parallel batches: listing folders is slow on Windows.
    for (let i = 0; i < level.length; i += LIST_BATCH) {
      const listings = await Promise.all(level.slice(i, i + LIST_BATCH).map(listFolder));
      for (const listing of listings) {
        if ('error' in listing) {
          // The root must exist; an unreadable sub-folder is skipped.
          if (listing.dir === root) {
            throw listing.error;
          }
          continue;
        }
        for (const entry of listing.entries) {
          if (entry.isSymbolicLink()) {
            continue;
          }
          const full = path.join(listing.dir, entry.name);
          if (entry.isDirectory()) {
            if (entry.name !== '.git' && entry.name !== 'node_modules') {
              next.push(full);
            }
          } else if (entry.isFile() && entry.name === SKILL_FILE && isInSkillsFolder(full)) {
            found.push(full);
          }
        }
      }
    }
    level = next;
  }

  return found.sort();
}

/** Reads one skill file. Returns null when it has no usable frontmatter. */
export async function indexSkillFile(root: string, filePath: string): Promise<IndexedSkill | null> {
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

/**
 * Fingerprint of the skill files: their paths, sizes and modification times. Any edit
 * to the library changes it. Returns null when a file cannot be inspected.
 */
export async function libraryFingerprint(root: string, files: string[]): Promise<string | null> {
  const lines: string[] = [];
  try {
    for (let i = 0; i < files.length; i += SCAN_BATCH) {
      const batch = files.slice(i, i + SCAN_BATCH);
      const infos = await Promise.all(batch.map((file) => stat(file)));
      batch.forEach((file, index) => {
        const info = infos[index];
        lines.push(`${path.relative(root, file)}|${info?.size ?? -1}|${info?.mtimeMs ?? -1}`);
      });
    }
  } catch {
    return null;
  }
  return createHash('sha256').update(lines.join('\n')).digest('hex');
}

/** Reads at most maxBytes from the start of a file, and reports its full size. */
export async function readPrefix(file: string, maxBytes: number): Promise<{ text: string; size: number }> {
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

/** Names of the files next to a skill, excluding SKILL.md itself. */
export async function listSupportingFiles(skillFolder: string): Promise<string[]> {
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

/** True when `target` is strictly inside `root`. Both paths must already be resolved. */
export function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== '' && !path.isAbsolute(relative) && relative.split(path.sep)[0] !== '..';
}

type Listing = { dir: string; entries: Dirent[] } | { dir: string; error: unknown };

async function listFolder(dir: string): Promise<Listing> {
  try {
    return { dir, entries: await readdir(dir, { withFileTypes: true }) };
  } catch (error) {
    return { dir, error };
  }
}

function isInSkillsFolder(file: string): boolean {
  // .../skills/<slug>/SKILL.md
  return path.basename(path.dirname(path.dirname(file))) === 'skills';
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
