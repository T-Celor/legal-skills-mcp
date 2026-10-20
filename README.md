# legal-skills-mcp

Une présentation du projet, avec les résultats mesurés, est disponible dans [presentation/README.md](presentation/README.md).

Serveur MCP qui permet à un assistant comme Claude de chercher dans la bibliothèque [legal-skills-open](https://github.com/ThomasMoreAI/legal-skills-open). Elle contient environ 20 000 compétences juridiques au format `SKILL.md`, réparties entre une cinquantaine de pays et de juridictions.

Le serveur retrouve les modèles, les procédures et les listes de contrôle déjà rédigés, pour que l'assistant s'y appuie. Il ne rédige pas à la place de l'utilisateur.

## Ce que le serveur propose

Le serveur expose trois outils, tous en lecture seule :

- `search_legal_skills` cherche des compétences par mots-clés, par sens ou les deux. Il accepte des filtres par pays, langue, domaine et tag.
- `get_legal_skill` renvoie le texte complet d'une compétence et la liste de ses fichiers annexes.
- `list_legal_facets` compte les compétences par langue, pays, domaine et tag. Il sert à parcourir la bibliothèque avant de chercher.

## La bibliothèque en chiffres

Ces chiffres viennent de l'indexation du 20 octobre 2026.

| Élément | Valeur |
| --- | --- |
| Compétences indexées | 20 293 |
| Codes de pays et de juridictions | 74 |
| Domaines (thèmes) | 48 |
| Compétences avec au moins un tag | 733, soit environ 3,6 % |
| Langues | 20 |

L'allemand représente 75 % des compétences et l'anglais 18 %. Le français n'en compte que 109, soit 0,5 %.

## Recherche

Le mode `hybrid`, utilisé par défaut, alterne les meilleurs résultats de la recherche par mots-clés et ceux de la recherche par sens. Le mode `keyword` ne retient que les termes exacts. Le mode `semantic` ne retient que le sens.

La recherche par mots-clés connaît 19 concepts juridiques dans plusieurs langues. Une requête qui contient « réclamation » cherche aussi « complaint », « Beschwerde » et « reclamação », avec un poids moitié. Cette liste est écrite à la main. Elle couvre les notions les plus demandées, pas l'ensemble du droit.

La recherche par sens utilise [Xenova/multilingual-e5-small](https://huggingface.co/Xenova/multilingual-e5-small). Ce modèle tourne en local avec ONNX Runtime. Les vecteurs sont calculés une seule fois, par `npm run build:embeddings`.

## Installation

```bash
git clone --recurse-submodules <url-du-depot>
cd legal-skills-mcp
npm install
npm run build
npm run build:embeddings
```

La première exécution de `build:embeddings` télécharge le modèle, d'environ 118 Mo, et prend une dizaine de minutes. Le dossier `data/` pèse environ 160 Mo : l'index vectoriel (31 Mo) et le cache de l'index par mots-clés (environ 128 Mo). Le dossier `data/` et le dossier `.cache/` ne sont pas versionnés.

## Connexion à Claude Code

Le fichier `.mcp.json` déclare le serveur `legal-skills`, qui se lance avec `node dist/index.js`. Ouvrez le dossier du projet dans Claude Code. La première fois, Claude Code demande d'approuver ce serveur. La commande `claude mcp list` affiche le serveur comme connecté.

## Performances

Mesures faites sur la bibliothèque complète, sur un poste Windows 11 à 6 processeurs logiques :

- connexion au serveur : environ 1,5 s quand le cache existe ;
- premier appel de recherche : environ 20 s, le temps de charger le modèle et l'index vectoriel ;
- appels suivants : environ 200 ms ;
- démarrage sans cache, par exemple après une modification de la bibliothèque : environ 90 s.

## Tests

```bash
npm test
```

La suite compte 67 tests. Elle couvre l'indexation, la recherche, le glossaire, le cache, le protocole MCP, le point d'entrée stdio et la recherche hybride. Elle inclut aussi la bibliothèque réelle quand le sous-module est présent.

## Exemples

Résultats réels du mode hybride, à titre d'illustration. Le classement reste à relire.

- « réclamation consommateur » : *Complaint Letter Writer* (général, français) en tête, et *Digital Consumer Claims Triage* (Brésil, anglais) parmi les quatre premiers.
- « Beschwerde gegen eine Bank wegen unberechtigter Gebühren » : parmi les quatre premiers, *Beschwerde bei der Bundesnetzagentur* (Allemagne) et un résultat sur le médiateur bancaire et la BaFin.
- « rupture du contrat de travail par l'employeur » : *Mettre fin à une période d'essai*, puis *Se séparer d'un salarié d'un commun accord* (France).

## Limites

- La recherche par sens utilise un modèle léger. Elle remonte parfois des résultats hors sujet, surtout pour une requête vague.
- Les tags ne couvrent que 3,6 % de la bibliothèque. Le filtre par type de tâche reste donc partiel.
- Le français est peu représenté. Pour une question française, le filtre par pays et par domaine aide beaucoup.
- Une requête sur les frais bancaires en Allemagne donne des résultats faibles, dans les deux modes.
- Les résultats ne sont pas un avis juridique. Les compétences viennent de contributeurs variés, et le projet ne garantit pas leur qualité juridique. Vérifiez chaque point auprès des sources officielles.

## Sécurité et confidentialité

- Le serveur n'envoie aucune requête à un service externe une fois le modèle téléchargé.
- Les résultats que l'assistant reçoit suivent le même chemin que tout contenu renvoyé par un outil, vers le modèle de conversation.
- Le texte des compétences vient d'un tiers. Il est renvoyé encadré comme contenu non fiable, avec un identifiant aléatoire par réponse.
- Les scripts livrés avec certaines compétences sont listés, jamais exécutés.
- Les liens symboliques ne sont jamais suivis. Les identifiants de compétences ne servent jamais de chemins de fichiers.

## Variables d'environnement

- `LEGAL_SKILLS_DIR` indique le dossier de la bibliothèque. Par défaut, il s'agit de `vendor/legal-skills-open`.
- `LEGAL_SKILLS_DATA` indique le dossier des index. Par défaut, il s'agit de `data/`.

## Licences

- Ce dépôt est sous licence MIT. Voir le fichier LICENSE.
- [legal-skills-open](https://github.com/ThomasMoreAI/legal-skills-open) est sous licence Apache-2.0. Chaque compétence indique sa propre licence dans le champ `license`. Vérifiez-la avant toute redistribution.
- Le modèle d'origine, [intfloat/multilingual-e5-small](https://huggingface.co/intfloat/multilingual-e5-small), est sous licence MIT. La version convertie pour ONNX ne déclare pas de licence propre.
