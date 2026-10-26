import { describe, expect, it } from 'vitest';
import {
  confidenceOf,
  ELO_MAX,
  ELO_MIN,
  estimateElo,
  FEATURE_NAMES,
  featureVector,
  MIN_NON_BOOK_MOVES,
  playerFeatures,
  roundTo50,
  type PlayerFeatures,
  type PresetModel,
} from '../../src/analysis/elo';
import { buildReport } from '../../src/analysis/report';
import { parseGame } from '../../src/chess/game';
import type { PositionEval } from '../../src/engine/types';
import { fitRidge, median, quantile, solve } from '../../scripts/regression';
import { OPERA_PGN } from '../fixtures/chesscom';

const features = (overrides: Partial<PlayerFeatures> = {}): PlayerFeatures => ({
  accuracy: 80,
  meanLoss: 4,
  inaccuracyRate: 0.1,
  mistakeRate: 0.05,
  blunderRate: 0.02,
  moves: 25,
  ...overrides,
});

// Modèle jouet : 1000 + 1000 × précision, intervalle de -300 à +300.
const model: PresetModel = {
  coefficients: [1000, 1000, 0, 0, 0, 0, 0, 0, 0, 0],
  lower: -300,
  upper: 300,
  samples: 2000,
  depth: 14,
  engine: 'test',
};

function operaReport(complete = true) {
  const game = parseGame(OPERA_PGN);
  const fens = [game.startFen, ...game.plies.map((p) => p.fenAfter)];
  const evals: PositionEval[] = fens.map((fen, i) => ({
    fen,
    depth: 14,
    score: { cp: i % 4 === 3 ? -150 : 40 },
    pv: [],
  }));
  return buildReport(game, complete ? evals : evals.slice(0, 10));
}

describe('variables du modèle Elo (F6)', () => {
  it('compte les coups hors livre et les taux par joueur', () => {
    const report = operaReport();
    const white = playerFeatures(report, 'w')!;
    const black = playerFeatures(report, 'b')!;
    expect(white.moves).toBe(17);
    expect(black.moves).toBe(16);
    expect(white.accuracy).toBe(report.accuracy.white);
    for (const f of [white, black]) {
      expect(f.inaccuracyRate + f.mistakeRate + f.blunderRate).toBeLessThanOrEqual(1);
      expect(f.meanLoss).toBeGreaterThanOrEqual(0);
    }
  });

  it('AC-F6-3 : aucune variable ni estimation si l’analyse est incomplète', () => {
    const report = operaReport(false);
    expect(playerFeatures(report, 'w')).toBeNull();
    expect(estimateElo(playerFeatures(report, 'w'), 'blitz', model)).toBeNull();
  });

  it('vecteur dans l’ordre des noms, blitz en référence', () => {
    const x = featureVector(features(), 'rapid');
    expect(x).toHaveLength(FEATURE_NAMES.length);
    expect(x[0]).toBe(1);
    expect(x[1]).toBeCloseTo(0.8, 10);
    expect(x[2]).toBeCloseTo(0.64, 10);
    expect(x.slice(7)).toEqual([0, 1, 0]);
    expect(featureVector(features(), 'blitz').slice(7)).toEqual([0, 0, 0]);
  });
});

describe('estimation d’Elo (F6)', () => {
  it('AC-F6-1 : estimation multiple de 50 et intervalle', () => {
    const estimate = estimateElo(features({ accuracy: 73.3 }), 'blitz', model);
    expect(estimate).toEqual({
      kind: 'estimate',
      value: 1750,
      low: 1450,
      high: 2050,
      confidence: 'moyenne',
    });
  });

  it('AC-F6-2 : partie trop courte sous 10 coups hors livre', () => {
    expect(estimateElo(features({ moves: MIN_NON_BOOK_MOVES - 1 }), 'blitz', model)).toEqual({
      kind: 'too-short',
    });
    expect(estimateElo(features({ moves: MIN_NON_BOOK_MOVES }), 'blitz', model)?.kind).toBe(
      'estimate',
    );
  });

  it('AC-F6-5 : bornes 100 et 3200, même à 0 % ou 100 % de précision', () => {
    const extreme: PresetModel = { ...model, coefficients: [-5000, 20000, 0, 0, 0, 0, 0, 0, 0, 0] };
    const top = estimateElo(features({ accuracy: 100 }), 'blitz', extreme);
    const bottom = estimateElo(features({ accuracy: 0 }), 'blitz', extreme);
    expect(top).toMatchObject({ value: ELO_MAX, high: ELO_MAX });
    expect(bottom).toMatchObject({ value: ELO_MIN, low: ELO_MIN });
  });

  it('modèle absent pour le préréglage', () => {
    expect(estimateElo(features(), 'blitz', undefined)).toEqual({ kind: 'unavailable' });
  });

  it('arrondi et niveau de confiance', () => {
    expect(roundTo50(1474)).toBe(1450);
    expect(roundTo50(1475)).toBe(1500);
    expect(roundTo50(-20)).toBe(ELO_MIN);
    expect(confidenceOf(1400, 1800)).toBe('bonne');
    expect(confidenceOf(1400, 2100)).toBe('moyenne');
    expect(confidenceOf(1150, 1900)).toBe('faible');
  });
});

describe('outils de calibration', () => {
  it('résout un système linéaire', () => {
    const x = solve(
      [
        [2, 1, -1],
        [-3, -1, 2],
        [-2, 1, 2],
      ],
      [8, -11, -3],
    );
    expect(x.map((v) => Number(v.toFixed(9)))).toEqual([2, 3, -1]);
  });

  it('retrouve les coefficients d’une relation linéaire', () => {
    const rows = Array.from({ length: 50 }, (_, i) => [1, i / 10, (i * 7) % 11]);
    const targets = rows.map(([, a, b]) => 500 + 300 * a! - 20 * b!);
    const beta = fitRidge(rows, targets, 1e-9);
    expect(beta.map((v) => Math.round(v))).toEqual([500, 300, -20]);
  });

  it('quantiles et médiane', () => {
    expect(quantile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(quantile([0, 10], 0.1)).toBe(1);
    expect(median([5, 1, 3, 2])).toBe(2.5);
  });
});
