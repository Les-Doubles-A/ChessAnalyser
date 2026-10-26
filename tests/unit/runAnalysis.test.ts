import { describe, expect, it, vi } from 'vitest';
import { runAnalysis, terminalEval } from '../../src/analysis/runAnalysis';
import { parseGame } from '../../src/chess/game';
import { abortError, EngineStartError, type Engine } from '../../src/engine/types';
import { FOOLS_MATE_PGN } from '../fixtures/chesscom';

function fakeEngine(overrides: Partial<Engine> = {}): Engine & { evaluated: string[] } {
  const evaluated: string[] = [];
  return {
    evaluated,
    newGame: vi.fn(async () => undefined),
    evaluate: vi.fn(async (fen: string, depth: number) => {
      evaluated.push(fen);
      return { fen, depth, score: { cp: 10 }, bestMoveUci: 'e2e4', pv: ['e2e4'] };
    }),
    terminate: vi.fn(),
    ...overrides,
  };
}

const game = parseGame(FOOLS_MATE_PGN);

describe('runAnalysis', () => {
  it('AC-F3-1 : évalue chaque position et signale la progression', async () => {
    const engine = fakeEngine();
    const progress: number[] = [];
    const result = await runAnalysis(game, engine, {
      depth: 14,
      onPosition: (i) => progress.push(i),
    });
    expect(result.complete).toBe(true);
    expect(result.evals).toHaveLength(5);
    expect(progress).toEqual([0, 1, 2, 3, 4]);
    expect(engine.newGame).toHaveBeenCalledOnce();
  });

  it('AC-F3-6 : la position de mat est évaluée sans moteur', async () => {
    const engine = fakeEngine();
    const result = await runAnalysis(game, engine, { depth: 14 });
    expect(engine.evaluated).toHaveLength(4);
    expect(result.evals[4]).toMatchObject({ depth: 0, score: { mate: 0, winner: 'b' } });
  });

  it('AC-F3-6 : un pat vaut 0.00 sans moteur', () => {
    expect(terminalEval('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1')).toMatchObject({ score: { cp: 0 } });
    expect(terminalEval('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')).toBeNull();
  });

  it('AC-F3-3 : une annulation garde les évaluations obtenues', async () => {
    const controller = new AbortController();
    let calls = 0;
    const engine = fakeEngine({
      evaluate: vi.fn(async (fen: string, depth: number) => {
        calls++;
        if (calls === 3) {
          controller.abort();
          throw abortError();
        }
        return { fen, depth, score: { cp: 0 }, pv: [] };
      }),
    });
    const result = await runAnalysis(game, engine, { depth: 14, signal: controller.signal });
    expect(result.complete).toBe(false);
    expect(result.evals.filter(Boolean)).toHaveLength(2);
  });

  it('AC-F3-4 : une erreur de démarrage du moteur est propagée', async () => {
    const engine = fakeEngine({
      newGame: vi.fn(async () => {
        throw new EngineStartError();
      }),
    });
    await expect(runAnalysis(game, engine, { depth: 14 })).rejects.toBeInstanceOf(EngineStartError);
  });
});
