# ChessAnalyser

Dépôt GitHub : **https://github.com/Les-Doubles-A/ChessAnalyser**

Revue de parties chess.com calculée dans le navigateur : on saisit un pseudo, on choisit une partie, puis Stockfish analyse chaque position. Le site affiche la barre et la courbe d'évaluation, la classification de chaque coup, le meilleur coup et la précision des deux joueurs. La synthèse et l'estimation d'Elo arrivent dans la tranche suivante (voir `product/IMPLEMENTATION_PLAN.md`).

Projet indépendant, non affilié à Chess.com. Les parties sont lues sur l'API publique de chess.com ; aucune donnée n'est envoyée ailleurs. Le calcul se fait entièrement dans le navigateur.

## Prérequis

- Node.js 24 et npm 11 (versions utilisées pendant le développement)

## Installation

```sh
npm install
npx playwright install chromium firefox   # navigateurs des tests de bout en bout
```

## Commandes

| Commande              | Rôle                                                                                    |
| --------------------- | --------------------------------------------------------------------------------------- |
| `npm run dev`         | Copie le moteur puis lance le serveur de développement (http://localhost:5173)          |
| `npm run build`       | Copie le moteur, vérifie les types, build statique dans `dist/`                         |
| `npm test`            | Tests unitaires (Vitest)                                                                |
| `npm run test:engine` | Tests d'intégration avec le vrai Stockfish sous Node                                    |
| `npm run test:e2e`    | Tests de bout en bout (Playwright, Chromium et Firefox, API chess.com simulée)          |
| `npm run test:all`    | Types, lint, tests unitaires, moteur et bout en bout                                    |
| `npm run engine`      | Copie `stockfish-19-lite-single` (.js et .wasm) de `node_modules` vers `public/engine/` |
| `npm run openings`    | Régénère `src/data/openings.json` depuis lichess-org/chess-openings (CC0)               |
| `npm run lint`        | ESLint                                                                                  |
| `npm run format`      | Prettier                                                                                |

## Jeu de calibration de l'Elo

Trois scripts Node préparent, dans `data/` (exclu de git, jamais publié), les parties qui servent à calibrer l'estimation d'Elo. Chacun reprend là où il s'est arrêté si on le relance.

| Commande                                     | Rôle                                                                                                                                      |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dataset:collect -- [--max-games N]` | Collecte en série sur l'API chess.com (User-Agent avec contact) environ 2365 parties classées, réparties de 400 à 2600 Elo et par cadence |
| `npm run dataset:analyse -- [--preset deep]` | Analyse chaque partie avec Stockfish sous Node (Standard par défaut, environ 6 s par partie)                                              |
| `npm run dataset:split`                      | Sépare de façon fixe calibration et validation par joueur, écrit le rapport de répartition                                                |

Ensuite, `npm run elo:calibrate` ajuste le modèle sur `data/calibration.jsonl` et l'écrit dans `src/data/elo-model.json` (versionné, embarqué dans le site) ; `npm run elo:validate` le contrôle sur les joueurs de `data/validation.jsonl` et écrit `docs/elo-validation-<préréglage>.md` (statistiques agrégées seulement). Les deux acceptent `-- --preset deep`.

Seuls sont conservés les classements, la cadence, les coups et des pseudonymes (HMAC avec une clé locale `data/secret.txt`). La file d'attente de la collecte (`data/collect-state.json`) contient des pseudos en clair ; elle est supprimée quand les quotas sont atteints.

## Organisation

```
src/api/        client de l'API publique chess.com (requêtes en série)
src/chess/      lecture des PGN (chess.js)
src/engine/     dialogue UCI, Stockfish en Web Worker (site) ou sous Node (tests, scripts)
src/analysis/   probabilité de gain, précision (algorithme Lichess), classification, ouvertures
src/data/       base d'ouvertures générée
src/ui/         composants React
scripts/        copie du moteur, base d'ouvertures, jeu de calibration de l'Elo
tests/unit/     tests Vitest
tests/engine/   tests avec le vrai moteur
tests/e2e/      tests Playwright (dont un faux moteur UCI scripté)
tests/fixtures/ réponses chess.com fictives, partie de référence
product/        cadrage : brief, critères d'acceptation, architecture, plan, risques
```

## Licence

GPL-3.0-or-later (voir `LICENSE`). Ce choix est imposé par Stockfish (GPL-3.0), embarqué dans le site ; sa licence est copiée dans `public/engine/COPYING-stockfish.txt`. La base d'ouvertures vient de lichess-org/chess-openings (CC0-1.0). La formule de précision reprend l'algorithme publié par Lichess.

<!-- installeur-release -->
## Installation

Téléchargez **`ChessAnalyser-Setup-0.1.1.exe`** depuis la [dernière release](https://github.com/Les-Doubles-A/ChessAnalyser/releases/latest), puis lancez-le.

L'application s'installe pour l'utilisateur courant (sans droits administrateur). Le raccourci du menu Démarrer lance un petit serveur local (http://localhost:51730) et ouvre le navigateur ; le serveur s'arrête seul après 15 minutes sans activité.

L'installeur n'est pas signé : si Windows SmartScreen l'affiche, cliquez sur « Informations complémentaires » puis « Exécuter quand même ».

### Recréer l'installeur

Compiler l'application (`npm run build`), puis lancer [Inno Setup 6](https://jrsoftware.org/isinfo.php) : `iscc installer\ChessAnalyser.iss`. Le setup est créé dans `installer\Output\`.
