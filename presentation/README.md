# Présentation de legal-skills-mcp

Le projet legal-skills-mcp est un serveur MCP, c'est-à-dire un programme qui fournit des outils à un assistant comme Claude. Lancé en local et relié par stdio, il lui permet de chercher dans [legal-skills-open](https://github.com/ThomasMoreAI/legal-skills-open), une bibliothèque de 20 293 compétences juridiques publiée par ThomasMoreAI.

Une compétence est un fichier SKILL.md : un en-tête qui donne notamment un nom et une description, puis un texte qui guide l'assistant dans une tâche juridique. Certaines ont aussi des fichiers annexes.

## À quoi il sert

Face à une demande, le serveur retrouve les compétences les plus proches, que la requête reprenne leurs mots ou seulement leur sens, au besoin dans une seule juridiction ou une seule langue. L'assistant peut ensuite lire en entier celle qu'il retient.

## La bibliothèque en chiffres

Les compétences relèvent de 74 codes de juridiction et de 48 domaines de pratique, appelés thèmes. Elles sont écrites en 20 langues, de façon très inégale : 15 210 en allemand (75 %), 3 736 en anglais (18 %), puis 471 en espagnol, 294 en portugais, 245 en chinois et seulement 109 en français, soit 0,5 %.

Seules 733 compétences portent des tags, soit environ 3,6 %. Les plus fréquents sont "drafting" (407), "agreement" (194), "transactional" (168) et "litigation" (110).

## Trois outils en lecture seule

- `search_legal_skills` cherche par mots-clés, par sens ou en combinant les deux. Il accepte des filtres par juridiction, langue, domaine et tag, et renvoie jusqu'à 25 résultats.
- `get_legal_skill` renvoie le fichier SKILL.md complet, jusqu'à 200 000 caractères, avec la liste de ses fichiers annexes.
- `list_legal_facets` compte les compétences par langue, juridiction, domaine et tag, pour parcourir la bibliothèque pas à pas.

## Comment fonctionne la recherche

| Mode | Principe |
| --- | --- |
| Hybride (hybrid, par défaut) | Prend tour à tour le meilleur résultat par mots-clés et le meilleur résultat par sens, sans doublon |
| Mots-clés (keyword) | Classe les compétences d'après les mots de la requête |
| Sens (semantic) | Classe les compétences d'après le sens de la requête |

En mode hybride, quand la recherche par mots-clés trouve quelque chose, son meilleur résultat occupe la première place, et le meilleur résultat par sens la deuxième.

La recherche par mots-clés utilise BM25, une méthode classique, sur le titre (poids 3), le nom et les tags (poids 2), la description (poids 2) et le début du texte (poids 1). Elle ignore les accents et accepte les deux graphies des umlauts allemands, ü et ue. Un glossaire écrit à la main relie 19 notions juridiques d'une langue à l'autre ; les équivalents qu'il fournit comptent pour moitié.

La recherche par sens utilise le modèle intfloat/multilingual-e5-small, dans sa version ONNX en 8 bits (Xenova/multilingual-e5-small), qui tourne sur la machine. Il transforme le titre, la description et les tags de chaque compétence en un vecteur de 384 dimensions, une suite de nombres qui décrit son sens. La requête passe par le même modèle avant d'être comparée à ces vecteurs. Ceux-ci tiennent dans un fichier de 31 Mo et se calculent une seule fois avec `npm run build:embeddings` : environ 11 minutes, et environ 118 Mo à télécharger la première fois.

## Résultats mesurés

Le mode hybride et le mode mots-clés ont été comparés sur six requêtes, avec la bibliothèque complète. Quatre d'entre elles sont présentées ici.

- "réclamation consommateur" : *Complaint Letter Writer* arrive en tête dans les deux modes. Le mode hybride ajoute *Digital Consumer Claims Triage* aux quatre premiers résultats.
- "Beschwerde gegen eine Bank wegen unberechtigter Gebühren" (réclamation contre une banque pour des frais injustifiés) : seul le mode hybride fait entrer dans les quatre premiers la compétence de réclamation auprès de la Bundesnetzagentur et une compétence allemande sur le médiateur et la BaFin. Les résultats restent faibles dans l'ensemble.
- "rupture du contrat de travail par l'employeur" : les deux modes renvoient les quatre mêmes compétences françaises de droit du travail (fin de période d'essai, séparation d'un commun accord, revue du contrat de travail, congés payés).
- "保密协议审查" (examen d'un accord de confidentialité, en chinois) : les deux modes placent une compétence générique, "/review", en tête, et la compétence au titre exact en deuxième place. Le mode hybride remplace en outre un résultat générique, "/customize", par une compétence de révision de contrat en chinois.

Sur les six requêtes, le mode hybride ne dégrade aucun premier résultat, et il améliore le top 4 pour trois d'entre elles.

Sur un poste Windows 11 à 6 processeurs logiques, la connexion prend environ 1,5 s avec le cache. La première recherche demande environ 20 s, le temps de charger le modèle et les vecteurs, et les suivantes environ 0,2 s. Sans cache, le démarrage prend environ 90 s. Les 67 tests automatisés passent.

## Limites

- Le modèle de sens est léger : pour une requête vague, il remonte parfois des résultats hors sujet.
- Les tags ne couvrent qu'environ 3,6 % de la bibliothèque, ce qui limite le filtre par tag.
- Le français est peu représenté.
- La requête allemande sur les frais bancaires reste mal servie, même en mode hybride.
- Le glossaire, écrit à la main, ne couvre pas tout le droit.
- Les résultats ne sont pas un avis juridique, et le projet ne garantit pas la qualité juridique des compétences, rédigées par des tiers. Vérifiez chaque point auprès des sources officielles et faites appel à un avocat pour toute affaire importante.

## Sécurité et licences

Une fois le modèle téléchargé, le serveur lui-même n'envoie aucune requête à un service externe. Le texte des compétences vient de tiers : le serveur le renvoie balisé comme contenu non fiable. Aucun script livré avec une compétence n'est exécuté. Les liens symboliques ne sont jamais suivis, et les alias YAML sont refusés.

Ce dépôt est sous licence MIT (voir [LICENSE](../LICENSE)). La bibliothèque legal-skills-open est sous licence Apache-2.0, et chaque compétence précise sa propre licence dans son en-tête. Le modèle d'origine, intfloat/multilingual-e5-small, est sous licence MIT ; sa conversion ONNX ne déclare pas de licence propre.

## Par où commencer

Le [README.md](../README.md), à la racine du dépôt, décrit l'installation et donne les détails techniques. Le code est sur [github.com/T-Celor/legal-skills-mcp](https://github.com/T-Celor/legal-skills-mcp).

Dans Claude Code, le fichier .mcp.json du projet déclare le serveur, et `claude mcp list` l'affiche comme connecté. L'assistant peut alors commencer par `list_legal_facets` pour voir combien de compétences existent dans une langue ou une juridiction, chercher avec `search_legal_skills`, puis lire une compétence avec `get_legal_skill`.
