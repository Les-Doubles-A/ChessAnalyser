// Classification des coups (FEATURES_AND_ACCEPTANCE.md, F5). Seuils en points de
// Win% perdus par le joueur ; à calibrer en T12.

export type Category =
  'book' | 'forced' | 'best' | 'excellent' | 'good' | 'inaccuracy' | 'mistake' | 'blunder';

export const THRESHOLDS = { excellent: 2, good: 5, inaccuracy: 10, mistake: 20 } as const;

export interface MoveFacts {
  /** Win% du joueur avant son coup, en supposant le meilleur coup joué. */
  winBefore: number;
  /** Win% du joueur après son coup. */
  winAfter: number;
  playedUci: string;
  bestUci?: string;
  legalMoveCount: number;
  isBook: boolean;
}

export function moveLoss(winBefore: number, winAfter: number): number {
  return Math.max(0, winBefore - winAfter);
}

export function lossCategory(loss: number): Category {
  if (loss < THRESHOLDS.excellent) return 'excellent';
  if (loss < THRESHOLDS.good) return 'good';
  if (loss < THRESHOLDS.inaccuracy) return 'inaccuracy';
  if (loss < THRESHOLDS.mistake) return 'mistake';
  return 'blunder';
}

export function classify(facts: MoveFacts): Category {
  const loss = moveLoss(facts.winBefore, facts.winAfter);
  // La base Lichess nomme aussi des pièges (ex. « Fool's Mate ») : un coup « livre »
  // qui perd au moins une imprécision est classé selon sa perte.
  if (facts.isBook && loss < THRESHOLDS.good) return 'book';
  if (facts.legalMoveCount === 1) return 'forced';
  if (facts.bestUci && facts.playedUci === facts.bestUci) return 'best';
  return lossCategory(loss);
}

/** Catégories qui méritent l'affichage du meilleur coup. */
export function isError(category: Category | undefined): boolean {
  return category === 'inaccuracy' || category === 'mistake' || category === 'blunder';
}
