import { Chess } from 'chess.js';
import type { ParsedGame } from '../chess/game';
import type { PositionEval } from '../engine/types';
import { gameAccuracy, moveAccuracy, type GameAccuracy } from './accuracy';
import { classify, moveLoss, type Category } from './classify';
import { bookFlags, type OpeningIndex } from './openings';
import { whiteWinPercent } from './winPercent';

export interface MoveAnalysis {
  plyIndex: number;
  color: 'w' | 'b';
  /** Win% du joueur avant (meilleur coup supposé) et après son coup. */
  winBefore: number;
  winAfter: number;
  loss: number;
  accuracy: number;
  category: Category;
  bestMoveUci?: string;
  bestMoveSan?: string;
}

export interface GameReport {
  /** Indexé comme les demi-coups : moves[i] concerne plies[i]. Absent si non analysé. */
  moves: (MoveAnalysis | undefined)[];
  accuracy: GameAccuracy;
  complete: boolean;
}

export function uciToSan(fen: string, uci: string): string | undefined {
  try {
    const chess = new Chess(fen);
    const move = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    return move.san;
  } catch {
    return undefined;
  }
}

export function buildReport(
  game: ParsedGame,
  evals: readonly (PositionEval | undefined)[],
  openings?: OpeningIndex,
): GameReport {
  const book = openings
    ? bookFlags(
        game.plies.map((p) => p.fenAfter),
        openings,
      )
    : game.plies.map(() => false);

  const moves = game.plies.map((ply, i): MoveAnalysis | undefined => {
    const before = evals[i];
    const after = evals[i + 1];
    if (!before || !after) return undefined;
    const mover = (score: PositionEval['score']) =>
      ply.color === 'w' ? whiteWinPercent(score) : 100 - whiteWinPercent(score);
    const winBefore = mover(before.score);
    const winAfter = mover(after.score);
    const category = classify({
      winBefore,
      winAfter,
      playedUci: ply.uci,
      bestUci: before.bestMoveUci,
      legalMoveCount: ply.legalMoveCount,
      isBook: book[i]!,
    });
    return {
      plyIndex: ply.index,
      color: ply.color,
      winBefore,
      winAfter,
      loss: moveLoss(winBefore, winAfter),
      accuracy: moveAccuracy(winBefore, winAfter),
      category,
      bestMoveUci: before.bestMoveUci,
      bestMoveSan: before.bestMoveUci ? uciToSan(ply.fenBefore, before.bestMoveUci) : undefined,
    };
  });

  // Précision sur la suite continue de positions évaluées depuis le départ.
  const prefix: number[] = [];
  for (const evaluation of evals.slice(0, game.plies.length + 1)) {
    if (!evaluation) break;
    prefix.push(whiteWinPercent(evaluation.score));
  }
  const startColor = game.plies[0]?.color ?? 'w';
  const complete = prefix.length === game.plies.length + 1;
  return { moves, accuracy: gameAccuracy(prefix, startColor), complete };
}
