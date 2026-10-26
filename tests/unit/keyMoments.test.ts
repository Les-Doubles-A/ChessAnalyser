import { describe, expect, it } from 'vitest';
import { keyMoments, summarizeGame } from '../../src/analysis/keyMoments';
import { createOpeningIndex, type OpeningData } from '../../src/analysis/openings';
import { buildReport, type MoveAnalysis } from '../../src/analysis/report';
import { parseGame } from '../../src/chess/game';
import type { PositionEval } from '../../src/engine/types';
import { FOOLS_MATE_PGN, OPERA_PGN } from '../fixtures/chesscom';
import openingsJson from '../../src/data/openings.json';

const sum = (counts: Record<string, number>) => Object.values(counts).reduce((a, b) => a + b, 0);

function foolsMateEvals(): PositionEval[] {
  const game = parseGame(FOOLS_MATE_PGN);
  const fens = [game.startFen, ...game.plies.map((p) => p.fenAfter)];
  const ev = (i: number, cp: number, best: string): PositionEval => ({
    fen: fens[i]!,
    depth: 14,
    score: { cp },
    bestMoveUci: best,
    pv: [],
  });
  return [
    ev(0, 20, 'e2e4'),
    ev(1, -60, 'e7e5'),
    ev(2, -60, 'e2e4'),
    ev(3, -2000, 'd8h4'),
    { fen: fens[4]!, depth: 0, score: { mate: 0, winner: 'b' }, pv: [] },
  ];
}

const moment = (plyIndex: number, loss: number, category: MoveAnalysis['category']) =>
  ({ plyIndex, loss, category, color: plyIndex % 2 ? 'w' : 'b' }) as MoveAnalysis;

describe('synthèse de la partie (F7)', () => {
  it('AC-F7-1 : la somme des compteurs égale le nombre de coups de chaque joueur', () => {
    const game = parseGame(OPERA_PGN);
    const fens = [game.startFen, ...game.plies.map((p) => p.fenAfter)];
    const evals = fens.map((fen, i) => ({
      fen,
      depth: 14,
      score: { cp: (i % 7) * 90 - 300 },
      pv: [],
    }));
    const whiteMoves = game.plies.filter((p) => p.color === 'w').length;
    const blackMoves = game.plies.length - whiteMoves;

    const full = summarizeGame(game, buildReport(game, evals));
    expect(sum(full.counts.w)).toBe(whiteMoves);
    expect(sum(full.counts.b)).toBe(blackMoves);
    expect(full.counts.w.unanalysed + full.counts.b.unanalysed).toBe(0);

    // Analyse interrompue : les coups manquants sont comptés « Non analysé ».
    const partial = summarizeGame(game, buildReport(game, evals.slice(0, 11)));
    expect(sum(partial.counts.w)).toBe(whiteMoves);
    expect(sum(partial.counts.b)).toBe(blackMoves);
    expect(partial.counts.w.unanalysed + partial.counts.b.unanalysed).toBe(game.plies.length - 10);
  });

  it('compte les catégories du mat du lion', () => {
    const game = parseGame(FOOLS_MATE_PGN);
    const { counts } = summarizeGame(game, buildReport(game, foolsMateEvals()));
    expect(counts.w).toMatchObject({ inaccuracy: 1, blunder: 1 });
    expect(counts.b).toMatchObject({ best: 2 });
  });

  it('AC-F7-2 : ouverture la plus longue trouvée, ou aucune', () => {
    const game = parseGame(FOOLS_MATE_PGN);
    const report = buildReport(game, []);
    const lichess = createOpeningIndex(openingsJson as OpeningData);
    expect(summarizeGame(game, report, lichess).opening?.eco).toMatch(/^A0/);
    // Base chargée sans correspondance : null (« Ouverture non répertoriée ») ; non chargée : undefined.
    expect(
      summarizeGame(game, report, createOpeningIndex({ names: {}, book: [] })).opening,
    ).toBeNull();
    expect(summarizeGame(game, report).opening).toBeUndefined();
  });

  it('AC-F7-2 : une position nommée atteinte après la sortie de la base est ignorée', () => {
    const game = parseGame(FOOLS_MATE_PGN);
    const epd = (i: number) => game.plies[i]!.fenAfter.split(' ').slice(0, 4).join(' ');
    const index = createOpeningIndex({
      names: {
        [epd(0)]: ['A00', 'Premier'],
        [epd(1)]: ['A01', 'Second'],
        [epd(3)]: ['Z99', 'Hors préfixe'],
      },
      book: [],
    });
    // Le 2e demi-coup est nommé ; le 3e sort de la base ; le 4e, nommé, ne compte plus.
    expect(summarizeGame(game, buildReport(game, []), index).opening).toEqual({
      eco: 'A01',
      name: 'Second',
    });
  });

  it('AC-F7-3 : au plus 3 moments clés, les plus fortes pertes, dans l’ordre chronologique', () => {
    const moves = [
      moment(1, 12, 'mistake'),
      moment(2, 40, 'blunder'),
      undefined,
      moment(4, 8, 'inaccuracy'),
      moment(5, 25, 'blunder'),
      moment(6, 11, 'mistake'),
      moment(7, 30, 'blunder'),
      moment(8, 50, 'forced'),
    ];
    expect(keyMoments(moves).map((m) => m.plyIndex)).toEqual([2, 5, 7]);
  });

  it('AC-F7-3 : aucune erreur majeure', () => {
    expect(keyMoments([moment(1, 9.9, 'inaccuracy'), moment(2, 0, 'best'), undefined])).toEqual([]);
  });
});
