# ChessAnalyser : Product Brief

> Version 1 · 2026-10-24 · Statut : brouillon à valider
> Légende : **[Fait]** vérifié (source ou « exprimé par l'utilisateur ») · **[H#]** hypothèse · **[Reco]** recommandation · **[À vérifier]**

## 1. Concept

Un site web gratuit où un joueur saisit son pseudo chess.com, choisit une de ses parties récentes et obtient une revue complète : barre et courbe d'évaluation, classification de chaque coup, meilleur coup suggéré, précision et estimation du niveau (Elo) joué sur la partie. Tout le calcul moteur se fait dans le navigateur, sans compte ni serveur.

## 2. Problème

Un joueur amateur qui veut comprendre ses erreurs après une partie dispose sur chess.com d'**une seule revue complète par jour** avec un compte gratuit ; la revue illimitée demande un abonnement Platinum ou Diamond **[Fait]** (support.chess.com, consulté le 2026-10-24). Lichess offre une analyse gratuite, mais il faut copier le PGN, l'importer et avoir un compte pour lancer l'analyse serveur **[Fait]** (lichess.org/paste, consulté le 2026-10-24). Le joueur qui enchaîne plusieurs parties par jour finit par ne pas analyser la plupart d'entre elles, ou par manipuler des PGN à la main.

## 3. Utilisateurs

- **Utilisateur principal** : joueur amateur chess.com (environ 600 à 2000 Elo), joue plusieurs parties par semaine, veut savoir où il a perdu la partie et à quel niveau il a joué.
- **Utilisateurs secondaires** : entraîneur ou ami qui consulte les parties d'un joueur à partir de son pseudo (les parties sont publiques).
- **Hors cible** : joueurs titrés qui ont besoin d'un moteur complet multi-cœurs et de bases de données ; joueurs de variantes (960, crazyhouse…) ; quiconque veut une aide pendant une partie en cours.

## 4. Alternatives actuelles

| Alternative | Ce qu'elle fait bien | Limite pour notre cible | Statut de l'information |
|---|---|---|---|
| Ne rien faire / rejouer la partie de tête | Gratuit, immédiat | Les erreurs tactiques restent invisibles | Constat |
| Game Review chess.com (compte gratuit) | Intégré, classification des coups, coach | 1 revue complète par jour ; illimité réservé à Platinum et Diamond | Vérifié le 2026-10-24 (support.chess.com/en/articles/8562418) |
| Analyse Lichess par import PGN | Gratuite, moteur solide | Copier-coller du PGN, compte requis pour l'analyse serveur, pas d'estimation d'Elo | Vérifié le 2026-10-24 (lichess.org/paste) |
| Outils tiers gratuits (Chess It Up, NexoChess, WintrChess…) | Revue gratuite à partir d'un pseudo, selon leurs descriptions | Fonctionnement, pérennité et qualité non vérifiés | **[À vérifier]** : cités par alternativeto.net, non testés |

Conséquence : la proposition n'est pas nouvelle. La valeur tient à l'exécution (rapidité, clarté, gratuité sans limite, estimation d'Elo honnête) et à l'usage personnel de l'auteur. Le test de la section 7 doit comparer le produit à ces outils.

## 5. Proposition de valeur

Analyser n'importe laquelle de ses parties chess.com en deux clics, gratuitement et sans limite, avec une estimation de niveau qui affiche sa marge d'erreur.

- Aucun compte, aucun copier-coller de PGN : le pseudo suffit.
- Aucune limite quotidienne : le calcul se fait sur la machine de l'utilisateur.
- Estimation d'Elo calibrée sur de vraies parties chess.com, présentée avec un intervalle et un niveau de confiance plutôt qu'un chiffre trompeur.
- Code ouvert (GPL-3.0, imposé par Stockfish) : la méthode de calcul est vérifiable.

## 6. Hypothèses

| ID | Hypothèse | Type | Si elle est fausse | Comment la tester | Coût du test |
|---|---|---|---|---|---|
| H1 | Un site web suffit ; un logiciel installé n'est pas nécessaire | Technique | Empaqueter le même code en application de bureau (V2), la logique reste réutilisable | Benchmark moteur dans le navigateur (T12) | Faible |
| H2 | Usage personnel et entourage d'abord ; publication ouverte possible ensuite, sans compte | Usage | Prévoir mentions légales, page de confidentialité, hébergement public dès la V1 | Décision de l'utilisateur (D5) | Nul |
| H3 | Gratuit, zéro coût récurrent : ni serveur d'analyse ni API payante | Économique | Un serveur d'analyse deviendrait envisageable (moteur plus fort, cache partagé) | Confirmation de l'utilisateur | Nul |
| H4 | Échecs standard uniquement, parties terminées | Usage | Ajouter la prise en charge du 960 (position initiale variable) | Compter les parties de variantes dans l'historique de l'utilisateur | Faible |
| H5 | Stockfish 19 « lite » mono-thread dans le navigateur classe les coups de façon fiable pour des joueurs de moins de 2200 | Technique | Proposer le moteur complet en option (F16) ou augmenter la profondeur | Comparer les gaffes détectées avec le moteur complet sur 50 parties (T12) | Moyen |
| H6 | Une partie de 40 coups s'analyse en 60 s ou moins (préréglage Standard) sur la machine de référence | Technique | Baisser la profondeur, analyser d'abord les coups du joueur, mettre en cache (F9) | Mesure chronométrée (AC-F3-5) | Faible |
| H7 | Une seule partie permet d'estimer le niveau joué avec une erreur absolue médiane de 300 points ou moins | Technique | Afficher une fourchette large (« niveau 1000 à 1400 ») ou reporter l'estimation à un agrégat de 10 parties (F11) | Validation sur 300 parties non vues (AC-F6-4) | Moyen |
| H8 | Des joueurs amateurs utiliseraient une revue gratuite illimitée à partir du pseudo | Problème | Garder l'outil pour un usage personnel seulement | Usage personnel 2 semaines, puis 5 joueurs (section 7) | Faible |
| H9 | Interface en français seulement | Usage | Externaliser les textes pour traduction (V2) | Retour des 5 testeurs | Nul |

## 7. Tester l'intérêt avant d'investir

1. **Avant de coder** (30 minutes) : analyser 3 de ses propres parties avec Lichess et avec un outil tiers gratuit. Noter ce qui manque ou agace. Si rien ne manque, le projet devient un projet d'apprentissage, ce qui reste un objectif valable.
2. **Après la tranche 2** (analyse fonctionnelle) : usage personnel pendant 2 semaines, en analysant chaque partie jouée.
3. **Après le MVP** : 5 joueurs de 800 à 1800 Elo analysent 3 parties chacun sans aide.

Seuil d'arrêt ou de pivot : moins de 3 testeurs sur 5 déclarent qu'ils le réutiliseraient plutôt que leur outil actuel.

## 8. Objectifs et indicateurs de réussite

| Objectif | Indicateur | Seuil de réussite du MVP | Mesure |
|---|---|---|---|
| Analyse rapide | Durée d'analyse Standard d'une partie de 40 coups | 60 s ou moins | Chronométrage (AC-F3-5) |
| Parcours simple | Temps entre la saisie du pseudo et l'affichage de la première évaluation | Moins de 2 minutes sans aide, pour 5 testeurs sur 5 | Test utilisateur M5 |
| Estimation honnête | Erreur absolue médiane de l'Elo estimé | 300 points ou moins ; 75 à 85 % des classements réels dans l'intervalle à 80 % | Script de validation (AC-F6-4) |
| Utilité perçue | Testeurs qui le réutiliseraient | 3 sur 5 ou plus | Entretien après test |

## 9. Périmètre du MVP

- **MVP** : F1 recherche par pseudo et liste des parties ; F2 échiquier et navigation ; F3 analyse moteur (préréglages Standard et Profonde) ; F4 barre et courbe d'évaluation ; F5 classification des coups, meilleur coup, précision ; F6 estimation d'Elo par partie ; F7 synthèse de partie.
- **Version 2** : F8 import PGN, F9 cache local et historique, F10 exploration libre avec moteur en direct, F11 statistiques sur plusieurs parties, F12 exercices tirés de ses erreurs, F13 coups « brillant » et « occasion manquée », F14 analyse du temps de réflexion, F15 parties Lichess, F16 moteur complet multi-thread, F17 export PGN annoté.
- **Hors périmètre** : comptes, paiement, coach par IA générative, application mobile native, analyse de parties en cours, variantes, reprise de l'identité visuelle de chess.com (détail dans FEATURES_AND_ACCEPTANCE.md).

## 10. Contraintes

- Les parties viennent de chess.com à partir du pseudo **[Fait]** (exprimé par l'utilisateur).
- Barre d'évaluation, analyse profonde et estimation d'Elo par partie sont attendues **[Fait]** (exprimé par l'utilisateur).
- Site web ou logiciel, au choix **[Fait]** (exprimé par l'utilisateur) ; site web retenu **[H1]**.
- L'API publique chess.com interdit de reprendre les palettes, pièces, sons et **glyphes de classification des coups** de chess.com **[Fait]** (chess.com/news/view/published-data-api, consulté le 2026-10-24). Le produit doit avoir sa propre identité visuelle.
- Stockfish.js est sous GPL-3.0 **[Fait]** (registre npm et dépôt nmrugg/stockfish.js, consultés le 2026-10-24) : distribuer le site implique de publier son code sous une licence compatible (D1).

## 11. Questions ouvertes

| Question | Qui tranche | Ce que ça change |
|---|---|---|
| Publication ouverte dès la fin du MVP ou usage privé ? (H2, D5) | Utilisateur | Hébergement, page de confidentialité, mentions légales |
| Le code sera-t-il publié sous GPL-3.0 ? (D1) | Utilisateur | Condition pour distribuer le site avec Stockfish |
| Le site web convient-il, ou un logiciel installé est-il souhaité ? (H1) | Utilisateur | Ajout d'un empaquetage bureau en V2 |

## Sources

Consultées le 2026-10-24 :
- API publique chess.com : https://www.chess.com/news/view/published-data-api
- Requêtes directes à `https://api.chess.com/pub/...` : en-tête `Access-Control-Allow-Origin: *` présent ; 404 JSON pour un pseudo inconnu ; défi Cloudflare (403) pour une requête curl sans User-Agent explicite.
- Formules de précision Lichess : https://lichess.org/page/accuracy
- Limites de Game Review : https://support.chess.com/en/articles/8562418-what-does-each-level-of-membership-get-me
- Import PGN Lichess : https://lichess.org/paste
- Stockfish.js (variantes, tailles, licence) : https://github.com/nmrugg/stockfish.js et https://registry.npmjs.org/stockfish/latest (version 19.0.1)
- Base d'ouvertures Lichess (CC0) : https://github.com/lichess-org/chess-openings
- Outils tiers : https://alternativeto.net/software/chesscom/ (listes non vérifiées individuellement)
