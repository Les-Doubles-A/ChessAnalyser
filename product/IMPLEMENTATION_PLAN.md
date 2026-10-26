# ChessAnalyser : Plan d'implémentation

> Version 1 · 2026-10-24 · Pour confier une tâche à Claude Code : « Implémente T3 de product/IMPLEMENTATION_PLAN.md » ou `/idea-to-product build T3`

## 1. Décisions à prendre avant de coder

| ID | Décision | Options | Recommandation | Bloque |
|---|---|---|---|---|
| D1 | Licence du projet | GPL-3.0 ; code privé jamais distribué | GPL-3.0 : obligatoire dès que le site est publié avec Stockfish | T1 |
| D2 | Framework d'interface | React + TS ; Svelte ; JavaScript sans framework | React + TS : composant d'échiquier MIT prêt, outillage le plus courant | T1 |
| D3 | Composant d'échiquier | react-chessboard (MIT) ; chessground (GPL) | react-chessboard | T4 |
| D4 | Profondeurs des préréglages | Standard 12 à 16 ; Profonde 18 à 22 | **Appliqué en T5 : 14 et 18.** À 20, 3,7 s par position sous Node, soit environ 4 minutes par partie ; à 18, 72 s mesurées dans Chromium pour 37 coups. À revoir en T12 ; recalibrer F6 si elles changent | T5, T10 |
| D5 | Publication | Local seulement ; GitHub Pages ; Cloudflare Pages | Local pendant le MVP, publication après validation (H2) | T12 (publication seulement) |
| D6 | Nom du produit | « ChessAnalyser » ; autre | Garder un nom sans « chess.com » ni marque tierce | Publication |

## 2. Étapes

1. **Fondations** : projet Vite + React + TS, outillage de test, client API, modèle de partie (T1, T2).
2. **Parcours principal** : recherche, liste, échiquier (T3, T4), puis moteur, calculs, barre, courbe, classification (T5 à T8).
3. **Compléments du MVP** : synthèse (T9), calibration et estimation d'Elo (T10, T11).
4. **Validation du MVP** : performance, comparaison des moteurs, sécurité, accessibilité, tests utilisateurs (T12).

## 3. Tranche 1 : premier résultat testable

- **Ce que l'utilisateur pourra faire à la fin** : saisir son pseudo, voir ses parties du mois, en ouvrir une et la rejouer coup par coup au clavier.
- **Tâches incluses** : T1, T2, T3, T4.
- **Comment le tester** : `npm test` passe ; `npm run dev`, saisir son propre pseudo, ouvrir une partie, la rejouer jusqu'au bout (scénarios M1 et M2, sans la partie analyse).

**Tranche 2** (T5 à T8) : l'analyse devient visible ; c'est le moment de commencer l'usage personnel de 2 semaines (H8). **Tranche 3** (T9 à T12) : synthèse, Elo, validation.

## 4. Tâches

### T1 : Fondations du projet

- **Objectif** : un projet qui se construit, se teste et se lance avec une commande chacun.
- **Dépend de** : D1, D2.
- **Fichiers ou composants** : `package.json`, `vite.config.ts`, `tsconfig.json`, `vitest.config.ts`, `playwright.config.ts`, `.gitignore`, `LICENSE`, `README.md`, `src/main.tsx`.
- **À faire** :
  1. `git init`, créer le projet Vite React TypeScript ; vérifier les versions installées contre la section 1 de TECHNICAL_ARCHITECTURE.md.
  2. Installer Vitest, Playwright, ESLint, Prettier ; scripts `dev`, `build`, `test`, `test:engine`, `test:e2e`, `test:all`, `lint`.
  3. `.gitignore` : `node_modules`, `dist`, `public/engine`, `data/`, `.env*`.
  4. `LICENSE` GPL-3.0 ; README avec installation, lancement, tests.
  5. Un test unitaire et un test Playwright triviaux qui passent.
