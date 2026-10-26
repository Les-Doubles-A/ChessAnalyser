# ChessAnalyser : Risques et tests

> Version 1 · 2026-10-24
> Légende : **[Fait]** · **[H#]** hypothèse · **[Reco]** recommandation · **[À vérifier]**

## 1. Risques

| ID | Risque | Type | Probabilité | Impact | Prévention | Repli |
|---|---|---|---|---|---|---|
| R1 | chess.com retire le CORS, change l'API ou bloque l'accès | Plateforme | Faible | Fort | Requêtes en série, client isolé dans `src/api/`, fixtures pour détecter un changement de format | Import PGN (F8) avancé en priorité ; à défaut, petit proxy serverless |
| R2 | Défi Cloudflare ou blocage pendant la collecte du jeu de calibration (observé pour curl sans User-Agent le 2026-10-24) | Plateforme | Moyenne | Moyen | User-Agent identifiable avec contact, série stricte, pauses, reprise | Télécharger les PGN mensuels depuis le navigateur et les importer dans le script |
| R3 | Analyse trop lente sur machine modeste ou téléphone | Technique | Moyenne | Moyen | Variante lite, profondeur fixe réglable (D4), progression et annulation | Préréglage « Rapide » plus bas ; F9 pour ne pas réanalyser |
| R4 | Estimation d'Elo trop imprécise pour être utile (H7) | Technique | Forte | Moyen | Calibration sur vraies parties, intervalle affiché, seuil AC-F6-4 | Fourchette large, ou Elo agrégé sur 10 parties (F11) |
| R5 | Obligations GPL-3.0 non respectées à la publication | Légal | Faible | Fort | D1 tranchée en T1, LICENSE et lien vers le code source sur le site | Ne pas publier tant que le code n'est pas public |
| R6 | Reprise involontaire d'éléments visuels chess.com (glyphes, palettes, pièces, sons) | Légal | Moyenne | Moyen | Identité visuelle propre, critère AC-F5-6, mention AC-X-1 | Remplacer l'élément signalé |
| R7 | Classification différente de celle de chess.com, ce qui déroute les utilisateurs | Fonctionnel | Forte | Faible | Méthode expliquée dans une aide courte ; libellés propres | Ajuster les seuils après retours (T12) |
| R8 | Usage pendant une partie en cours (triche) | Légal | Faible | Moyen | MVP limité aux parties terminées issues des archives, aucune saisie de position | Garde-fous à définir avant F10 |
| R9 | Fichier `.wasm` mal servi par l'hébergeur (type MIME) ou bloqué par la politique de sécurité | Plateforme | Moyenne | Moyen | Test de build local puis sur l'hébergeur choisi | Changer d'hébergeur ou ajouter un en-tête de configuration |
| R10 | Formule de précision mal reproduite (taille des fenêtres non vérifiée) | Technique | Moyenne | Faible | Lecture du code source Lichess en T6, partie de référence | Documenter l'écart et garder la méthode |
| R11 | Partie jouée récemment absente (rafraîchissement de l'API toutes les 12 à 24 h) | Plateforme | Forte | Faible | Message explicatif dans E2 | Import PGN (F8) |
| R12 | Tests de bout en bout instables sous forte charge (vrai Stockfish en parallèle dans Chromium et Firefox) : 3 échecs intermittents lors d'une exécution sur trois le 2026-10-24, aucun en exécution isolée | Technique | Moyenne | Faible | Délais d'attente élargis ; faux moteur UCI pour les tests d'interface | Limiter `workers` dans `playwright.config.ts` si cela se reproduit |

## 2. Hypothèses non vérifiées

| ID | Hypothèse | Comment la vérifier | Quand | Ce qu'on fait si elle est fausse |
|---|---|---|---|---|
| H1 | Le site web suffit | Chronométrage T12 ; avis de l'utilisateur | Fin de T12 | Empaquetage bureau en V2 |
| H2 | Usage privé d'abord | Décision de l'utilisateur | Avant publication | Mentions légales, page confidentialité |
| H3 | Zéro coût récurrent | Revue des coûts à la publication | D5 | Réévaluer un serveur d'analyse |
| H4 | Échecs standard seulement | Part des variantes dans l'historique de l'utilisateur (M1) | Tranche 1 | Ajouter le 960 |
| H5 | Moteur lite suffisant | Accord des gaffes lite contre complet sur 50 parties, seuil 90 % | T12 | F16 en priorité |
| H6 | 60 s pour 40 coups en Standard | AC-F3-5 | T12 | Baisser D4 |
| H7 | Elo estimable sur une partie | AC-F6-4 | T11 | Repli de R4 |
| H8 | Intérêt des joueurs | Usage personnel 2 semaines puis 5 testeurs (M5) | Après tranche 2, après MVP | Garder un usage personnel |
| H9 | Français seulement | Retours testeurs | Après MVP | Externaliser les textes |

## 3. Stratégie de test

| Niveau | Outil | Ce qui est couvert | Quand l'exécuter |
|---|---|---|---|
| Unitaire | Vitest | Client API (fetch simulé), modèle de partie, analyse UCI, Win%, précision, classification, ouvertures, moments clés, Elo | À chaque modification |
| Intégration | Vitest (Node) + Stockfish | Adaptateur moteur Node sur positions connues | Avant chaque commit touchant `src/engine/` |
| Bout en bout | Playwright (Chromium, Firefox) | Parcours P1 et P2 avec API chess.com simulée et vrai moteur ; requêtes réseau | Avant chaque fin de tranche |
| Validation modèle | `npm run elo:validate` | AC-F6-4 | À chaque recalibration |
| Manuel | Chrome et Firefox sur la machine de référence | Rendu, performance, lecteur d'écran, vraie API | Avant chaque fin de tranche |

**Machine de référence** : l'ordinateur Windows 11 de l'utilisateur ; processeur, mémoire et versions des navigateurs consignés dans `docs/validation.md` en T12.

**Commande unique** : `npm test` (rapide) ; `npm run test:all` (avec moteur et bout en bout).

## 4. Couverture des critères d'acceptation

| Critère | Vérification | Test ou scénario | Tâche |
|---|---|---|---|
| AC-F1-1 | Automatique + manuelle | `tests/e2e/search.spec.ts` ; M1 | T3 |
| AC-F1-2 | Automatique | `tests/unit/chesscom.test.ts` ; `search.spec.ts` | T2, T3 |
| AC-F1-3 | Automatique | `chesscom.test.ts` ; `search.spec.ts` | T2, T3 |
| AC-F1-4 | Automatique | `chesscom.test.ts` ; `search.spec.ts` | T2, T3 |
| AC-F1-5 | Automatique | `chesscom.test.ts` ; `search.spec.ts` | T2, T3 |
| AC-F1-6 | Automatique | `chesscom.test.ts` ; `search.spec.ts` | T2, T3 |
| AC-F2-1 | Automatique + manuelle | `tests/e2e/navigation.spec.ts` ; M2 | T4 |
| AC-F2-2 | Automatique | `navigation.spec.ts` | T4 |
| AC-F2-3 | Automatique | `navigation.spec.ts` | T4 |
| AC-F2-4 | Automatique | `tests/unit/game.test.ts` ; `navigation.spec.ts` | T4 |
| AC-F2-5 | Automatique + manuelle | `navigation.spec.ts` ; M5 | T4 |
| AC-F3-1 | Automatique | `tests/unit/runAnalysis.test.ts` ; `eval.spec.ts` | T5 |
| AC-F3-2 | Automatique + manuelle | `eval.spec.ts` (temps de réponse) ; M3 | T5 |
| AC-F3-3 | Automatique | `runAnalysis.test.ts` ; `eval.spec.ts` (annulation < 1 s) | T5 |
| AC-F3-4 | Automatique | `runAnalysis.test.ts` (démarrage en échec) | T5 |
| AC-F3-5 | Manuelle | M3 (chronométrage) | T12 |
| AC-F3-6 | Automatique | `runAnalysis.test.ts` ; `tests/engine/node-engine.test.ts` | T5 |
| AC-F4-1 | Automatique | `tests/unit/analysis.test.ts` ; `eval.spec.ts` (faux moteur) | T6, T7 |
| AC-F4-2 | Automatique | `analysis.test.ts` ; `eval.spec.ts` (faux moteur) | T6, T7 |
| AC-F4-3 | Automatique | `tests/e2e/eval.spec.ts` | T7 |
| AC-F4-4 | Automatique | `eval.spec.ts` (moteur en 404) | T7 |
| AC-F4-5 | Automatique + manuelle | `eval.spec.ts` (attributs) ; M5 | T7 |
| AC-F5-1 | Automatique | `analysis.test.ts` | T6 |
| AC-F5-2 | Automatique | `analysis.test.ts` | T6 |
| AC-F5-3 | Automatique | `analysis.test.ts` | T6 |
| AC-F5-4 | Automatique + manuelle | `tests/e2e/moves.spec.ts` ; M2 | T8 |
| AC-F5-5 | Automatique | `analysis.test.ts` (partie de référence) | T6, T8 |
| AC-F5-6 | Automatique + manuelle | `moves.spec.ts` (libellés texte) ; revue visuelle M2 | T8 |
| AC-F6-1 | Automatique | `tests/unit/elo.test.ts` ; `summary.spec.ts` | T11 |
| AC-F6-2 | Automatique | `elo.test.ts` | T11 |
| AC-F6-3 | Automatique | `elo.test.ts` | T11 |
| AC-F6-4 | Automatique (hors ligne) | `scripts/validate-elo.ts` sur `data/validation.jsonl` | T10, T11 |
| AC-F6-5 | Automatique | `elo.test.ts` | T11 |
| AC-F7-1 | Automatique | `tests/unit/keyMoments.test.ts` | T9 |
| AC-F7-2 | Automatique | `keyMoments.test.ts` | T9 |
| AC-F7-3 | Automatique + manuelle | `summary.spec.ts` ; M4 | T9 |
| AC-F7-4 | Automatique | `summary.spec.ts` | T9 |
| AC-X-1 | Automatique | `search.spec.ts` | T3 |
| AC-X-2 | Automatique | `tests/e2e/privacy.spec.ts` | T12 |
| AC-X-3 | Manuelle | M5 (360 px) | T3, T12 |

## 5. Scénarios de test manuels

### M1 : Trouver ses parties

- **Préparation** : `npm run dev`, Chrome puis Firefox.
- **Étapes** : saisir son vrai pseudo ; vérifier la liste contre son historique sur chess.com ; filtrer par blitz ; « Mois précédent » ; saisir un pseudo inexistant ; couper le réseau et relancer.
- **Résultat attendu** : liste conforme ; messages de F1 ; aucune partie de variante ouvrable ; noter la part des variantes (H4).
- **Critères couverts** : AC-F1-1, AC-F1-2, AC-F1-4, AC-F1-6

### M2 : Rejouer et comprendre une partie perdue

- **Préparation** : une partie récente perdue avec les noirs.
- **Étapes** : ouvrir, vérifier l'orientation, rejouer au clavier jusqu'au bout, aller sur la première gaffe, lire le panneau, regarder la flèche.
- **Résultat attendu** : orientation noirs en bas ; flèche et texte cohérents avec la meilleure suite ; symboles et libellés propres au produit.
- **Critères couverts** : AC-F2-1, AC-F4-1, AC-F5-4, AC-F5-6

### M3 : Performance de l'analyse

- **Préparation** : 5 parties de 38 à 42 coups ; aucun autre onglet lourd ouvert.
- **Étapes** : chronométrer l'analyse Standard puis Profonde ; pendant l'analyse, cliquer sur « Suivant » plusieurs fois.
- **Résultat attendu** : Standard en 60 s ou moins pour chaque partie ; échiquier réactif.
- **Critères couverts** : AC-F3-2, AC-F3-5

### M4 : Synthèse

- **Préparation** : une partie avec au moins une gaffe et une sans erreur majeure.
- **Étapes** : lire la synthèse ; cliquer chaque moment clé ; ouvrir le lien chess.com.
- **Résultat attendu** : ouverture plausible (comparer à l'en-tête ECO du PGN), moments clés navigables, lien correct.
- **Critères couverts** : AC-F7-2, AC-F7-3, AC-F7-4

### M5 : Accessibilité, petit écran et test utilisateur

- **Préparation** : fenêtre à 360 px ; Narrateur ou NVDA ; puis 5 testeurs de 800 à 1800 Elo.
- **Étapes** : parcours P1 au clavier seul ; écouter les annonces d'erreur et de l'échiquier ; à 360 px, parcourir E1 à E3 ; chaque testeur analyse 3 parties sans aide.
- **Résultat attendu** : parcours complet au clavier, focus visible, aucun défilement horizontal ; 5 testeurs sur 5 atteignent la première évaluation en moins de 2 minutes.
- **Critères couverts** : AC-F2-5, AC-F4-5, AC-X-3

## 6. Validation du MVP

Le MVP est validé quand :

- [ ] tous les critères d'acceptation MVP sont vérifiés (tableau de la section 4) ;
- [ ] `npm run test:all` passe sans échec ;
- [ ] les scénarios M1 à M5 ont été exécutés dans Chrome et Firefox, résultats consignés dans `docs/validation.md` ;
- [ ] AC-F6-4 passe, ou le repli de H7 est appliqué et documenté ;
- [ ] H5 tranchée (taux d'accord consigné) ;
- [ ] 3 testeurs sur 5 au moins déclarent qu'ils réutiliseraient l'outil.

## 7. Après le lancement

- Erreurs 429 ou blocages chess.com remontés par les utilisateurs (R1).
- Parties abandonnées pendant l'analyse : signal de lenteur (R3, H6).
- Écart ressenti entre l'Elo estimé et le niveau réel (H7) : recueillir des exemples pour recalibrer.
- Demandes répétées d'une fonction V2 : déclencheurs de la section 7 de FEATURES_AND_ACCEPTANCE.md.
