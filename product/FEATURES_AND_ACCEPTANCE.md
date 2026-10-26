# ChessAnalyser : Fonctionnalités et critères d'acceptation

> Version 1 · 2026-10-24
> Légende : **[Fait]** · **[H#]** hypothèse · **[Reco]** recommandation · **[À vérifier]**

## 1. Priorités

| ID | Fonctionnalité | Priorité | Justification |
|---|---|---|---|
| F1 | Recherche par pseudo et liste des parties | MVP | Point d'entrée demandé par l'utilisateur |
| F2 | Échiquier et navigation dans la partie | MVP | Sans lui, aucune analyse n'est lisible |
| F3 | Analyse moteur (préréglages Standard et Profonde) | MVP | Produit toutes les évaluations ; « analyse profonde » demandée |
| F4 | Barre et courbe d'évaluation | MVP | Demandée explicitement |
| F5 | Classification des coups, meilleur coup, précision | MVP | Cœur de la revue : dire où et comment on a perdu |
| F6 | Estimation d'Elo par partie | MVP | Demandée explicitement ; risque H7 traité par un seuil de validation |
| F7 | Synthèse de la partie | MVP | Donne la réponse en un coup d'œil ; sans elle, il faut parcourir 80 demi-coups |
| F8 | Import d'un PGN collé ou d'un fichier | V2 | Repli si l'API chess.com change (R1) |
| F9 | Cache local des analyses et historique (IndexedDB) | V2 | Confort ; le parcours fonctionne sans |
| F10 | Exploration libre : jouer des variantes, moteur en direct multi-lignes | V2 | Utile après validation ; risque d'usage pendant une partie (R8) |
| F11 | Statistiques sur plusieurs parties, Elo agrégé sur 10 parties | V2 | Demande plusieurs analyses ; repli de H7 |
| F12 | Exercices tirés de ses propres gaffes | V2 | Forte valeur d'entraînement, mais après le MVP |
| F13 | Coups « brillant », « très bon », « occasion manquée » | V2 | Heuristiques (sacrifice, coup unique) à concevoir et calibrer |
| F14 | Analyse du temps de réflexion (horloges `%clk` du PGN) | V2 | Données présentes [Fait] (PGN observé le 2026-10-24), non indispensables |
| F15 | Parties Lichess | V2 | Autre source, même moteur |
| F16 | Moteur complet multi-thread (en-têtes COOP/COEP) | V2 | 94 Mo contre 1,7 Mo [Fait] ; utile seulement si H5 est infirmée |
| F17 | Export PGN annoté (évaluations et symboles) | V2 | Partage ; non nécessaire au parcours |

## 2. Parcours utilisateurs

### P1 : analyser une partie récente

1. L'utilisateur ouvre le site et saisit son pseudo chess.com (E1).
2. Les parties du mois le plus récent s'affichent, de la plus récente à la plus ancienne (E2).
3. Il clique sur une partie : l'échiquier s'affiche orienté de son côté et l'analyse Standard démarre (E3).
4. La barre, la courbe et la liste des coups se remplissent au fil de l'analyse.
5. À la fin, la synthèse affiche précision, Elo estimé, ouverture et moments clés (E4).

**Résultat** : il sait à quel niveau il a joué et quels coups ont décidé de la partie.

### P2 : comprendre une erreur

1. Depuis E3, il clique sur un moment clé de la synthèse ou sur un point rouge de la courbe.
2. L'échiquier affiche la position, une flèche montre le meilleur coup, le panneau indique l'évaluation avant et après son coup.
3. Il avance et recule au clavier pour voir la suite.

**Résultat** : il voit ce qu'il aurait dû jouer et combien son coup a coûté.

### P3 : relancer en analyse profonde

1. Depuis E3, il choisit « Analyse profonde ».
2. L'analyse repart avec une profondeur supérieure ; les résultats remplacent ceux du préréglage Standard à la fin.

**Résultat** : évaluation plus fiable pour une partie importante, au prix d'une attente plus longue.

## 3. Écrans et surfaces

| ID | Écran / surface | Rôle | État vide | Chargement | Erreur | Succès |
|---|---|---|---|---|---|---|
| E1 | Accueil et recherche | Saisir le pseudo, choisir le préréglage | Champ vide, exemple de pseudo en aide | Bouton désactivé, indicateur « Recherche… » | Message sous le champ, focus remis dans le champ | Passage à E2 |
| E2 | Liste des parties | Choisir une partie, filtrer par cadence, mois précédent | « Aucune partie publique trouvée » | Squelette de liste | Message et bouton « Réessayer » | Liste triée |
| E3 | Vue d'analyse | Échiquier, barre, courbe, liste des coups, panneau du coup courant | Sans objet (toujours une partie) | Progression « Analyse : 34 / 81 positions », bouton « Annuler » | Moteur indisponible : message, navigation conservée | Toutes les positions évaluées |
| E4 | Panneau de synthèse (dans E3) | Précision, compteurs, Elo, ouverture, moments clés | « Disponible à la fin de l'analyse » | Idem | « Analyse incomplète : synthèse partielle » | Synthèse complète |

## 4. Spécifications du MVP

### F1 : Recherche par pseudo et liste des parties

- **Objectif** : retrouver une partie sans manipuler de PGN.
- **Comportement attendu** : le pseudo est nettoyé (espaces retirés, minuscules) puis l'application lit `/pub/player/{pseudo}/games/archives`, puis l'archive mensuelle la plus récente non vide. Chaque ligne montre : date, couleur jouée, adversaire et son classement, cadence (bullet, blitz, rapide, daily), résultat (victoire, défaite, nulle), nombre de coups. Filtre par cadence. Bouton « Mois précédent ». Le dernier pseudo saisi est mémorisé dans le navigateur.
- **Règles et limites** : requêtes strictement en série, jamais en parallèle (règle de l'API **[Fait]**). Pseudo accepté : 3 à 25 caractères parmi lettres, chiffres, `_` et `-` **[À vérifier]** contre les règles chess.com. Pseudo encodé dans l'URL.
- **Erreurs et cas limites** : 404 pseudo inconnu ; 429 ; réseau absent ; réponse non conforme ; joueur sans partie ; partie de variante.
- **Critères d'acceptation** :
  - **AC-F1-1** : Étant donné un pseudo existant avec des parties ce mois-ci, quand l'utilisateur le saisit et valide, alors la liste affiche les parties de la plus récente à la plus ancienne, avec date, couleur, adversaire et classement, cadence, résultat et nombre de coups.
  - **AC-F1-2** : Étant donné un pseudo inconnu (réponse 404), quand l'utilisateur valide, alors le message « Aucun joueur chess.com ne porte le pseudo « X ». » s'affiche, le champ garde sa valeur et reçoit le focus.
  - **AC-F1-3** : Un pseudo vide, de moins de 3 ou plus de 25 caractères, ou contenant un caractère hors `[A-Za-z0-9_-]` affiche un message de format et n'envoie aucune requête.
  - **AC-F1-4** : Sur erreur réseau ou réponse 5xx, le message « chess.com ne répond pas. » s'affiche avec un bouton « Réessayer » ; sur 429, une seule nouvelle tentative automatique a lieu après 2 s, puis le même message si elle échoue.
  - **AC-F1-5** : Pour un joueur existant sans aucune partie dans ses archives, l'état vide « Aucune partie publique trouvée » s'affiche.
  - **AC-F1-6** : Une partie dont `rules` vaut autre chose que `chess` apparaît grisée avec le libellé « Variante non prise en charge » et ne peut pas être ouverte.
- **Vérification** : automatique (Vitest avec réponses enregistrées, Playwright avec API simulée) et manuelle (M1).

### F2 : Échiquier et navigation

- **Objectif** : rejouer la partie coup par coup.
- **Comportement attendu** : échiquier orienté du côté du joueur recherché ; dernier coup surligné ; boutons « Début », « Précédent », « Suivant », « Fin » ; flèches gauche et droite du clavier, touches Début et Fin ; clic sur un coup de la liste.
- **Règles et limites** : navigation par demi-coup ; aucune saisie de coup par l'utilisateur dans le MVP (exploration libre en V2, F10).
- **Erreurs et cas limites** : PGN illisible ; fin de partie atteinte ; partie sans coup.
- **Critères d'acceptation** :
  - **AC-F2-1** : Étant donné une partie où le joueur recherché avait les noirs, quand elle s'ouvre, alors les pièces noires sont en bas de l'échiquier et la position initiale est affichée.
  - **AC-F2-2** : Flèche droite avance d'un demi-coup, flèche gauche recule d'un demi-coup ; à la dernière position, flèche droite ne change rien ; à la position initiale, flèche gauche ne change rien.
  - **AC-F2-3** : Un clic sur un coup de la liste affiche la position après ce coup et surligne ce coup dans la liste et ses cases de départ et d'arrivée sur l'échiquier.
  - **AC-F2-4** : Un PGN que la bibliothèque ne sait pas lire affiche « Cette partie n'a pas pu être lue. » et un bouton de retour à la liste, sans erreur bloquante.
  - **AC-F2-5** : Chaque contrôle de navigation est atteignable avec Tab, a un libellé accessible et montre un focus visible.
- **Vérification** : automatique (Vitest pour le modèle de partie, Playwright pour le clavier) et manuelle (M2).

### F3 : Analyse moteur

- **Objectif** : évaluer chaque position de la partie.
- **Comportement attendu** : Stockfish 19 lite mono-thread tourne dans un Web Worker. Chaque position (N demi-coups donnent N+1 positions) est évaluée à profondeur fixe : Standard profondeur 14, Profonde profondeur 18 (D4, appliqué en T5 après mesure). Pour chaque position : score (centipions ou mat, ramené au point de vue des blancs), meilleur coup, ligne principale. L'analyse démarre à l'ouverture de la partie avec le préréglage choisi. Paramètres moteur fixes (Threads 1, Hash fixe) pour des résultats reproductibles.
- **Règles et limites** : une seule analyse à la fois ; ouvrir une autre partie annule la précédente. Les positions de mat ou de pat ne sont pas envoyées au moteur.
- **Erreurs et cas limites** : WebAssembly indisponible, fichier moteur non chargé, annulation, onglet mis en arrière-plan (ralentissement possible).
- **Critères d'acceptation** :
  - **AC-F3-1** : Quand une partie s'ouvre, l'analyse démarre sans action supplémentaire et l'indicateur « Analyse : x / N positions » progresse à chaque position évaluée.
  - **AC-F3-2** : Pendant l'analyse, un clic sur « Suivant » met à jour l'échiquier en moins de 200 ms.
  - **AC-F3-3** : Un clic sur « Annuler » arrête le moteur en moins d'une seconde ; les évaluations déjà obtenues restent affichées et la vue indique « Analyse incomplète ».
  - **AC-F3-4** : Si le moteur ne démarre pas, le message « Le moteur d'analyse n'a pas pu démarrer dans ce navigateur. » s'affiche et l'échiquier reste navigable.
  - **AC-F3-5** : Une partie de 40 coups (80 demi-coups) s'analyse en préréglage Standard en 60 s ou moins sur la machine de référence définie dans RISKS_AND_TESTS.md.
  - **AC-F3-6** : Une position finale de mat reçoit une évaluation de mat sans appel au moteur ; une position de pat reçoit 0.00.
- **Vérification** : automatique (Vitest avec moteur simulé, intégration Node avec le vrai moteur) et manuelle (M3, chronométrage).

### F4 : Barre et courbe d'évaluation

- **Objectif** : voir d'un coup d'œil qui était mieux et quand tout a basculé.
- **Comportement attendu** : barre verticale à côté de l'échiquier dont la part blanche vaut la probabilité de gain des blancs, calculée par la formule Lichess `Win% = 50 + 50 * (2 / (1 + exp(-0.00368208 * cp)) - 1)` **[Fait]** (lichess.org/page/accuracy). Libellé numérique : `+1.5`, `-0.8`, `M3`, `-M3`. La barre suit l'orientation de l'échiquier. Courbe SVG : abscisse en demi-coups, ordonnée en Win% des blancs ; repère de la position courante ; marqueurs sur les erreurs et gaffes ; clic ou clavier pour naviguer.
- **Règles et limites** : un mat donne une barre pleine du côté gagnant.
- **Erreurs et cas limites** : position non encore analysée ; analyse annulée.
- **Critères d'acceptation** :
  - **AC-F4-1** : Pour une évaluation de +150 centipions, la barre affiche « +1.5 » et la part blanche mesure 63 % (63,47 % arrondi) de la hauteur, à 1 point près.
  - **AC-F4-2** : Pour un mat en 3 en faveur des noirs, la barre affiche « -M3 » et la part noire occupe toute la hauteur.
  - **AC-F4-3** : Un clic sur un point de la courbe affiche sur l'échiquier la position du demi-coup correspondant.
  - **AC-F4-4** : Tant que la position courante n'est pas analysée, la barre est grise, au milieu, avec le libellé « … », sans valeur numérique.
  - **AC-F4-5** : La courbe porte un libellé accessible (« Courbe d'évaluation, 81 positions ») et chaque marqueur d'erreur porte un symbole texte (`?!`, `?`, `??`) en plus de sa couleur.
- **Vérification** : automatique (Vitest pour les calculs, Playwright pour le clic) et manuelle (M2).

### F5 : Classification des coups, meilleur coup, précision

- **Objectif** : nommer la qualité de chaque coup et montrer le meilleur.
- **Comportement attendu** : pour chaque coup, perte = max(0, Win% du joueur après le meilleur coup moins Win% du joueur après le coup joué). Catégories **[Reco]**, seuils à calibrer en T12 :

  | Catégorie | Règle | Symbole |
  |---|---|---|
  | Livre | Position atteinte présente dans la base d'ouvertures, tous les coups précédents aussi, et perte < 5 (la base nomme aussi des pièges comme le « Fool's Mate ») | L |
  | Forcé | Un seul coup légal | □ |
  | Meilleur | Coup joué = meilleur coup du moteur | `!` vert |
  | Excellent | Perte < 2 | aucun |
  | Bon | 2 ≤ perte < 5 | aucun |
  | Imprécision | 5 ≤ perte < 10 | `?!` |
  | Erreur | 10 ≤ perte < 20 | `?` |
  | Gaffe | perte ≥ 20 | `??` |

  La précision par coup suit la formule Lichess `103.1668 * exp(-0.04354 * perte) - 3.1669`, bornée à [0, 100] ; la précision de partie est la moyenne de la moyenne pondérée par la volatilité et de la moyenne harmonique **[Fait]** (lichess.org/page/accuracy). Le code source de Lichess (lila, `AccuracyPercent.scala`) a été lu en T6 : fenêtres de taille min(max((N-1)/10, 2), 8), bonus d'incertitude de +1 sur la précision par coup, centipions plafonnés à ±1000 et mat ramené au plafond **[Fait]**. Seul le type d'écart type (population retenue) reste **[À vérifier]**.
- **Règles et limites** : symboles et couleurs propres au produit, différents des glyphes chess.com (contrainte **[Fait]**). Base d'ouvertures : lichess-org/chess-openings, CC0 **[Fait]**.
- **Erreurs et cas limites** : coup non analysé (analyse annulée) : catégorie « Non analysé » ; égalité de perte au seuil exact : la catégorie la plus sévère s'applique (perte de 5 exactement = imprécision).
- **Critères d'acceptation** :
  - **AC-F5-1** : Pour des pertes de 1,9 / 2 / 4,9 / 5 / 10 / 20 sur un coup différent du meilleur, les catégories obtenues sont Excellent / Bon / Bon / Imprécision / Erreur / Gaffe ; un coup égal au meilleur coup est classé Meilleur.
  - **AC-F5-2** : Un coup joué dans une position à un seul coup légal est classé Forcé, quelle que soit la perte.
  - **AC-F5-3** : Les premiers coups présents dans la base sont classés Livre ; aucun coup situé après le premier coup hors base n'est classé Livre.
  - **AC-F5-4** : Quand l'utilisateur affiche un coup classé Imprécision, Erreur ou Gaffe, une flèche montre sur l'échiquier les cases de départ et d'arrivée du meilleur coup (révisé en T8 : sur la position affichée, pas sur celle d'avant), et le panneau indique ce coup en notation algébrique avec l'évaluation avant et après le coup joué.
  - **AC-F5-5** : La précision de chaque joueur s'affiche entre 0 et 100 avec une décimale ; pour la partie de référence `fixtures/game-ref-01`, elle égale la valeur attendue du fichier de référence à 0,1 près.
  - **AC-F5-6** : Chaque catégorie est identifiable sans la couleur (symbole et libellé texte), et aucun glyphe, palette ou jeu de pièces chess.com n'est utilisé.
- **Vérification** : automatique (Vitest) et manuelle (M2, revue visuelle).

### F6 : Estimation d'Elo par partie

- **Objectif** : dire à quel niveau chaque joueur a joué sur cette partie, avec une marge d'erreur honnête.
- **Comportement attendu** : modèle de régression **[Reco]** calibré hors ligne sur au moins 2000 parties chess.com publiques classées (`rated`, `rules = chess`), analysées avec le même moteur et le même préréglage. Variables : précision du joueur, perte moyenne, taux d'erreurs et de gaffes, cadence. Sortie : estimation arrondie à 50 points et intervalle à 80 % issu des quantiles des résidus. Coefficients versionnés dans `elo-model.json`, un jeu par préréglage. Affichage : « Niveau estimé sur cette partie : ≈ 1450 (1150 à 1750), confiance faible », à côté du classement réel chess.com du joueur.
- **Règles et limites** : estimation bornée à [100, 3200] ; nécessite au moins 10 coups hors livre du joueur et une analyse complète.
- **Erreurs et cas limites** : partie courte ; analyse incomplète ; cadence absente du jeu de calibration (repli sur le modèle toutes cadences).
- **Critères d'acceptation** :
  - **AC-F6-1** : Pour une partie complètement analysée avec au moins 10 coups hors livre par joueur, chaque joueur reçoit une estimation multiple de 50, un intervalle, et son classement chess.com est affiché à côté.
  - **AC-F6-2** : Si un joueur a joué moins de 10 coups hors livre, la mention « Partie trop courte pour estimer le niveau » remplace le chiffre.
  - **AC-F6-3** : Si l'analyse est incomplète, aucune estimation n'est affichée.
  - **AC-F6-4** : Sur un jeu de validation d'au moins 300 parties absentes de la calibration, l'erreur absolue médiane est de 300 points ou moins et 75 à 85 % des classements réels tombent dans l'intervalle à 80 %.
  - **AC-F6-5** : Aucune estimation n'est inférieure à 100 ni supérieure à 3200, y compris pour une partie à 100 % de précision ou à 0 %.
- **Vérification** : automatique (Vitest pour le calcul, script de validation pour AC-F6-4).

### F7 : Synthèse de la partie

- **Objectif** : donner la réponse en un coup d'œil.
- **Comportement attendu** : nom et code ECO de l'ouverture (plus long préfixe trouvé dans la base), précision des deux joueurs, nombre de coups par catégorie et par joueur, Elo estimé (F6), trois moments clés, lien vers la partie sur chess.com.
- **Règles et limites** : moments clés = les 3 coups de plus forte perte (10 ou plus), présentés dans l'ordre chronologique.
- **Erreurs et cas limites** : ouverture absente de la base ; partie sans erreur majeure ; analyse incomplète.
- **Critères d'acceptation** :
  - **AC-F7-1** : Pour chaque joueur, la somme des compteurs par catégorie égale le nombre de coups joués par ce joueur.
  - **AC-F7-2** : L'ouverture affichée est la plus longue séquence de la base qui correspond au début de la partie ; si aucune ne correspond, « Ouverture non répertoriée » s'affiche.
  - **AC-F7-3** : Les moments clés listent au plus 3 coups de perte 10 ou plus, dans l'ordre chronologique ; un clic sur l'un d'eux affiche la position ; sans coup de perte 10 ou plus, « Aucune erreur majeure » s'affiche.
  - **AC-F7-4** : Le lien « Voir sur chess.com » ouvre l'URL `url` de la partie dans un nouvel onglet, avec `rel="noopener noreferrer"`.
- **Vérification** : automatique (Vitest, Playwright) et manuelle (M4).

### Exigences transverses

- **AC-X-1** : Toutes les pages affichent en pied de page « Projet indépendant, non affilié à Chess.com ».
- **AC-X-2** : Pendant le parcours P1, le navigateur n'envoie de requête qu'à l'origine du site et à `api.chess.com` (aucun traceur, aucune police ou bibliothèque chargée depuis un tiers).
- **AC-X-3** : À 360 px de large, E1, E2 et E3 restent utilisables sans défilement horizontal ; l'échiquier occupe la largeur et la courbe passe sous l'échiquier.

## 5. Permissions et données sensibles

| Permission ou donnée | Pourquoi elle est nécessaire | Alternative plus faible envisagée | Ce qui se passe si elle est refusée |
|---|---|---|---|
| Accès réseau à `api.chess.com` | Lire les parties publiques | Import PGN (F8, V2) | Message d'erreur F1 ; en V2, import PGN |
| `localStorage` : dernier pseudo et préréglage | Éviter de ressaisir | Aucun stockage | Navigation privée : rien n'est mémorisé, tout fonctionne |
| Pseudo saisi | Donnée publique sur chess.com, envoyée seulement à chess.com | Sans objet | Sans objet |

Aucune autre permission du navigateur. Aucune donnée n'est envoyée à un serveur du projet (il n'y en a pas).