- **Tests** : `npm test`, `npm run test:e2e`.
- **Terminé quand** : `npm install && npm test && npm run test:e2e && npm run build` réussit sur une copie propre du dépôt.
- **Couvre** : fondations (aucun critère directement).
- **Statut** : fait (2026-10-24). Preuve : `npm run test:all` (types, lint, 29 tests unitaires, 38 tests Playwright) et `npm run build` réussis. D1, D2 et D3 appliquées selon les recommandations, sans réponse de l'utilisateur. Écart : TypeScript 6.0.3 au lieu de 7.0.2, car `typescript-eslint` 8.72.0 exige `typescript <6.1.0`. Essai sur une copie propre fait le 2026-10-26 (`npm ci`, Prettier, types, 105 tests unitaires, build) : il a révélé que la règle `data/` du `.gitignore` excluait aussi `src/data/` (base d'ouvertures et modèle Elo absents du dépôt) ; règle ramenée à `/data/`, fichiers versionnés, essai repassé avec succès.

### T2 : Client API chess.com

- **Objectif** : obtenir les parties d'un joueur de façon fiable et polie envers l'API.
- **Dépend de** : T1.
- **Fichiers ou composants** : `src/api/chesscom.ts`, `tests/unit/chesscom.test.ts`, `tests/fixtures/chesscom/*.json`.
- **À faire** :
  1. `validateUsername()` (règle de F1) et `normalizeUsername()`.
  2. File d'attente série : une requête à la fois.
  3. `getArchives(pseudo)`, `getMonth(url)` ; validation champ par champ vers `GameSummary` ; parties invalides ignorées.
  4. Erreurs typées : `NotFound`, `RateLimited` (une nouvelle tentative après 2 s), `Unavailable` (réseau, 5xx), `BadResponse`.
  5. Marquer `supported = rules === "chess"`.
  6. Enregistrer des réponses réelles (petites, anonymisables si besoin) comme fixtures.
- **Tests** : unitaires avec `fetch` simulé : 200, 404, 429 puis 200, 429 puis 429, 500, réseau coupé, JSON non conforme, joueur sans archive, partie de variante, pseudos invalides.
- **Terminé quand** : tous ces cas passent et aucune requête parallèle n'est émise (test qui vérifie le nombre de requêtes en vol).
- **Couvre** : F1, AC-F1-2, AC-F1-3, AC-F1-4, AC-F1-5, AC-F1-6
- **Statut** : fait (2026-10-24). Preuve : `tests/unit/chesscom.test.ts`, 22 tests verts, dont « n'envoie jamais deux requêtes en parallèle ». Les fixtures sont construites au format observé sur l'API plutôt qu'enregistrées, pour ne pas versionner les données de vrais joueurs. Reste **[À vérifier]** : règle exacte des pseudos chess.com.

### T3 : Écrans de recherche et de liste (E1, E2)

- **Objectif** : parcours pseudo vers liste de parties.
- **Dépend de** : T2.
- **Fichiers ou composants** : `src/ui/SearchPage.tsx`, `src/ui/GameList.tsx`, `src/ui/Layout.tsx`, `tests/e2e/search.spec.ts`.
- **À faire** :
  1. Formulaire avec libellé, validation, zone `aria-live` pour les messages.
  2. Liste triée, filtre par cadence, bouton « Mois précédent », état vide, chargement, erreur avec « Réessayer ».
  3. Parties de variante grisées, non cliquables.
  4. Mémoriser `lastUsername` dans `localStorage` (lecture et écriture protégées par `try`).
  5. Pied de page « Projet indépendant, non affilié à Chess.com ».
  6. Mise en page utilisable à 360 px.
- **Tests** : Playwright avec `api.chess.com` simulée : AC-F1-1 à AC-F1-6, présence du pied de page.
- **Terminé quand** : les tests Playwright passent et M1 est réalisé avec un vrai pseudo.
- **Couvre** : F1, AC-F1-1, AC-F1-2, AC-F1-3, AC-F1-4, AC-F1-5, AC-F1-6, AC-X-1
- **Statut** : fait (2026-10-24). Preuve : `tests/e2e/search.spec.ts`, 10 tests verts dans Chromium et Firefox ; `tests/e2e/responsive.spec.ts` vert à 360 px (AC-X-3 pour E1 à E3). Essai automatisé contre la vraie API (build servi par `vite preview`, pseudo public `hikaru`) : 463 parties listées dans Chromium et Firefox, aucune erreur, requêtes limitées à l'origine du site et à `api.chess.com`. Reste à vérifier manuellement : M1 avec le pseudo de l'utilisateur.

