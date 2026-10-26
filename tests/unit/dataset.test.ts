import { describe, expect, it } from 'vitest';
import type { GameSummary, TimeClass } from '../../src/api/chesscom';
import {
  anonymizePgn,
  bandOf,
  candidateScore,
  countGame,
  isEligible,
  MIN_MOVES,
  nextCandidate,
  pickGames,
  pseudonymizer,
  QUOTA,
  samplesOf,
  splitSamples,
  toCollected,
  totalRemaining,
  type Counts,
} from '../../scripts/dataset';
import { OPERA_PGN } from '../fixtures/chesscom';

let nextId = 0;
function game(overrides: Partial<GameSummary> & { ratings?: [number, number] } = {}): GameSummary {
  const [white, black] = overrides.ratings ?? [1500, 1520];
  nextId++;
  return {
    url: `https://www.chess.com/game/live/${nextId}`,
    endTime: 1_800_000_000 - nextId,
    timeClass: 'blitz',
    rules: 'chess',
    rated: true,
    white: { username: `Blanc${nextId}`, rating: white, result: 'win' },
    black: { username: `Noir${nextId}`, rating: black, result: 'resigned' },
    pgn: OPERA_PGN,
    moveCount: 30,
    supported: true,
    ...overrides,
  };
}

const identity = (value: string) => value;

describe('sélection des parties de calibration (T10)', () => {
  it('tranches de 200 points de 400 à 2599', () => {
    expect(bandOf(399)).toBeNull();
    expect(bandOf(400)).toBe(0);
    expect(bandOf(599)).toBe(0);
    expect(bandOf(600)).toBe(1);
    expect(bandOf(2599)).toBe(10);
    expect(bandOf(2600)).toBeNull();
  });

  it('écarte les parties non classées, de variante, trop courtes ou hors tranches', () => {
    expect(isEligible(game())).toBe(true);
    expect(isEligible(game({ rated: false }))).toBe(false);
    expect(isEligible(game({ rules: 'chess960', supported: false }))).toBe(false);
    expect(isEligible(game({ timeClass: 'unknown' }))).toBe(false);
    expect(isEligible(game({ moveCount: MIN_MOVES - 1 }))).toBe(false);
    expect(isEligible(game({ ratings: [300, 350] }))).toBe(false);
    // Tranche d'une partie : moyenne des deux classements.
    expect(isEligible(game({ ratings: [350, 470] }))).toBe(true);
  });

  it('respecte le plafond par joueur, les quotas et le dédoublonnage', () => {
    const counts: Counts = new Map();
    const seen = new Set<string>();
    const games = Array.from({ length: 5 }, () => game());
    expect(pickGames(games, counts, seen, identity, 3)).toHaveLength(3);
    // Les parties déjà vues ne sont pas reprises.
    expect(pickGames(games.slice(0, 3), counts, seen, identity, 3)).toHaveLength(0);

    // Quota plein : plus rien dans cette tranche et cette cadence.
    const full: Counts = new Map();
    for (let i = 0; i < QUOTA.daily; i++) {
      countGame(full, { whiteRating: 1500, blackRating: 1500, timeClass: 'daily' });
    }
    const daily = game({ timeClass: 'daily' });
    expect(pickGames([daily], full, new Set(), identity)).toEqual([]);
    expect(pickGames([game({ timeClass: 'rapid' })], full, new Set(), identity)).toHaveLength(1);
  });

  it('les quotas visent au moins 2300 parties', () => {
    expect(totalRemaining(new Map())).toBeGreaterThanOrEqual(2300);
  });

  it('visite d’abord les joueurs des tranches les moins remplies', () => {
    const counts: Counts = new Map();
    for (let i = 0; i < 60; i++) {
      countGame(counts, { whiteRating: 1500, blackRating: 1500, timeClass: 'blitz' });
    }
    const queue = [
      { username: 'depart' },
      { username: 'remplie', rating: 1500, timeClass: 'blitz' as TimeClass },
      { username: 'vide', rating: 2450, timeClass: 'blitz' as TimeClass },
      { username: 'horsTranche', rating: 3000, timeClass: 'blitz' as TimeClass },
    ];
    expect(queue[nextCandidate(queue, counts, () => 0)]!.username).toBe('vide');
    expect(candidateScore(queue[3]!, counts)).toBe(0);
    // Un joueur de départ sert quand aucun joueur utile n'est connu.
    expect(queue[nextCandidate([queue[0]!, queue[3]!], counts, () => 0)]!.username).toBe('depart');
    expect(nextCandidate([queue[3]!], counts, () => 0)).toBe(-1);
  });
});