## 6. Accessibilité

- Navigation complète au clavier : champ, liste, contrôles de l'échiquier, courbe (flèches), moments clés.
- Focus visible sur tous les éléments interactifs.
- Libellés accessibles sur les boutons à icône et sur l'échiquier (« Échiquier, position après 12. Fxe5 »).
- Catégories et évaluations jamais portées par la couleur seule (AC-F4-5, AC-F5-6).
- Messages d'erreur dans une zone `aria-live="polite"`, avec la façon de corriger.
- Contraste conforme au niveau AA du WCAG pour les textes.

## 7. Version 2

| ID | Fonctionnalité | Condition pour la lancer |
|---|---|---|
| F8 | Import PGN | API chess.com indisponible (R1) ou demande de 2 testeurs |
| F9 | Cache local et historique | Usage personnel : plus de 3 parties rouvertes par semaine |
| F10 | Exploration libre et moteur en direct | MVP validé ; règles anti-usage en partie définies (R8) |
| F11 | Statistiques multi-parties, Elo agrégé | F9 disponible ; ou H7 infirmée |
| F12 | Exercices tirés de ses gaffes | F9 disponible |
| F13 | Brillant, très bon, occasion manquée | Classification MVP jugée fiable (M2, retours testeurs) |
| F14 | Analyse du temps de réflexion | Demande d'au moins 2 testeurs |
| F15 | Parties Lichess | Demande d'au moins 2 testeurs |
| F16 | Moteur complet multi-thread | H5 infirmée |
| F17 | Export PGN annoté | Demande d'au moins 2 testeurs |

## 8. Hors périmètre

| Fonctionnalité | Raison |
|---|---|
| Comptes utilisateurs, synchronisation | Aucune donnée privée ni partagée ; le pseudo suffit |
| Paiement | Produit gratuit (H3) |
| Coach par IA générative | Exige une clé secrète donc un serveur et un coût par appel (contraire à H3) ; explications fiables difficiles |
| Application mobile native | Le site responsive couvre le besoin (AC-X-3) |
| Analyse d'une partie en cours | Contraire au fair-play ; seules les parties terminées sont dans les archives |
| Variantes (960, crazyhouse…) | Public marginal (H4) |
| Identité visuelle de chess.com | Interdit par les conditions de l'API |