### T4 : Modèle de partie, échiquier et navigation

- **Objectif** : rejouer une partie.
- **Dépend de** : T2, D3.
- **Fichiers ou composants** : `src/chess/game.ts`, `src/ui/AnalysisView.tsx`, `src/ui/Board.tsx`, `src/ui/MoveList.tsx`, `tests/unit/game.test.ts`, `tests/e2e/navigation.spec.ts`.
- **À faire** :
  1. `parseGame(pgn)` vers `ParsedGame` (FEN avant et après, SAN, UCI, nombre de coups légaux, horloge `%clk`).
  2. Vérifier l'API de react-chessboard 5 dans sa documentation, puis afficher l'échiquier orienté côté joueur, dernier coup surligné.
  3. Contrôles Début, Précédent, Suivant, Fin ; clavier ; clic dans la liste.
  4. Erreur « Cette partie n'a pas pu être lue. » avec retour.
- **Tests** : unitaires sur 3 PGN réels (victoire, nulle, mat) et 1 PGN corrompu ; Playwright pour le clavier, le clic et le focus.
- **Terminé quand** : tests verts et M2 (sans analyse) réalisé sur une partie réelle.
- **Couvre** : F2, AC-F2-1, AC-F2-2, AC-F2-3, AC-F2-4, AC-F2-5
- **Statut** : fait (2026-10-24). Preuve : `tests/unit/game.test.ts` (7 tests) et `tests/e2e/navigation.spec.ts` (8 tests, Chromium et Firefox) verts. Anomalie corrigée : `react-chessboard` rend les 32 pièces focalisables (`tabIndex=0`, glisser-déposer) ; l'échiquier est donc marqué `inert` et son libellé porté par le conteneur. Reste à vérifier manuellement : M2 (sans la partie analyse) et le lecteur d'écran (M5).

### T5 : Adaptateur moteur et orchestrateur d'analyse

- **Objectif** : évaluer toutes les positions sans figer l'interface.
- **Dépend de** : T4, D4.
- **Fichiers ou composants** : `scripts/copy-engine.mjs`, `src/engine/uci.ts`, `src/engine/worker-engine.ts`, `src/engine/node-engine.ts`, `src/analysis/runAnalysis.ts`, `tests/unit/uci.test.ts`, `tests/unit/runAnalysis.test.ts`, `tests/engine/node-engine.test.ts`.
- **À faire** :
  1. Repérer dans `node_modules/stockfish` les fichiers lite mono-thread et les copier dans `public/engine/` au build.
  2. Analyseur de lignes UCI (score cp et mate, pv, bestmove), conversion au point de vue des blancs.
  3. Adaptateur Worker et adaptateur Node derrière la même interface.
  4. Orchestrateur : N+1 positions en série, mat et pat sans moteur, progression, annulation via `AbortSignal`, analyse incomplète conservée.
  5. Indicateur de progression, bouton Annuler, message si le moteur ne démarre pas ; vérifier la politique de sécurité du contenu nécessaire au WASM.
- **Tests** : unitaires avec moteur simulé (progression, annulation, mat, pat, erreur de démarrage) ; intégration Node : mat en 1 trouvé, position initiale proche de 0 ; Playwright : progression visible, Suivant réactif pendant l'analyse.
- **Terminé quand** : `npm run test:all` passe et une partie réelle est entièrement analysée dans Chrome (M3).
- **Couvre** : F3, AC-F3-1, AC-F3-2, AC-F3-3, AC-F3-4, AC-F3-6
- **Statut** : fait (2026-10-24). Preuves : `tests/unit/uci.test.ts` et `runAnalysis.test.ts` verts ; `npm run test:engine` (4 tests avec le vrai Stockfish sous Node, analyse reproductible d'une exécution à l'autre) ; `tests/e2e/eval.spec.ts` (faux moteur UCI scripté : progression, Suivant < 200 ms, annulation < 1 s, moteur en 404) ; `moves.spec.ts` (vrai Stockfish dans Chromium et Firefox). Essai réel (build servi par `vite preview`, vraie API, partie de 37 coups) : Standard en 8,6 s (Chromium) et 6,9 s (Firefox), résultats identiques dans les deux navigateurs ; Profonde en 72 s. Ajout : `UciEngine.fail()` pour échouer immédiatement si le worker plante. Reste : politique de sécurité du contenu (`'wasm-unsafe-eval'`), reportée en T12 avec AC-X-2.

