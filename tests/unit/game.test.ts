import { describe, expect, it } from 'vitest';
import { fenAt, GameParseError, parseClock, parseGame } from '../../src/chess/game';
import {
  CORRUPT_PGN,
  FOOLS_MATE_PGN,
  OPERA_MOVES,
  OPERA_PGN,
  REPETITION_PGN,
} from '../fixtures/chesscom';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('parseGame', () => {
  it('lit une partie gagnée par mat (partie de l’Opéra)', () => {
    const game = parseGame(OPERA_PGN);
    expect(game.plies).toHaveLength(OPERA_MOVES.length);
    expect(game.startFen).toBe(START);
    expect(game.headers.Black).toBe('Testeur');

    const first = game.plies[0]!;
    expect(first).toMatchObject({
      index: 1,
      color: 'w',
      moveNumber: 1,
      san: 'e4',
      uci: 'e2e4',
      from: 'e2',
      to: 'e4',
      fenBefore: START,
      legalMoveCount: 20,
      clockSeconds: 300,
    });

    const last = game.plies.at(-1)!;
    expect(last).toMatchObject({ san: 'Rd8#', color: 'w', moveNumber: 17 });
    expect(game.plies[22]!.uci).toBe('e1c1');
  });

  it('lit une partie courte gagnée par les noirs', () => {
    const game = parseGame(FOOLS_MATE_PGN);
    expect(game.plies.map((p) => p.san)).toEqual(['f3', 'e5', 'g4', 'Qh4#']);
    expect(game.plies[1]).toMatchObject({ color: 'b', moveNumber: 1, clockSeconds: 299 });
  });

  it('distingue les positions répétées d’une partie nulle', () => {
    const game = parseGame(REPETITION_PGN);
    expect(game.plies).toHaveLength(8);
    expect(game.plies.map((p) => p.clockSeconds)).toEqual([300, 299, 298, 297, 296, 295, 294, 293]);
  });

  it('lève GameParseError sur un PGN illégal (AC-F2-4)', () => {
    expect(() => parseGame(CORRUPT_PGN)).toThrow(GameParseError);
    expect(() => parseGame(CORRUPT_PGN)).toThrow('Cette partie n’a pas pu être lue.');
  });

  it('accepte un PGN sans coup', () => {
    const game = parseGame('[Event "Live Chess"]\n[Result "*"]\n\n*\n');
    expect(game.plies).toEqual([]);
    expect(game.startFen).toBe(START);
  });
});

describe('fenAt', () => {
  it('borne la position demandée', () => {
    const game = parseGame(FOOLS_MATE_PGN);
    expect(fenAt(game, -1)).toBe(START);
    expect(fenAt(game, 0)).toBe(START);
    expect(fenAt(game, 2)).toBe(game.plies[1]!.fenAfter);
    expect(fenAt(game, 99)).toBe(game.plies[3]!.fenAfter);
  });
});

describe('parseClock', () => {
  it('lit les horloges chess.com', () => {
    expect(parseClock('[%clk 0:00:59.9]')).toBeCloseTo(59.9);
    expect(parseClock('[%clk 1:02:03]')).toBe(3723);
    expect(parseClock('sans horloge')).toBeUndefined();
  });
});
