# legal-skills-mcp

Serveur MCP (stdio) qui permet de chercher dans la bibliothèque
[legal-skills-open](https://github.com/ThomasMoreAI/legal-skills-open) :
environ 20 000 compétences au format `SKILL.md`, réparties par pays et par domaine.
La bibliothèque est incluse en sous-module Git, son contenu n'est pas copié ici.

## Outils

- `search_legal_skills` : recherche par mots-clés (toutes langues, accents ignorés), filtres par pays, domaine et langue.
- `get_legal_skill` : renvoie le `SKILL.md` complet d'une compétence et la liste de ses fichiers annexes.
- `list_legal_facets` : compte les compétences par pays, et par domaine pour un pays donné.

## Installation

```bash
git clone --recurse-submodules <url-du-depot>
# ou, dans un clone existant :
git submodule update --init
npm install
npm run build
npm test
```

## Utilisation avec Claude Code

Le fichier `.mcp.json` déclare le serveur (`node dist/index.js`).
Claude Code demande une approbation la première fois qu'il ouvre le projet.

Pour utiliser une autre copie de la bibliothèque, définis `LEGAL_SKILLS_DIR`.

## Points d'attention

- Les résultats sont de la documentation informative, **pas un avis juridique**.
- Le contenu des compétences vient d'un tiers : il est renvoyé comme des données.
- Les scripts fournis avec certaines compétences sont listés mais **jamais exécutés**.
- L'indexation complète prend environ une minute au démarrage ; la première recherche peut attendre.
