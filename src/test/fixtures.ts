import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/** Builds a SKILL.md with YAML frontmatter from simple key/value fields. */
export function skillFile(fields: Record<string, string>, body = '# Skill\n'): string {
  const lines = Object.entries(fields).map(([key, value]) => `${key}: ${value}`);
  return `---\n${lines.join('\n')}\n---\n\n${body}`;
}

/** Invisible Unicode tag character (U+E0041), used to test that it is stripped from output. */
const TAG_A = String.fromCodePoint(0xe0041);

/** CRLF line endings and a byte order mark, as written by Windows editors. */
const CRLF_BOM_SKILL = [
  '﻿---',
  'name: 007-contrat-type',
  'title: Modèle de contrat',
  'description: Contrat type à compléter avant signature.',
  'author: Fixture Author',
  'license: MIT',
  'version: 1.10',
  'jurisdiction: fr',
  'practice: contracts',
  'language: fr',
  '---',
  '',
  '# Modèle de contrat',
  '',
].join('\r\n');

const SKILLS: Record<string, string> = {
  'fr/contracts/skills/revue-nda': skillFile(
    {
      name: 'revue-nda',
      title: 'Revue de NDA',
      description: "Vérifie les clauses de confidentialité d'un accord de non-divulgation.",
      author: 'Fixture Author',
      license: 'Apache-2.0',
      version: '0.1.0',
      execution_mode: 'open',
      jurisdiction: 'fr',
      practice: 'contracts',
      language: 'fr',
    },
    '# Revue de NDA\n\n## When to apply\nQuand un accord de confidentialité doit être relu.\n',
  ),
  'fr/contracts/skills/crlf-bom': CRLF_BOM_SKILL,
  'fr/contracts/skills/tag-chars': skillFile(
    {
      name: 'tag-chars',
      title: 'Caractères invisibles',
      description: `Teste les caractères invisibles${TAG_A}.`,
      author: 'Fixture Author',
      license: 'Apache-2.0',
      version: '0.1.0',
      jurisdiction: 'fr',
      practice: 'contracts',
      language: 'fr',
    },
    '# Caractères invisibles\n',
  ),
  'fr/contracts/skills/sans-frontmatter': '# Pas de frontmatter\n\nTexte sans métadonnées.\n',
  'de/employment/skills/kuendigung-pruefen': skillFile(
    {
      name: 'kuendigung-pruefen',
      title: 'Kündigung prüfen',
      description: 'Prüft die Wirksamkeit einer Kündigung nach dem Kündigungsschutzgesetz.',
      author: 'Fixture Author',
      license: 'MIT',
      version: '0.1.0',
      execution_mode: 'open',
      jurisdiction: 'de',
      practice: 'employment',
      language: 'de',
    },
    '# Kündigung prüfen\n',
  ),
  // Frontmatter longer than the first read of 8 KiB.
  'de/general/skills/long-frontmatter': skillFile(
    {
      name: 'long-frontmatter',
      title: 'Dokumentvorlage',
      description: 'Beispieltext '.repeat(800).trim(),
      author: 'Fixture Author',
      license: 'MIT',
      version: '0.1.0',
      jurisdiction: 'de',
      practice: 'general',
      language: 'de',
    },
    '# Dokumentvorlage\n',
  ),
  'us/litigation/skills/motion-to-dismiss': skillFile(
    {
      name: 'motion-to-dismiss',
      title: 'Motion to dismiss',
      description: 'Drafts a motion to dismiss for failure to state a claim.',
      author: 'Fixture Author',
      license: 'Apache-2.0',
      version: '1.0.0',
      execution_mode: 'open',
      jurisdiction: 'us',
      practice: 'litigation',
      language: 'en',
    },
    '# Motion to dismiss\n\nArguments under Rule 12 for dismissal of the complaint.\n',
  ),
  // An empty jurisdiction field parses as null.
  'us/general/skills/no-jurisdiction':
    '---\nname: no-jurisdiction\ndescription: Skill with an empty jurisdiction field.\njurisdiction:\npractice: general\nlanguage: en\n---\n\n# No jurisdiction\n',
  // Body larger than the get_legal_skill limit.
  'us/general/skills/huge-skill': skillFile(
    {
      name: 'huge-skill',
      description: 'A skill whose body exceeds the get_legal_skill limit.',
      author: 'Fixture Author',
      license: 'MIT',
      version: '0.1.0',
      jurisdiction: 'us',
      practice: 'general',
      language: 'en',
    },
    `# Huge skill\n\n${'x'.repeat(260_000)}\n`,
  ),
  'cn/contracts/skills/baomi-xieyi': skillFile(
    {
      name: 'baomi-xieyi',
      title: '保密协议审查',
      description: '审查保密协议的条款，并列出风险点。',
      author: 'Fixture Author',
      license: 'Apache-2.0',
      version: '0.1.0',
      execution_mode: 'open',
      jurisdiction: 'cn',
      practice: 'contracts',
      language: 'zh',
    },
    '# 保密协议审查\n',
  ),
};

export interface FixtureLibrary {
  root: string;
  /** False when the platform refused to create the junction. */
  linked: boolean;
  cleanup: () => Promise<void>;
}

/**
 * Builds a small library shaped like legal-skills-open, plus a junction that
 * points outside it. The junction must never be followed.
 */
export async function createFixtureLibrary(): Promise<FixtureLibrary> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'legal-skills-fixture-'));
  const outside = await mkdtemp(path.join(os.tmpdir(), 'legal-skills-outside-'));

  for (const [relative, content] of Object.entries(SKILLS)) {
    await writeSkill(path.join(root, relative, 'SKILL.md'), content);
  }

  // A script shipped with a skill: it must be listed, never executed.
  const scriptsDir = path.join(root, 'fr/contracts/skills/revue-nda/scripts');
  await mkdir(scriptsDir, { recursive: true });
  await writeFile(path.join(scriptsDir, 'run.py'), 'raise SystemExit(1)\n', 'utf8');

  // A SKILL.md that is not inside a skills/ folder must be ignored.
  await writeSkill(
    path.join(root, 'fr/notes/SKILL.md'),
    '---\nname: notes\ndescription: not a skill folder\n---\n',
  );

  await writeSkill(
    path.join(outside, 'secret/skills/leak/SKILL.md'),
    '---\nname: leak\ndescription: should never be indexed\n---\n',
  );
  let linked = true;
  try {
    await symlink(outside, path.join(root, 'linked'), 'junction');
  } catch {
    linked = false;
  }

  return {
    root,
    linked,
    cleanup: async () => {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    },
  };
}

async function writeSkill(file: string, content: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content, 'utf8');
}
