import { Chess } from 'chess.js';

export type Color = 'w' | 'b';

export interface Ply {
  /** Position 1 pour le premier demi-coup ; la position 0 est la position de départ. */
  index: number;
  color: Color;
  /** Numéro du coup complet, tel qu'affiché (1. e4 e5). */
  moveNumber: number;
  san: string;
  uci: string;
  from: string;
  to: string;
  fenBefore: string;
  fenAfter: string;
  legalMoveCount: number;
  clockSeconds?: number;
}

export interface ParsedGame {
  headers: Record<string, string>;
  startFen: string;
  plies: Ply[];
}

export class GameParseError extends Error {
  constructor(cause: unknown) {
    super('Cette partie n’a pas pu être lue.', { cause });
    this.name = 'GameParseError';
  }
}

const CLOCK_RE = /\[%clk\s+(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)\]/;

export function parseClock(comment: string): number | undefined {
  const match = CLOCK_RE.exec(comment);
  if (!match) return undefined;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

export function parseGame(pgn: string): ParsedGame {
  const chess = new Chess();
  try {
    chess.loadPgn(pgn);
  } catch (error) {
    throw new GameParseError(error);
  }

  const headers = chess.getHeaders();
  // Les FEN contiennent le numéro de coup, donc chaque position de la partie est unique.
  const clockByFen = new Map<string, number>();
  for (const { fen, comment } of chess.getComments()) {
    const seconds = parseClock(comment);
    if (seconds !== undefined) clockByFen.set(fen, seconds);
  }

  const history = chess.history({ verbose: true });
  const startFen = history[0]?.before ?? chess.fen();
  const plies = history.map((move, i): Ply => {
    const before = new Chess(move.before);
    return {
      index: i + 1,
      color: move.color,
      moveNumber: Number(move.before.split(' ')[5]),
      san: move.san,
      uci: move.lan,
      from: move.from,
      to: move.to,
      fenBefore: move.before,
      fenAfter: move.after,
      legalMoveCount: before.moves().length,
      clockSeconds: clockByFen.get(move.after),
    };
  });

  return { headers, startFen, plies };
}

/** FEN de la position n (0 = départ, n = après le n-ième demi-coup). */
export function fenAt(game: ParsedGame, position: number): string {
  if (position <= 0) return game.startFen;
  return game.plies[Math.min(position, game.plies.length) - 1]!.fenAfter;
}
