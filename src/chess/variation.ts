// Variantes (F10) : coups joués par l'utilisateur à partir d'une position de la partie.
// Les variantes partent toujours d'une partie terminée des archives, jamais d'une position
// saisie librement (garde-fou R8 contre l'usage pendant une partie en cours).
import { Chess, type Move } from 'chess.js';
import { fenAt, type ParsedGame, type Ply } from './game';

export interface Variation {
  /** Position de la partie d'où part la variante (0 = départ). */
  base: number;
  startFen: string;
  plies: Ply[];
}

/** Position affichée : dans la partie, ou dans une variante (curseur 0 = position de départ de la variante). */
export interface ExploreState {
  position: number;
  variation: Variation | null;
  cursor: number;
}

export type MoveInput = string | { from: string; to: string; promotion?: string };

// Notation française : Roi, Dame, Tour, Fou, Cavalier.
const FRENCH_PIECES: Record<string, string> = { R: 'K', D: 'Q', T: 'R', F: 'B', C: 'N' };

function toPly(move: Move, legalMoveCount: number, index: number): Ply {
  return {
    index,
    color: move.color,
    moveNumber: Number(move.before.split(' ')[5]),
    san: move.san,
    uci: move.lan,
    from: move.from,
    to: move.to,
    fenBefore: move.before,
    fenAfter: move.after,
    legalMoveCount,
  };
}

function tryMove(fen: string, input: MoveInput): Move | null {
  const chess = new Chess(fen);
  try {
    if (typeof input !== 'string') {
      return chess.move({ from: input.from, to: input.to, promotion: input.promotion ?? 'q' });
    }
    // chess.js accepte « -- » comme coup nul : ce n'est pas un coup jouable.
    if (/^-+$/.test(input.trim())) return null;
    return chess.move(input.trim());
  } catch {
    return null;
  }
}

/**
 * Lit un coup en notation anglaise (Nf3), française (Cf3) ou par cases (g1f3) et le joue
 * depuis `fen`. Renvoie null si le coup est illégal ou illisible.
 */
export function makePly(fen: string, input: MoveInput, index: number): Ply | null {
  const legalMoveCount = new Chess(fen).moves().length;
  let move = tryMove(fen, input);
  if (!move && typeof input === 'string') {
    const french = input.trim().replace(/^[RDTFC]/, (letter) => FRENCH_PIECES[letter]!);
    if (french !== input.trim()) move = tryMove(fen, french);
  }
  return move ? toPly(move, legalMoveCount, index) : null;
}

export function currentFen(game: ParsedGame, state: ExploreState): string {
  const { variation, cursor } = state;
  if (!variation) return fenAt(game, state.position);
  return cursor === 0 ? variation.startFen : variation.plies[cursor - 1]!.fenAfter;
}

/** Dernier coup menant à la position affichée, pour le surlignage et le libellé de l'échiquier. */
export function currentPly(game: ParsedGame, state: ExploreState): Ply | undefined {
  const { variation, cursor } = state;
  if (!variation) return game.plies[state.position - 1];
  return cursor === 0 ? game.plies[variation.base - 1] : variation.plies[cursor - 1];
}

/**
 * Joue un coup depuis la position affichée. Le coup réellement joué dans la partie (ou le
 * coup suivant de la variante) fait simplement avancer ; tout autre coup ouvre une variante,
 * ou remplace la suite de la variante en cours à partir du curseur.
 */
export function playMove(
  game: ParsedGame,
  state: ExploreState,
  input: MoveInput,
): ExploreState | null {
  const { variation, cursor } = state;
  const base = variation ? variation.base : state.position;
  const depth = variation ? cursor : 0;
  const ply = makePly(currentFen(game, state), input, base + depth + 1);
  if (!ply) return null;

  if (!variation) {
    if (game.plies[state.position]?.uci === ply.uci) {
      return { position: state.position + 1, variation: null, cursor: 0 };
    }
    const startFen = fenAt(game, state.position);
    return { position: state.position, variation: { base, startFen, plies: [ply] }, cursor: 1 };
  }
  if (variation.plies[cursor]?.uci === ply.uci) return { ...state, cursor: cursor + 1 };
  return {
    ...state,
    variation: { ...variation, plies: [...variation.plies.slice(0, cursor), ply] },
    cursor: cursor + 1,
  };
}

/** Recule d'un demi-coup (dans la variante, ou dans la partie). */
export function stepBack(state: ExploreState): ExploreState {
  if (state.variation) return { ...state, cursor: Math.max(0, state.cursor - 1) };
  return { ...state, position: Math.max(0, state.position - 1) };
}

/** Variante sous forme de partie, pour réutiliser buildReport et les composants de coups. */
export function variationGame(variation: Variation): ParsedGame {
  return { headers: {}, startFen: variation.startFen, plies: variation.plies };
}

/** Convertit la ligne principale du moteur (UCI) en notation algébrique, au plus `max` coups. */
export function pvToSan(fen: string, pv: readonly string[], max = 8): string[] {
  const chess = new Chess(fen);
  const san: string[] = [];
  for (const uci of pv.slice(0, max)) {
    try {
      san.push(chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san);
    } catch {
      break;
    }
  }
  return san;
}

/** Ligne numérotée à partir d'une position : « 13. Nxe5 Nxe5 14. Bxf7+ ». */
export function formatLine(fen: string, san: readonly string[]): string {
  const parts = fen.split(' ');
  let color = parts[1] === 'b' ? 'b' : 'w';
  let number = Number(parts[5]) || 1;
  const out: string[] = [];
  san.forEach((move, i) => {
    if (color === 'w') out.push(`${number}. ${move}`);
    else out.push(i === 0 ? `${number}... ${move}` : move);
    if (color === 'b') number++;
    color = color === 'w' ? 'b' : 'w';
  });
  return out.join(' ');
}
