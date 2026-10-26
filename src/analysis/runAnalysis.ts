import { Chess } from 'chess.js';
import type { ParsedGame } from '../chess/game';
import { isAbortError, type Engine, type PositionEval } from '../engine/types';

export type Preset = 'standard' | 'deep';

/** Profondeurs fixes (ADR-2). Mesurées sous Node le 2026-10-24 : ≈ 0,1 s par position à 14, ≈ 1 s à 18. */
export const PRESET_DEPTH: Record<Preset, number> = { standard: 14, deep: 18 };

export interface RunOptions {
  depth: number;
  signal?: AbortSignal;
  onPosition?: (index: number, evaluation: PositionEval) => void;
}

export interface RunResult {
  evals: (PositionEval | undefined)[];
  complete: boolean;
}

/** Évaluation sans moteur des positions finales : mat ou pat. */
export function terminalEval(fen: string): PositionEval | null {
  const chess = new Chess(fen);
  if (chess.isCheckmate()) {
    const winner = chess.turn() === 'w' ? 'b' : 'w';
    return { fen, depth: 0, score: { mate: 0, winner }, pv: [] };
  }
  if (chess.isStalemate()) return { fen, depth: 0, score: { cp: 0 }, pv: [] };
  return null;
}

/**
 * Évalue en série les N+1 positions de la partie. Une annulation n'est pas une erreur :
 * le résultat partiel est renvoyé avec `complete: false`.
 */
export async function runAnalysis(
  game: ParsedGame,
  engine: Engine,
  options: RunOptions,
): Promise<RunResult> {
  const fens = [game.startFen, ...game.plies.map((p) => p.fenAfter)];
  const evals: (PositionEval | undefined)[] = fens.map(() => undefined);
  try {
    await engine.newGame();
    for (let i = 0; i < fens.length; i++) {
      if (options.signal?.aborted) return { evals, complete: false };
      const fen = fens[i]!;
      const evaluation =
        terminalEval(fen) ?? (await engine.evaluate(fen, options.depth, options.signal));
      evals[i] = evaluation;
      options.onPosition?.(i, evaluation);
    }
  } catch (error) {
    if (isAbortError(error)) return { evals, complete: false };
    throw error;
  }
  return { evals, complete: true };
}
