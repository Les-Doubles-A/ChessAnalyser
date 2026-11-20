import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PositionEval } from '../../src/engine/types';
import { useVariationEvals } from '../../src/ui/useVariationEvals';

const { evaluate, releaseFailedEngine } = vi.hoisted(() => ({
  evaluate: vi.fn(),
  releaseFailedEngine: vi.fn(),
}));

vi.mock('../../src/ui/useAnalysis', () => ({
  getEngine: () => ({ evaluate, newGame: vi.fn(), terminate: vi.fn() }),
  releaseFailedEngine,
}));

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
const AFTER_D4 = 'rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1';
const NONE: ReadonlyMap<string, PositionEval> = new Map();

beforeEach(() => {
  evaluate.mockReset();
  releaseFailedEngine.mockReset();
  evaluate.mockImplementation(async (fen: string, depth: number): Promise<PositionEval> => ({
    fen,
    depth,
    score: { cp: depth },
    pv: [],
  }));
});

describe('useVariationEvals', () => {
  it('réévalue les positions déjà vues quand la profondeur change', async () => {
    const fens = [START, AFTER_E4];
    const { result, rerender } = renderHook(
      ({ depth }) => useVariationEvals(fens, 0, depth, NONE),
      { initialProps: { depth: 14 } },
    );
    await waitFor(() => expect(result.current.evals.map((e) => e?.depth)).toEqual([14, 14]));

    rerender({ depth: 18 });
    await waitFor(() => expect(result.current.evals.map((e) => e?.depth)).toEqual([18, 18]));
    expect(evaluate).toHaveBeenCalledTimes(4);
  });

  it('signale une panne, libère le moteur, et efface l’erreur quand la variante change', async () => {
    const failure = new Error('moteur en panne');
    evaluate.mockRejectedValueOnce(failure);
    const first = [START, AFTER_E4];
    const { result, rerender } = renderHook(
      ({ fens, known }) => useVariationEvals(fens, 0, 14, known),
      { initialProps: { fens: first, known: NONE } },
    );
    await waitFor(() => expect(result.current.error).toBe('La variante n’a pas pu être évaluée.'));
    expect(releaseFailedEngine).toHaveBeenCalledWith(expect.anything(), failure);

    // Nouvelle variante dont toutes les positions sont déjà connues : rien à évaluer.
    const known = new Map<string, PositionEval>(
      [START, AFTER_D4].map((fen) => [fen, { fen, depth: 14, score: { cp: 0 }, pv: [] }]),
    );
    rerender({ fens: [START, AFTER_D4], known });
    expect(result.current.error).toBeUndefined();
  });
});
