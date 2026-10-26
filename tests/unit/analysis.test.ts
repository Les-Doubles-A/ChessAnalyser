import { describe, expect, it } from 'vitest';
import { gameAccuracy, moveAccuracy } from '../../src/analysis/accuracy';
import { classify, lossCategory, type MoveFacts } from '../../src/analysis/classify';
import {
  bookFlags,
  createOpeningIndex,
  openingOf,
  type OpeningData,
} from '../../src/analysis/openings';
import { buildReport } from '../../src/analysis/report';
import {
  formatScore,
  whiteBarPercent,
  whiteWinPercent,
  winPercentFromCp,
} from '../../src/analysis/winPercent';
import { parseGame } from '../../src/chess/game';
import type { PositionEval } from '../../src/engine/types';
import { FOOLS_MATE_PGN } from '../fixtures/chesscom';
import { GAME_REF_01 } from '../fixtures/game-ref-01';
import openingsJson from '../../src/data/openings.json';

describe('probabilité de gain (F4)', () => {
  it('AC-F4-1 : +150 centipions donnent 63,47 %', () => {
    expect(winPercentFromCp(150)).toBeCloseTo(63.47, 2);
    expect(whiteBarPercent({ cp: 150 })).toBeCloseTo(63.47, 2);
    expect(formatScore({ cp: 150 })).toBe('+1.5');
  });

  it('formate les scores', () => {
    expect(formatScore({ cp: -80 })).toBe('-0.8');
    expect(formatScore({ cp: 4 })).toBe('0.0');
    expect(formatScore({ cp: -4 })).toBe('0.0');
    expect(formatScore({ mate: 3, winner: 'w' })).toBe('M3');
    expect(formatScore({ mate: 0, winner: 'b' })).toBe('Mat');
  });

  it('AC-F4-2 : un mat des noirs donne « -M3 » et une barre entièrement noire', () => {
    expect(formatScore({ mate: 3, winner: 'b' })).toBe('-M3');
    expect(whiteBarPercent({ mate: 3, winner: 'b' })).toBe(0);
  });

  it('plafonne à ±1000 centipions et traite le mat comme le plafond (scalachess)', () => {
    expect(winPercentFromCp(5000)).toBe(winPercentFromCp(1000));
    expect(whiteWinPercent({ mate: 2, winner: 'w' })).toBe(winPercentFromCp(1000));
    expect(whiteWinPercent({ mate: 2, winner: 'b' })).toBe(winPercentFromCp(-1000));
    expect(winPercentFromCp(0)).toBe(50);
  });
});

describe('précision (portage des tests de lila AccuracyPercentTest)', () => {
  const compute = (cps: number[], start: 'w' | 'b' = 'w') =>
    gameAccuracy([15, ...cps].map(winPercentFromCp), start);

  it('cas limites', () => {
    expect(compute([])).toEqual({ white: null, black: null });
    expect(compute([15]).black).toBeNull();
  });

  it.each([
    ['deux bons coups', [15, 15], 100, 1, 100, 1],
    ['gaffe des blancs au premier coup', [-900, -900], 10, 5, 100, 1],
    ['gaffe des noirs au premier coup', [15, 900], 100, 1, 10, 5],
    ['gaffes des deux camps', [-900, 0], 10, 5, 10, 5],
    ['20 coups parfaits', Array(20).fill(15), 100, 1, 100, 1],
    ['20 coups parfaits puis gaffe blanche', [...Array(20).fill(15), -900], 50, 5, 100, 1],
    ['21 coups parfaits puis gaffe noire', [...Array(21).fill(15), 900], 100, 1, 50, 5],
    ['5 coups moyens par camp', Array(5).fill([-50, 15]).flat(), 76, 8, 76, 8],
    ['50 coups moyens par camp', Array(50).fill([-50, 15]).flat(), 76, 8, 76, 8],
    ['50 coups médiocres par camp', Array(50).fill([-135, 15]).flat(), 54, 8, 54, 8],
    ['50 coups terribles par camp', Array(50).fill([-435, 15]).flat(), 20, 8, 20, 8],
  ])('%s', (_, cps, white, wTol, black, bTol) => {
    const result = compute(cps as number[]);
    expect(Math.abs(result.white! - (white as number))).toBeLessThanOrEqual(wTol as number);
    expect(Math.abs(result.black! - (black as number))).toBeLessThanOrEqual(bTol as number);
  });

  it('AC-F5-5 : partie de référence game-ref-01, à 0,1 près', () => {
    const result = gameAccuracy(GAME_REF_01.cps.map(winPercentFromCp), 'w');
    expect(Math.abs(result.white! - GAME_REF_01.expected.white)).toBeLessThan(0.1);
    expect(Math.abs(result.black! - GAME_REF_01.expected.black)).toBeLessThan(0.1);
  });

  it('précision par coup bornée à [0, 100]', () => {
    expect(moveAccuracy(50, 60)).toBe(100);
    expect(moveAccuracy(99, 0)).toBe(0);
    expect(moveAccuracy(60, 60)).toBe(100);
  });
});

