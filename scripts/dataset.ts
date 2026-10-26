// Jeu de calibration de l'Elo (T10) : règles de sélection, d'anonymisation et de
// séparation, partagées par les scripts collect-games, analyse-dataset et split-dataset.
import { createHash, createHmac } from 'node:crypto';
import type { Preset } from '../src/analysis/runAnalysis';
import type { GameSummary, TimeClass } from '../src/api/chesscom';
import type { Score } from '../src/engine/types';

export const MIN_RATING = 400;
export const MAX_RATING = 2600;
export const BAND_WIDTH = 200;
export const BAND_COUNT = (MAX_RATING - MIN_RATING) / BAND_WIDTH;

/** Parties visées par tranche de 200 points et par cadence : 11 × 215 = 2365 parties. */
export const QUOTA: Record<TimeClass, number> = { bullet: 65, blitz: 65, rapid: 65, daily: 20 };
export const TIME_CLASSES = Object.keys(QUOTA) as TimeClass[];

/** F6 exige 10 coups hors livre par joueur : une partie plus courte n'apprend rien au modèle. */
export const MIN_MOVES = 15;
/** Plafond par joueur visité, pour varier les joueurs plutôt que les parties d'un seul. */
export const MAX_GAMES_PER_PLAYER = 3;

export interface CollectedGame {
  /** HMAC de l'URL de la partie : sert au dédoublonnage sans garder l'URL. */
  id: string;
  /** HMAC des pseudos : regroupe les parties d'un joueur sans garder son pseudo. */
  white: string;
  black: string;
  whiteRating: number;
  blackRating: number;
  timeClass: TimeClass;
  /** PGN réduit aux en-têtes sans donnée personnelle. */
  pgn: string;
}

/** Résultat de scripts/analyse-dataset.ts, une ligne par partie et par préréglage. */
export interface AnalysedGame {
  id: string;
  preset: Preset;
  depth: number;
  engine: string;
  /** Une entrée par position (N+1) : score du point de vue des blancs et meilleur coup. */
  evals?: { s: Score; b?: string }[];
  error?: string;
}

export interface Candidate {
  username: string;
  /** Classement observé dans une partie, absent pour les joueurs de départ. */
  rating?: number;
  timeClass?: TimeClass;
}

export type Counts = Map<string, number>;

export function bandOf(rating: number): number | null {
  if (rating < MIN_RATING || rating >= MAX_RATING) return null;
  return Math.floor((rating - MIN_RATING) / BAND_WIDTH);
}

export function bandLabel(band: number): string {
  const low = MIN_RATING + band * BAND_WIDTH;
  return `${low}-${low + BAND_WIDTH - 1}`;
}

const quotaKey = (band: number, timeClass: TimeClass) => `${band}:${timeClass}`;

export function remaining(counts: Counts, band: number, timeClass: TimeClass): number {
  return Math.max(0, QUOTA[timeClass] - (counts.get(quotaKey(band, timeClass)) ?? 0));
}

export function totalRemaining(counts: Counts): number {
  let total = 0;
  for (let band = 0; band < BAND_COUNT; band++) {
    for (const timeClass of TIME_CLASSES) total += remaining(counts, band, timeClass);
  }
  return total;
}

/** Tranche d'une partie : moyenne des deux classements (les appariements sont serrés). */
export function gameBand(white: number, black: number): number | null {
  return bandOf((white + black) / 2);
}

