// Précision par coup et par partie, portage de lila (Lichess) :
// modules/analyse/src/main/AccuracyPercent.scala (consulté le 2026-10-24).
// Écart type de population : la variante exacte de scalalib n'a pas pu être lue.

/** Précision d'un coup à partir des Win% du joueur avant et après. */
export function moveAccuracy(winBefore: number, winAfter: number): number {
  if (winAfter >= winBefore) return 100;
  const winDiff = winBefore - winAfter;
  const raw = 103.1668100711649 * Math.exp(-0.04354415386753951 * winDiff) - 3.166924740191411;
  // Bonus d'incertitude de Lichess (analyse imparfaite).
  return Math.max(0, Math.min(100, raw + 1));
}

function standardDeviation(values: number[]): number {
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/** Équivalent de `List.sliding(size)` en Scala : une seule fenêtre si la liste est trop courte. */
function sliding<T>(items: T[], size: number): T[][] {
  if (items.length <= size) return items.length > 0 ? [items] : [];
  const windows: T[][] = [];
  for (let i = 0; i + size <= items.length; i++) windows.push(items.slice(i, i + size));
  return windows;
}

export interface GameAccuracy {
  white: number | null;
  black: number | null;
}

/**
 * @param whiteWinPercents Win% des blancs pour chaque position, position de départ comprise.
 * @param startColor Camp qui joue le premier coup.
 */
export function gameAccuracy(
  whiteWinPercents: number[],
  startColor: 'w' | 'b' = 'w',
): GameAccuracy {
  const n = whiteWinPercents.length;
  const windowSize = Math.max(2, Math.min(8, Math.floor((n - 1) / 10)));
  const windows: number[][] = [
    ...Array.from({ length: Math.max(0, Math.min(windowSize, n) - 2) }, () =>
      whiteWinPercents.slice(0, windowSize),
    ),
    ...sliding(whiteWinPercents, windowSize),
  ];
  const weights = windows.map((w) => Math.max(0.5, Math.min(12, standardDeviation(w))));

  const perColor = {
    w: [] as { accuracy: number; weight: number }[],
    b: [] as { accuracy: number; weight: number }[],
  };
  const pairs = n - 1;
  for (let i = 0; i < Math.min(pairs, weights.length); i++) {
    const prev = whiteWinPercents[i]!;
    const next = whiteWinPercents[i + 1]!;
    const color = (i % 2 === 0) === (startColor === 'w') ? 'w' : 'b';
    const accuracy =
      color === 'w' ? moveAccuracy(prev, next) : moveAccuracy(100 - prev, 100 - next);
    perColor[color].push({ accuracy, weight: weights[i]! });
  }

  const aggregate = (items: { accuracy: number; weight: number }[]): number | null => {
    if (items.length === 0) return null;
    const totalWeight = items.reduce((sum, x) => sum + x.weight, 0);
    const weighted = items.reduce((sum, x) => sum + x.accuracy * x.weight, 0) / totalWeight;
    const inverseSum = items.reduce((sum, x) => sum + 1 / x.accuracy, 0);
    const harmonic = items.length / inverseSum;
    return (weighted + harmonic) / 2;
  };

  return { white: aggregate(perColor.w), black: aggregate(perColor.b) };
}