describe('classification (F5)', () => {
  const facts = (overrides: Partial<MoveFacts>): MoveFacts => ({
    winBefore: 60,
    winAfter: 60,
    playedUci: 'e2e4',
    bestUci: 'd2d4',
    legalMoveCount: 20,
    isBook: false,
    ...overrides,
  });

  it('AC-F5-1 : seuils de perte', () => {
    const at = (loss: number) => classify(facts({ winBefore: 60, winAfter: 60 - loss }));
    expect([1.9, 2, 4.9, 5, 10, 20].map(at)).toEqual([
      'excellent',
      'good',
      'good',
      'inaccuracy',
      'mistake',
      'blunder',
    ]);
    expect(classify(facts({ playedUci: 'd2d4', winAfter: 10 }))).toBe('best');
    expect(lossCategory(0)).toBe('excellent');
  });

  it('AC-F5-2 : un seul coup légal donne « forcé », quelle que soit la perte', () => {
    expect(classify(facts({ legalMoveCount: 1, winAfter: 0 }))).toBe('forced');
  });

  it('AC-F5-3 : livre jusqu’au premier coup hors base', () => {
    const index = createOpeningIndex({
      names: { a: ['C20', 'Ouverture A'], c: ['C21', 'Ouverture C'] },
      book: ['b'],
    } as OpeningData);
    const fen = (epd: string) => `${epd} x x x 0 1`;
    // Les EPD factices tiennent sur un champ ; toEpd garde les 4 premiers.
    const flags = bookFlags(['a', 'b', 'z', 'c'].map(fen), {
      isBook: (f) => index.isBook(f.split(' ')[0]!),
      nameOf: (f) => index.nameOf(f.split(' ')[0]!),
    });
    expect(flags).toEqual([true, true, false, false]);
    expect(classify(facts({ isBook: true, winAfter: 57 }))).toBe('book');
    // Un coup « livre » qui perd 5 points ou plus est classé selon sa perte.
    expect(classify(facts({ isBook: true, winAfter: 55 }))).toBe('inaccuracy');
    expect(classify(facts({ isBook: true, winAfter: 0 }))).toBe('blunder');
  });

  it('reconnaît l’ouverture d’une vraie partie avec la base Lichess', () => {
    const index = createOpeningIndex(openingsJson as OpeningData);
    const game = parseGame(FOOLS_MATE_PGN);
    const fens = game.plies.map((p) => p.fenAfter);
    expect(bookFlags(fens, index)).toEqual([true, true, true, true]);
    expect(openingOf(fens, index)?.eco).toMatch(/^A0/);
    expect(openingOf(fens, index)?.name).toMatch(/Barnes|Fool/i);
  });
});

describe('rapport de partie', () => {
  it('assemble catégories, meilleur coup en SAN et précision', () => {
    const game = parseGame(FOOLS_MATE_PGN);
    const fens = [game.startFen, ...game.plies.map((p) => p.fenAfter)];
    const ev = (i: number, cp: number, best?: string): PositionEval => ({
      fen: fens[i]!,
      depth: 14,
      score: { cp },
      bestMoveUci: best,
      pv: [],
    });
    const evals: PositionEval[] = [
      ev(0, 20, 'e2e4'),
      ev(1, -60, 'e7e5'),
      ev(2, -60, 'e2e4'),
      ev(3, -2000, 'd8h4'),
      { fen: fens[4]!, depth: 0, score: { mate: 0, winner: 'b' }, pv: [] },
    ];
    const report = buildReport(game, evals);

    expect(report.complete).toBe(true);
    expect(report.moves[0]).toMatchObject({ category: 'inaccuracy', bestMoveSan: 'e4' });
    expect(report.moves[1]).toMatchObject({ category: 'best', color: 'b' });
    expect(report.moves[2]).toMatchObject({ category: 'blunder', bestMoveSan: 'e4' });
    expect(report.moves[3]).toMatchObject({ category: 'best', bestMoveSan: 'Qh4#' });
    expect(report.accuracy.white).toBeLessThan(report.accuracy.black!);
  });

  it('analyse partielle : coups non évalués absents, rapport incomplet', () => {
    const game = parseGame(FOOLS_MATE_PGN);
    const evals = [{ fen: game.startFen, depth: 14, score: { cp: 20 }, pv: [] }];
    const report = buildReport(game, evals);
    expect(report.complete).toBe(false);
    expect(report.moves.every((m) => m === undefined)).toBe(true);
  });
});