describe('anonymisation (T10)', () => {
  const pgn = [
    '[Event "Live Chess"]',
    '[Site "Chess.com"]',
    '[Date "2026.10.20"]',
    '[White "vraiPseudo"]',
    '[Black "autrePseudo"]',
    '[Result "1-0"]',
    '[WhiteElo "1650"]',
    '[TimeControl "600"]',
    '[Termination "vraiPseudo won by resignation"]',
    '[Link "https://www.chess.com/game/live/123"]',
    '',
    '1. e4 {[%clk 0:09:59]} 1... e5 {[%clk 0:09:58]} 1-0',
    '',
  ].join('\n');

  it('ne garde que les en-têtes sans donnée personnelle', () => {
    const result = anonymizePgn(pgn);
    expect(result).not.toMatch(/Pseudo|Link|Date|Event/);
    expect(result).toBe(
      '[Result "1-0"]\n[TimeControl "600"]\n\n1. e4 {[%clk 0:09:59]} 1... e5 {[%clk 0:09:58]} 1-0\n',
    );
  });

  it('pseudonymise pseudos et URL, garde classements, cadence et coups', () => {
    const pseudo = pseudonymizer('secret-de-test');
    const source = game({ pgn });
    const collected = toCollected(source, pseudo);
    expect(JSON.stringify(collected)).not.toMatch(/Blanc|Noir|vraiPseudo|chess\.com\/game/i);
    expect(collected.white).toBe(pseudo(source.white.username.toLowerCase()));
    expect(collected.white).toMatch(/^[0-9a-f]{16}$/);
    expect(collected).toMatchObject({ whiteRating: 1500, blackRating: 1520, timeClass: 'blitz' });
    expect(pseudonymizer('autre-secret')(source.url)).not.toBe(collected.id);
  });
});

describe('séparation calibration et validation (T10)', () => {
  const pseudo = pseudonymizer('s');
  const games = Array.from({ length: 400 }, (_, i) =>
    toCollected(
      game({
        white: { username: `j${i % 90}`, rating: 1000 + i, result: 'win' },
        black: { username: `j${(i * 7 + 3) % 90}`, rating: 1100 + i, result: 'resigned' },
      }),
      pseudo,
    ),
  );
  const samples = games.flatMap(samplesOf);

  it('chaque partie donne un échantillon par joueur', () => {
    expect(samples).toHaveLength(800);
    expect(samplesOf(games[0]!).map((s) => s.side)).toEqual(['w', 'b']);
  });

  it('fixe pour une graine, tous les échantillons d’un joueur du même côté', () => {
    const first = splitSamples(samples, 'graine', 0.2);
    const again = splitSamples(samples, 'graine', 0.2);
    expect(again).toEqual(first);
    expect(first.calibration.length + first.validation.length).toBe(samples.length);

    const calibrationPlayers = new Set(first.calibration.map((s) => s.player));
    expect(first.validation.some((s) => calibrationPlayers.has(s.player))).toBe(false);
    expect(first.validation.length).toBeGreaterThan(0);

    const other = splitSamples(samples, 'autre graine', 0.2);
    expect(other.validation).not.toEqual(first.validation);
  });
});
