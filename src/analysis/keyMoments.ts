import type { ParsedGame } from '../chess/game';
import type { Category } from './classify';
import { openingOf, type Opening, type OpeningIndex } from './openings';
import type { GameReport, MoveAnalysis } from './report';

export type CountKey = Category | 'unanalysed';
export type CategoryCounts = Record<CountKey, number>;

export const COUNT_KEYS: readonly CountKey[] = [
  'book',
  'forced',
  'best',
  'excellent',
  'good',
  'inaccuracy',
  'mistake',
  'blunder',
  'unanalysed',
];

export const KEY_MOMENT_COUNT = 3;

export interface GameSynthesis {
  counts: { w: CategoryCounts; b: CategoryCounts };
  /** undefined tant que la base n'est pas chargée, null si aucune ouverture ne correspond. */
  opening: Opening | null | undefined;
  /** Au plus 3 coups, dans l'ordre chronologique. */
  keyMoments: MoveAnalysis[];
}

function emptyCounts(): CategoryCounts {
  return Object.fromEntries(COUNT_KEYS.map((key) => [key, 0])) as CategoryCounts;
}

/** Chaque coup compte une fois, « Non analysé » compris : la somme égale le nombre de coups (AC-F7-1). */
export function countCategories(game: ParsedGame, report: GameReport) {
  const counts = { w: emptyCounts(), b: emptyCounts() };
  game.plies.forEach((ply, i) => {
    counts[ply.color][report.moves[i]?.category ?? 'unanalysed'] += 1;
  });
  return counts;
}

/**
 * Les coups de plus forte perte parmi les erreurs et gaffes (perte de 10 ou plus), remis
 * dans l'ordre chronologique. Les coups forcés, livre ou meilleurs sont exclus même si
 * l'évaluation varie, car le joueur n'avait rien de mieux.
 */
export function keyMoments(moves: GameReport['moves']): MoveAnalysis[] {
  return moves
    .filter((m): m is MoveAnalysis => m?.category === 'mistake' || m?.category === 'blunder')
    .sort((a, b) => b.loss - a.loss || a.plyIndex - b.plyIndex)
    .slice(0, KEY_MOMENT_COUNT)
    .sort((a, b) => a.plyIndex - b.plyIndex);
}

export function summarizeGame(
  game: ParsedGame,
  report: GameReport,
  openings?: OpeningIndex,
): GameSynthesis {
  return {
    counts: countCategories(game, report),
    opening: openings
      ? openingOf(
          game.plies.map((p) => p.fenAfter),
          openings,
        )
      : undefined,
    keyMoments: keyMoments(report.moves),
  };
}
