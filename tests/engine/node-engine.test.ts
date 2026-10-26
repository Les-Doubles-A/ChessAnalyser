import { afterAll, describe, expect, it } from 'vitest';
import { buildReport } from '../../src/analysis/report';
import { runAnalysis } from '../../src/analysis/runAnalysis';
import { parseGame } from '../../src/chess/game';
import { createNodeEngine } from '../../src/engine/node-engine';
import { OPERA_PGN } from '../fixtures/chesscom';

const engine = createNodeEngine();
afterAll(() => engine.terminate());

describe('Stockfish 19 lite (Node)', () => {
  it('trouve un mat en 1 pour les blancs', async () => {
    const result = await engine.evaluate('6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', 10);
    expect(result.score).toEqual({ mate: 1, winner: 'w' });
    expect(result.bestMoveUci).toBe('d1d8');
  });

  it('trouve un mat en 1 pour les noirs (score ramené aux blancs)', async () => {
    const fen = 'rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 2';
    const result = await engine.evaluate(fen, 8);
    expect(result.score).toEqual({ mate: 1, winner: 'b' });
    expect(result.bestMoveUci).toBe('d8h4');
  });

  it('juge la position initiale proche de l’égalité', async () => {
    const result = await engine.evaluate(
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      12,
    );
    expect('cp' in result.score && Math.abs(result.score.cp)).toBeLessThan(80);
    expect(result.depth).toBe(12);
  });

  it('analyse la partie de l’Opéra de bout en bout, de façon reproductible', async () => {
    const game = parseGame(OPERA_PGN);
    const first = await runAnalysis(game, engine, { depth: 10 });
    const second = await runAnalysis(game, engine, { depth: 10 });
    expect(first.complete).toBe(true);
    expect(first.evals).toHaveLength(34);
    expect(first.evals.at(-1)?.score).toEqual({ mate: 0, winner: 'w' });
    expect(second.evals.map((e) => e?.score)).toEqual(first.evals.map((e) => e?.score));

    const report = buildReport(game, first.evals);
    expect(report.moves.at(-1)?.category).toBe('best');
    expect(report.accuracy.white).toBeGreaterThan(report.accuracy.black!);
  });
});
