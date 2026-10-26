# Validation de l’estimation d’Elo (AC-F6-4)

Généré par `npm run elo:validate -- --preset standard` le 2026-10-26.
Moteur stockfish-19-lite-single, profondeur 14, modèle calibré sur 3899 échantillons.
Validation : 719 échantillons, 664 parties, joueurs absents de la calibration (écartés : 0 non analysés, 0 trop courts, 0 incomplets).

Critère : au moins 300 parties, erreur absolue médiane ≤ 300, 75 à 85 % des classements réels dans l’intervalle à 80 %.

**Résultat : non atteint** (erreur médiane 378, couverture 80.4 %).

| Groupe | Échantillons | Erreur médiane | Couverture |
| --- | --- | --- | --- |
| Tous | 719 | 378 | 80.4 % |
| bullet | 260 | 468 | 75.8 % |
| blitz | 211 | 332 | 82.9 % |
| rapid | 195 | 377 | 80.0 % |
| daily | 53 | 197 | 94.3 % |
| hors 400-2599 | 8 | 621 | 62.5 % |
| 400-599 | 62 | 698 | 50.0 % |
| 600-799 | 92 | 556 | 66.3 % |
| 800-999 | 63 | 339 | 85.7 % |
| 1000-1199 | 73 | 318 | 91.8 % |
| 1200-1399 | 74 | 200 | 95.9 % |
| 1400-1599 | 58 | 166 | 100.0 % |
| 1600-1799 | 67 | 159 | 100.0 % |
| 1800-1999 | 65 | 301 | 95.4 % |
| 2000-2199 | 56 | 501 | 76.8 % |
| 2200-2399 | 54 | 653 | 64.8 % |
| 2400-2599 | 47 | 723 | 51.1 % |
