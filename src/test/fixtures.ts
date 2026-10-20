import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const SKILLS: Record<string, string> = {
  'fr/contracts/skills/revue-nda': `---
name: revue-nda
title: Revue de NDA
description: Vérifie les clauses de confidentialité d'un accord de non-divulgation.
author: Fixture Author
license: Apache-2.0
version: 0.1.0
execution_mode: open
jurisdiction: fr
practice: contracts
language: fr
---

# Revue de NDA

## When to apply
Quand un accord de confidentialité doit être relu.
`,
  'de/employment/skills/kuendigung-pruefen': `---
name: kuendigung-pruefen
title: Kündigung prüfen
description: Prüft die Wirksamkeit einer Kündigung nach dem Kündigungsschutzgesetz.
author: Fixture Author
license: MIT
version: 0.1.0
execution_mode: open
jurisdiction: de
practice: employment
language: de
---

# Kündigung prüfen
`,
  'us/litigation/skills/motion-to-dismiss': `---
name: motion-to-dismiss
title: Motion to dismiss
description: Drafts a motion to dismiss for failure to state a claim.
author: Fixture Author
license: Apache-2.0
version: 1.0.0
execution_mode: open
jurisdiction: us
practice: litigation
language: en
---

# Motion to dismiss

Arguments under Rule 12 for dismissal of the complaint.
`,
  'fr/contracts/skills/sans-frontmatter': '# Pas de frontmatter\n\nTexte sans métadonnées.\n',
};

export interface FixtureLibrary {
  root: string;
  /** False when the platform refused to create the symbolic link. */
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