export function countGame(
  counts: Counts,
  game: Pick<CollectedGame, 'whiteRating' | 'blackRating' | 'timeClass'>,
) {
  const band = gameBand(game.whiteRating, game.blackRating);
  if (band === null) return;
  const key = quotaKey(band, game.timeClass);
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

export function isEligible(game: GameSummary): boolean {
  return (
    game.rated &&
    game.supported &&
    game.timeClass !== 'unknown' &&
    game.moveCount >= MIN_MOVES &&
    gameBand(game.white.rating, game.black.rating) !== null
  );
}

/**
 * Choisit au plus `max` parties dans les tranches et cadences encore ouvertes, en
 * commençant par les plus récentes. Met à jour `counts` et `seen`.
 */
export function pickGames(
  games: GameSummary[],
  counts: Counts,
  seen: Set<string>,
  idOf: (url: string) => string,
  max = MAX_GAMES_PER_PLAYER,
): GameSummary[] {
  const picked: GameSummary[] = [];
  for (const game of games) {
    if (picked.length >= max) break;
    if (game.timeClass === 'unknown' || !isEligible(game)) continue;
    const band = gameBand(game.white.rating, game.black.rating)!;
    const id = idOf(game.url);
    if (seen.has(id) || remaining(counts, band, game.timeClass) === 0) continue;
    seen.add(id);
    countGame(counts, {
      whiteRating: game.white.rating,
      blackRating: game.black.rating,
      timeClass: game.timeClass,
    });
    picked.push(game);
  }
  return picked;
}

/**
 * Intérêt d'un joueur à visiter : le manque de parties dans sa tranche et sa cadence.
 * Un joueur de départ (classement inconnu) passe après tout joueur utile.
 */
export function candidateScore(candidate: Candidate, counts: Counts): number {
  if (candidate.rating === undefined) return 0.5;
  const band = bandOf(candidate.rating);
  if (band === null) return 0;
  if (candidate.timeClass) return remaining(counts, band, candidate.timeClass);
  return TIME_CLASSES.reduce((sum, timeClass) => sum + remaining(counts, band, timeClass), 0);
}

/** Index du prochain joueur à visiter, -1 si aucun n'est utile. Égalités départagées au hasard. */
export function nextCandidate(queue: Candidate[], counts: Counts, random: () => number): number {
  let best = -1;
  let bestScore = 0;
  for (let i = 0; i < queue.length; i++) {
    const score = candidateScore(queue[i]!, counts);
    if (score <= 0) continue;
    const jittered = score + random() * 0.25;
    if (jittered > bestScore) {
      best = i;
      bestScore = jittered;
    }
  }
  return best;
}

const KEPT_HEADERS = new Set(['Result', 'TimeControl', 'SetUp', 'FEN']);
const HEADER_RE = /^\[(\w+)\s+"[^"]*"\]\s*$/;

/** Retire du PGN les en-têtes qui identifient les joueurs (noms, lien, date, fin de partie…). */
export function anonymizePgn(pgn: string): string {
  const headers: string[] = [];
  const movetext: string[] = [];
  for (const line of pgn.split(/\r?\n/)) {
    const match = HEADER_RE.exec(line.trim());
    if (match) {
      if (KEPT_HEADERS.has(match[1]!)) headers.push(line.trim());
    } else if (line.trim()) {
      movetext.push(line.trim());
    }
  }
  return `${headers.join('\n')}\n\n${movetext.join(' ')}\n`;
}

export function pseudonymizer(secret: string): (value: string) => string {
  return (value) => createHmac('sha256', secret).update(value).digest('hex').slice(0, 16);
}

export function toCollected(game: GameSummary, pseudo: (value: string) => string): CollectedGame {
  if (game.timeClass === 'unknown') throw new Error('Cadence inconnue');
  return {
    id: pseudo(game.url),
    white: pseudo(game.white.username.toLowerCase()),
    black: pseudo(game.black.username.toLowerCase()),
    whiteRating: game.white.rating,
    blackRating: game.black.rating,
    timeClass: game.timeClass,
    pgn: anonymizePgn(game.pgn),
  };
}

/** Une partie vue du côté d'un joueur : l'unité de calibration du modèle F6. */
export interface Sample {
  game: string;
  side: 'w' | 'b';
  player: string;
  rating: number;
  opponentRating: number;
  timeClass: TimeClass;
}

export function samplesOf(game: CollectedGame): Sample[] {
  const { id, timeClass } = game;
  return [
    {
      game: id,
      side: 'w',
      player: game.white,
      rating: game.whiteRating,
      opponentRating: game.blackRating,
      timeClass,
    },
    {
      game: id,
      side: 'b',
      player: game.black,
      rating: game.blackRating,
      opponentRating: game.whiteRating,
      timeClass,
    },
  ];
}

/** Nombre stable dans [0, 1) pour une graine et un joueur. */
export function unitHash(seed: string, value: string): number {
  return createHash('sha256').update(`${seed}:${value}`).digest().readUInt32BE(0) / 2 ** 32;
}

/**
 * Séparation fixe par joueur : tous les échantillons d'un même joueur tombent du même
 * côté, pour que la validation ne porte que sur des joueurs absents de la calibration.
 */
export function splitSamples(samples: Sample[], seed: string, validationShare: number) {
  const calibration: Sample[] = [];
  const validation: Sample[] = [];
  for (const sample of samples) {
    (unitHash(seed, sample.player) < validationShare ? validation : calibration).push(sample);
  }
  return { calibration, validation };
}

/** Avancement de la collecte : parties obtenues sur parties visées, par tranche et cadence. */
export function quotaReport(counts: Counts): string {
  const rows = [['Tranche', ...TIME_CLASSES].join('\t')];
  for (let band = 0; band < BAND_COUNT; band++) {
    const cells = TIME_CLASSES.map(
      (timeClass) => `${counts.get(quotaKey(band, timeClass)) ?? 0}/${QUOTA[timeClass]}`,
    );
    rows.push([bandLabel(band), ...cells].join('\t'));
  }
  return rows.join('\n');
}

/** Tableau texte des effectifs par tranche d'Elo et par cadence. */
export function distributionReport(title: string, samples: Sample[]): string {
  const rows: string[] = [title, ['Tranche', ...TIME_CLASSES, 'total'].join('\t')];
  const totals = new Map<string, number>();
  for (let band = -1; band <= BAND_COUNT; band++) {
    const inBand = samples.filter((s) => {
      const b = bandOf(s.rating);
      return band === -1
        ? b === null && s.rating < MIN_RATING
        : band === BAND_COUNT
          ? b === null && s.rating >= MAX_RATING
          : b === band;
    });
    if (inBand.length === 0) continue;
    const label =
      band === -1 ? `<${MIN_RATING}` : band === BAND_COUNT ? `>=${MAX_RATING}` : bandLabel(band);
    const cells = TIME_CLASSES.map((timeClass) => {
      const n = inBand.filter((s) => s.timeClass === timeClass).length;
      totals.set(timeClass, (totals.get(timeClass) ?? 0) + n);
      return String(n);
    });
    rows.push([label, ...cells, String(inBand.length)].join('\t'));
  }
  rows.push(
    ['total', ...TIME_CLASSES.map((t) => String(totals.get(t) ?? 0)), String(samples.length)].join(
      '\t',
    ),
  );
  return rows.join('\n');
}
