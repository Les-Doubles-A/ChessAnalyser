# H5 : gaffes du moteur allégé et du moteur complet

Généré par `npm run h5:compare` le 2026-11-20.

- Parties : 50 (les premières du jeu de calibration analysées en T10), 3179 coups comparés.
- Préréglage Standard (profondeur 14) ; moteur du site `stockfish-19-lite-single`, référence `stockfish-19-single` (réseau NNUE complet), même orchestrateur et même classification (`buildReport`).

| Mesure                                                                | Valeur |
| --------------------------------------------------------------------- | ------ |
| Gaffes selon le moteur allégé                                         | 243    |
| Gaffes selon le moteur complet                                        | 276    |
| Gaffes communes                                                       | 232    |
| Taux d'accord (communes / gaffes signalées par l'un ou l'autre)       | 80.8 % |
| Gaffes du moteur complet retrouvées comme gaffes par le moteur allégé | 84.1 % |
| Gaffes du moteur complet retrouvées comme erreur ou gaffe             | 98.9 % |
| Gaffes du moteur allégé confirmées par le moteur complet              | 95.5 % |
| Coups de même catégorie (toutes catégories)                           | 72.8 % |