### T6 : Calculs purs et base d'ouvertures

- **Objectif** : transformer les évaluations en Win%, pertes, catégories, précisions, ouverture.
- **Dépend de** : T1.
- **Fichiers ou composants** : `src/analysis/winPercent.ts`, `accuracy.ts`, `classify.ts`, `openings.ts`, `scripts/build-openings.ts`, `src/data/openings.json`, `tests/unit/analysis.test.ts`, `tests/fixtures/game-ref-01.*`.
- **À faire** :
  1. Win% (formule Lichess), conversion du mat en Win% 0 ou 100.
  2. Lire dans le code source de Lichess (dépôt lichess-org/lila) le calcul exact de la précision de partie et de la taille des fenêtres ; l'implémenter ; noter la source et le commit dans un commentaire.
  3. Classification selon la table de F5 (Livre, Forcé, Meilleur, seuils).
  4. Script qui télécharge les TSV de lichess-org/chess-openings et produit `openings.json` (EPD vers ECO et nom).
  5. Partie de référence `game-ref-01` : évaluations figées et valeurs attendues calculées à la main ou par un script indépendant.
- **Tests** : valeurs limites des seuils, Forcé, Livre puis hors livre, Win%(150) = 63,47, mat, précision de la partie de référence.
- **Terminé quand** : tests verts ; `openings.json` généré et versionné.
- **Couvre** : F4, F5, AC-F4-1, AC-F4-2, AC-F5-1, AC-F5-2, AC-F5-3, AC-F5-5
- **Statut** : fait (2026-10-24). Preuve : `tests/unit/analysis.test.ts` vert, dont les 11 cas de `AccuracyPercentTest.scala` (lila) portés avec leurs tolérances, et `game-ref-01` à 0,1 près contre une implémentation Python indépendante. Source lue : lila `modules/analyse/src/main/AccuracyPercent.scala` et scalachess `eval.scala` (plafond ±1000 cp, mat ramené au plafond). `openings.json` : 3865 positions nommées et 4117 positions intermédiaires (723 Ko, 93 Ko compressés, chargé à la demande). **Changement de règle** : la base Lichess nomme aussi des pièges (« Fool's Mate »), donc un coup « livre » qui perd 5 points ou plus est classé selon sa perte (table de F5 mise à jour). Reste **[À vérifier]** : écart type de population ou d'échantillon dans scalalib.

### T7 : Barre et courbe d'évaluation

- **Objectif** : affichage F4.
- **Dépend de** : T5, T6.
- **Fichiers ou composants** : `src/ui/EvalBar.tsx`, `src/ui/EvalGraph.tsx`, `tests/e2e/eval.spec.ts`.
- **À faire** :
  1. Barre : hauteur selon Win%, libellé, état « … », orientation.
  2. Courbe SVG : points, repère de position, marqueurs `?!`, `?`, `??`, clic et clavier, libellé accessible.
  3. Disposition sous l'échiquier à 360 px.
- **Tests** : unitaires de rendu (valeurs de hauteur et libellés) ; Playwright : clic sur la courbe déplace l'échiquier.
- **Terminé quand** : tests verts et vérification visuelle dans Chrome et Firefox.
- **Couvre** : F4, AC-F4-1, AC-F4-2, AC-F4-3, AC-F4-4, AC-F4-5
- **Statut** : fait (2026-10-24). Preuve : `tests/e2e/eval.spec.ts` (faux moteur : +1.5 et 63 % de blanc, -M3 et barre noire, clic sur la courbe, état « … », marqueurs `?`/`??` activables au clavier) vert dans Chromium et Firefox ; `responsive.spec.ts` vert à 360 px après affinement de la barre. Captures vérifiées : ordinateur en thème clair, 360 px en thème sombre. Reste à vérifier manuellement : lecteur d'écran (M5).

### T8 : Affichage de la classification et du meilleur coup

- **Objectif** : rendre F5 visible dans la liste des coups et le panneau.
- **Dépend de** : T5, T6.
- **Fichiers ou composants** : `src/ui/MoveList.tsx`, `src/ui/MovePanel.tsx`, `src/ui/Board.tsx`, `src/ui/categories.ts`.
- **À faire** :
  1. Symbole, libellé et couleur propres par catégorie ; aucun élément visuel chess.com.
  2. Panneau du coup courant : catégorie, meilleur coup en SAN, évaluation avant et après.
  3. Flèche du meilleur coup sur l'échiquier affiché pour Imprécision, Erreur, Gaffe.
  4. Précision des deux joueurs en tête de liste.
- **Tests** : Playwright sur une partie simulée avec évaluations figées : flèche présente, texte du panneau, libellés texte des catégories.
- **Terminé quand** : tests verts ; revue visuelle M2 faite.
- **Couvre** : F5, AC-F5-4, AC-F5-5, AC-F5-6
- **Statut** : fait (2026-10-24). Preuve : `tests/e2e/moves.spec.ts` vert dans Chromium et Firefox (catégories nommées dans le libellé accessible, symboles `L`, `□`, `!`, `?!`, `?`, `??`, panneau « Meilleur coup : e4 », flèche e2-e4, précision « 82,8 »). **Écart avec la spécification** : la flèche est dessinée sur l'échiquier affiché (après le coup joué), pas sur la position d'avant, pour que la navigation reste continue ; AC-F5-4 reformulé. Corrigé après revue visuelle : contraste du coup courant, défilement automatique de la liste. Reste : provenance et licence des pièces par défaut de `react-chessboard` **[À vérifier]** ; revue visuelle M2 par l'utilisateur.

### T9 : Synthèse de la partie

- **Objectif** : panneau E4 sans l'Elo (ajouté en T11).
- **Dépend de** : T6, T8.
- **Fichiers ou composants** : `src/analysis/keyMoments.ts`, `src/ui/Summary.tsx`, `tests/unit/keyMoments.test.ts`, `tests/e2e/summary.spec.ts`.
- **À faire** :
  1. Compteurs par catégorie et par joueur.
  2. Ouverture : plus long préfixe trouvé.
  3. Moments clés : 3 pertes de 10 ou plus, ordre chronologique, navigation.
  4. Lien « Voir sur chess.com ».
  5. États « Disponible à la fin de l'analyse » et « Analyse incomplète ».
- **Tests** : unitaires (somme des compteurs, préfixe d'ouverture, aucune erreur majeure) ; Playwright (clic sur moment clé, attributs du lien).
- **Terminé quand** : tests verts ; M4 réalisé.
- **Couvre** : F7, AC-F7-1, AC-F7-2, AC-F7-3, AC-F7-4
- **Statut** : fait (2026-10-26). Preuve : `tests/unit/keyMoments.test.ts` (6 tests : sommes des compteurs en analyse complète et partielle, ouverture au plus long préfixe, position nommée hors préfixe ignorée, 3 moments clés chronologiques, aucune erreur majeure) ; `tests/e2e/summary.spec.ts` (4 tests, Chromium et Firefox : compteurs, ouverture, clic et clavier sur les moments clés, attributs du lien, « Aucune erreur majeure », « Disponible à la fin de l'analyse », « Analyse incomplète : synthèse partielle »). Choix : les coups non analysés sont comptés dans une ligne « Non analysé », pour que AC-F7-1 tienne aussi en analyse partielle ; les moments clés ne retiennent que les coups classés Erreur ou Gaffe (perte de 10 ou plus, hors coups forcés, livre ou meilleurs). La précision reste affichée au-dessus de la synthèse, comme en T8. Reste à vérifier manuellement : M4 sur une partie réelle.

### T10 : Jeu de calibration Elo

- **Objectif** : disposer de parties analysées avec classement connu.
- **Dépend de** : T5 (adaptateur Node), T6, D4.
- **Fichiers ou composants** : `scripts/collect-games.ts`, `scripts/analyse-dataset.ts`, `data/` (non versionné).
- **À faire** :
  1. Collecte en série, User-Agent identifiable avec contact, pause entre requêtes, reprise après interruption : partir de quelques joueurs de niveaux variés, puis de leurs adversaires, jusqu'à au moins 2300 parties classées `rules = chess` réparties de 400 à 2600 Elo et par cadence.
  2. Ne conserver que pseudo haché, classements, cadence, PGN ; pas d'autre donnée personnelle.
  3. Analyse Node de chaque partie avec le préréglage Standard puis Profonde, reprise possible.
  4. Séparer de façon fixe (graine) 2000 parties de calibration et au moins 300 de validation, en mettant toutes les parties d'un même joueur du même côté.
- **Tests** : unitaires de la sélection et de la séparation ; exécution réduite sur 20 parties.
- **Terminé quand** : `data/calibration.jsonl` et `data/validation.jsonl` existent avec les effectifs visés et un rapport de répartition par tranche d'Elo.
- **Couvre** : F6, AC-F6-4 (préparation des données)
- **Statut** : scripts faits (2026-10-26), collecte complète à lancer. Preuve : `tests/unit/dataset.test.ts` (9 tests : tranches, éligibilité, quotas, plafond par joueur, priorité des tranches vides, anonymisation du PGN, pseudonymes, séparation fixe par joueur) ; exécution réduite réelle : 20 parties collectées (8 joueurs visités), 20 analysées en Standard (5,8 s par partie sous Node), séparation et rapport écrits. Choix : quotas de 65 parties par tranche de 200 points pour bullet, blitz et rapide, 20 pour daily (2365 au total) ; tranche d'une partie = moyenne des deux classements ; au plus 3 parties par joueur visité ; départ depuis `/pub/titled/{titre}` et `/pub/country/{iso}/players`, puis les adversaires. Pseudos et URL remplacés par un HMAC à clé locale (`data/secret.txt`) ; PGN réduit aux en-têtes `Result`, `TimeControl`, `SetUp`, `FEN`. **Écart** : l'unité de séparation est la partie vue d'un joueur (deux échantillons par partie), seule façon de mettre tous les échantillons d'un joueur du même côté ; une partie peut donc avoir un côté en calibration et l'autre en validation. Les effectifs visés sont comptés en parties distinctes. Les scripts tournent avec le TypeScript natif de Node 24 et un crochet de résolution (`scripts/ts-hooks.mjs`), sans dépendance ajoutée. Durées estimées : collecte environ 1 h ; analyse Standard environ 4 h ; Profonde environ 10 fois plus.

### T11 : Modèle et affichage de l'estimation d'Elo

- **Objectif** : F6 complet.
- **Dépend de** : T9, T10.
- **Fichiers ou composants** : `scripts/calibrate-elo.ts`, `scripts/validate-elo.ts`, `src/data/elo-model.json`, `src/analysis/elo.ts`, `src/ui/Summary.tsx`, `tests/unit/elo.test.ts`.
- **À faire** :
  1. Régression sur les variables de F6, par préréglage, avec quantiles des résidus pour l'intervalle à 80 %.
  2. Validation sur le jeu séparé ; écrire le rapport (erreur médiane, couverture, par tranche d'Elo et par cadence).
  3. Si AC-F6-4 échoue : appliquer le repli de H7 (fourchette large) et le noter ici.
  4. Affichage dans la synthèse, mentions « confiance faible » et « Partie trop courte… ».
- **Tests** : unitaires (bornes, arrondi à 50, partie courte, analyse incomplète) ; `npm run elo:validate`.
- **Terminé quand** : rapport de validation joint au dépôt et tests verts.
- **Couvre** : F6, AC-F6-1, AC-F6-2, AC-F6-3, AC-F6-4, AC-F6-5
- **Statut** : à faire

### T12 : Validation du MVP

- **Objectif** : vérifier les critères qui demandent un environnement réel et trancher H5, H6, D4.
- **Dépend de** : T11.
- **Fichiers ou composants** : `index.html` (politique de sécurité du contenu), `tests/e2e/privacy.spec.ts`, `docs/validation.md`.
- **À faire** :
  1. Chronométrer 5 parties de 40 coups environ en Standard et Profonde sur la machine de référence ; ajuster D4 si besoin (puis relancer T10 et T11).
  2. Comparer sur 50 parties les gaffes détectées par le moteur lite et par le moteur complet (Node) ; consigner le taux d'accord (H5).
  3. Test Playwright qui liste toutes les requêtes réseau du parcours P1.
  4. Contrôle à 360 px et passe d'accessibilité au clavier et au lecteur d'écran (NVDA ou Narrateur).
  5. Scénarios manuels M1 à M5 dans Chrome et Firefox.
- **Tests** : `npm run test:all`, scénarios M1 à M5.
- **Terminé quand** : le tableau de validation de RISKS_AND_TESTS.md section 6 est entièrement coché, avec la preuve de chaque ligne dans `docs/validation.md`.
- **Couvre** : F3, AC-F3-5, AC-X-2, AC-X-3
- **Statut** : à faire

### T13 : Variantes (F10 avancée à la demande de l'utilisateur)

- **Objectif** : jouer d'autres coups que ceux de la partie et voir ce que le moteur en pense.
- **Fichiers ou composants** : `src/chess/variation.ts`, `src/ui/Variation.tsx`, `src/ui/useVariationEvals.ts`, `src/ui/Board.tsx`, `src/ui/MovePanel.tsx`, `src/ui/AnalysisView.tsx`, `tests/unit/variation.test.ts`, `tests/e2e/variation.spec.ts`.
- **Comportement** : bouton « Explorer des variantes » qui rend l'échiquier jouable (glisser-déposer, ou clic sur la pièce puis sur la case) et affiche une saisie au clavier (notation anglaise `Nf3`, française `Cf3` ou par cases `g1f3`). Le coup réellement joué fait avancer dans la partie ; tout autre coup ouvre une variante depuis la position affichée, ou remplace la suite de la variante à partir du coup affiché. Bouton « Essayer <meilleur coup> » sur les imprécisions, erreurs et gaffes. Chaque position de la variante est évaluée avec le moteur partagé, au préréglage de la partie ; panneau de variante avec coups classés, évaluation, suite du moteur en notation algébrique, flèche du coup conseillé, bouton « Coup du moteur » et « Revenir à la partie ». Flèches et Précédent/Suivant parcourent la variante, Échap revient à la partie.
- **Garde-fou R8** : une variante part toujours d'une position d'une partie terminée des archives ; aucune saisie libre de position.
- **Limites** : une seule variante à la fois (pas d'arbre) ; promotion en dame au glisser-déposer (autre pièce par la saisie, `a8=N`) ; une seule ligne du moteur (pas de multi-lignes).
- **Statut** : fait (2026-10-26). Preuve : `tests/unit/variation.test.ts` (11 tests) ; `tests/e2e/variation.spec.ts` (5 tests, Chromium et Firefox : essayer le meilleur coup, saisie française, coup refusé, navigation et Échap, coup du moteur et flèche, clic puis case et glisser-déposer, échiquier inerte hors exploration) ; suite complète verte (91 tests unitaires, 84 Playwright) ; captures vérifiées à 1280 et 360 px.

## 5. Peut attendre

| Élément | Pourquoi attendre | Déclencheur |
|---|---|---|
| Publication en ligne (D5) | Le MVP se valide en local | Validation T12 et décision H2 |
| Cache IndexedDB (F9) | Le parcours fonctionne sans | Plus de 3 parties rouvertes par semaine |
| Moteur complet (F16) | 94 Mo, en-têtes COOP/COEP | H5 infirmée en T12 |
| Requêtes conditionnelles (`ETag`) | Optimisation | Lenteur ou 429 observés |
| Traduction | Public francophone d'abord (H9) | Testeurs non francophones |
