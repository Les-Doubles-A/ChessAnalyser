// Probabilité de gain, d'après Lichess : https://lichess.org/page/accuracy et
// scalachess (WinPercent.fromCentiPawns, Cp.CEILING = 1000, mat ramené au plafond).
import type { Score } from '../engine/types';

export const CP_CEILING = 1000;
const MULTIPLIER = -0.00368208;

export function winPercentFromCp(cp: number): number {
  const clamped = Math.max(-CP_CEILING, Math.min(CP_CEILING, cp));
  const chances = 2 / (1 + Math.exp(MULTIPLIER * clamped)) - 1;
  return 50 + 50 * Math.max(-1, Math.min(1, chances));
}

/** Probabilité de gain des blancs utilisée pour les pertes et la précision. */
export function whiteWinPercent(score: Score): number {
  if ('cp' in score) return winPercentFromCp(score.cp);
  return winPercentFromCp(score.winner === 'w' ? CP_CEILING : -CP_CEILING);
}

/** Part blanche de la barre d'évaluation, de 0 à 100 ; un mat remplit la barre. */
export function whiteBarPercent(score: Score): number {
  if ('mate' in score) return score.winner === 'w' ? 100 : 0;
  return winPercentFromCp(score.cp);
}

/** Libellé de la barre : « +1.5 », « -0.8 », « M3 », « -M3 », « Mat ». */
export function formatScore(score: Score): string {
  if ('mate' in score) {
    if (score.mate === 0) return 'Mat';
    return `${score.winner === 'w' ? '' : '-'}M${score.mate}`;
  }
  const pawns = score.cp / 100;
  const text = Math.abs(pawns).toFixed(1);
  if (text === '0.0') return '0.0';
  return `${pawns > 0 ? '+' : '-'}${text}`;
}
