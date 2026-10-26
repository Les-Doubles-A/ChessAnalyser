// Estimation du niveau joué sur une partie (F6) : modèle linéaire calibré hors ligne
// (scripts/calibrate-elo.ts) sur des parties chess.com analysées avec le même moteur, le
// même préréglage et ces mêmes variables. Le site et les scripts partagent ce fichier.
import type { TimeClass } from '../api/chesscom';
import type { GameReport, MoveAnalysis } from './report';
import type { Preset } from './runAnalysis';

export const ELO_MIN = 100;
export const ELO_MAX = 3200;
/** F6 : en dessous, la partie ne dit presque rien du niveau. */
export const MIN_NON_BOOK_MOVES = 10;

export interface PlayerFeatures {
  /** Précision de partie (0 à 100), algorithme Lichess. */
  accuracy: number;
  /** Perte moyenne de Win% par coup hors livre. */
  meanLoss: number;
  inaccuracyRate: number;
  mistakeRate: number;
  blunderRate: number;
  /** Coups hors livre du joueur. */
  moves: number;
}

/** Variables d'un joueur ; null si l'analyse est incomplète ou la précision indisponible. */
export function playerFeatures(report: GameReport, color: 'w' | 'b'): PlayerFeatures | null {
  if (!report.complete) return null;
  const accuracy = color === 'w' ? report.accuracy.white : report.accuracy.black;
  if (accuracy === null) return null;
  const own = report.moves.filter(
    (m): m is MoveAnalysis => m !== undefined && m.color === color && m.category !== 'book',
  );
  const n = own.length;
  const rate = (category: MoveAnalysis['category']) =>
    n ? own.filter((m) => m.category === category).length / n : 0;
  return {
    accuracy,
    meanLoss: n ? own.reduce((sum, m) => sum + m.loss, 0) / n : 0,
    inaccuracyRate: rate('inaccuracy'),
    mistakeRate: rate('mistake'),
    blunderRate: rate('blunder'),
    moves: n,
  };
}

/** Ordre des coefficients du modèle ; le blitz sert de référence pour la cadence. */
export const FEATURE_NAMES = [
  'constante',
  'precision',
  'precision2',
  'logPerteMoyenne',
  'tauxImprecisions',
  'tauxErreurs',
  'tauxGaffes',
  'bullet',
  'rapide',
  'daily',
] as const;

export function featureVector(f: PlayerFeatures, timeClass: TimeClass | 'unknown'): number[] {
  const accuracy = f.accuracy / 100;
  return [
    1,
    accuracy,
    accuracy * accuracy,
    Math.log1p(f.meanLoss),
    f.inaccuracyRate,
    f.mistakeRate,
    f.blunderRate,
    timeClass === 'bullet' ? 1 : 0,
    timeClass === 'rapid' ? 1 : 0,
    timeClass === 'daily' ? 1 : 0,
  ];
}

export interface PresetModel {
  coefficients: number[];
  /** Quantiles 10 % et 90 % des résidus (classement réel moins prédiction) en calibration. */
  lower: number;
  upper: number;
  samples: number;
  depth: number;
  engine: string;
}

export interface EloModel {
  features: readonly string[];
  presets: Partial<Record<Preset, PresetModel>>;
}

export type EloEstimate =
  | { kind: 'estimate'; value: number; low: number; high: number; confidence: Confidence }
  | { kind: 'too-short' }
  | { kind: 'unavailable' };

export type Confidence = 'faible' | 'moyenne' | 'bonne';

const clampElo = (value: number) => Math.max(ELO_MIN, Math.min(ELO_MAX, value));
export const roundTo50 = (value: number) => Math.round(clampElo(value) / 50) * 50;

/** Largeur de l'intervalle à 80 % : plus de 700 points, la confiance est faible. */
export function confidenceOf(low: number, high: number): Confidence {
  const width = high - low;
  if (width <= 400) return 'bonne';
  if (width <= 700) return 'moyenne';
  return 'faible';
}

export function predict(model: PresetModel, x: readonly number[]): number {
  return model.coefficients.reduce((sum, c, i) => sum + c * (x[i] ?? 0), 0);
}

/**
 * Estimation pour un joueur. null si l'analyse est incomplète (AC-F6-3), « trop courte »
 * sous 10 coups hors livre (AC-F6-2), bornée à [100, 3200] et arrondie à 50 (AC-F6-5).
 */
export function estimateElo(
  features: PlayerFeatures | null,
  timeClass: TimeClass | 'unknown',
  model: PresetModel | undefined,
): EloEstimate | null {
  if (!features) return null;
  if (features.moves < MIN_NON_BOOK_MOVES) return { kind: 'too-short' };
  if (!model) return { kind: 'unavailable' };
  const raw = predict(model, featureVector(features, timeClass));
  const low = roundTo50(raw + model.lower);
  const high = roundTo50(raw + model.upper);
  return {
    kind: 'estimate',
    value: roundTo50(raw),
    low,
    high,
    confidence: confidenceOf(low, high),
  };
}
