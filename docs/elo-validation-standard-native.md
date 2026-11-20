# Validation de l’estimation d’Elo (AC-F6-4)

Généré par `npm run elo:validate -- --preset standard --engine native` le 2026-11-20.
Moteur stockfish-19-native, profondeur 14, modèle calibré sur 3899 échantillons.
Validation : 719 échantillons, 664 parties, joueurs absents de la calibration (écartés : 0 non analysés, 0 trop courts, 0 incomplets).

Critère : au moins 300 parties, erreur absolue médiane ≤ 300, 75 à 85 % des classements réels dans l’intervalle à 80 %.

**Résultat : non atteint** (erreur médiane 379, couverture 81.2 %).

| Groupe | Échantillons | Erreur médiane | Couverture |
| --- | --- | --- | --- |
| Tous | 719 | 379 | 81.2 % |
| bullet | 260 | 472 | 79.2 % |
| blitz | 211 | 339 | 83.4 % |
| rapid | 195 | 370 | 77.9 % |
| daily | 53 | 214 | 94.3 % |
| hors 400-2599 | 8 | 721 | 37.5 % |
| 400-599 | 62 | 686 | 51.6 % |
| 600-799 | 92 | 555 | 71.7 % |
| 800-999 | 63 | 343 | 88.9 % |
| 1000-1199 | 73 | 311 | 93.2 % |
| 1200-1399 | 74 | 184 | 95.9 % |
| 1400-1599 | 58 | 140 | 100.0 % |
| 1600-1799 | 67 | 160 | 98.5 % |
| 1800-1999 | 65 | 286 | 93.8 % |
| 2000-2199 | 56 | 483 | 83.9 % |
| 2200-2399 | 54 | 620 | 64.8 % |
| 2400-2599 | 47 | 726 | 44.7 % |
