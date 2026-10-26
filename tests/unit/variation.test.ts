import { describe, expect, it } from 'vitest';
import { parseGame } from '../../src/chess/game';
import {
  currentFen,
  currentPly,
  formatLine,
  makePly,
  playMove,
  pvToSan,
  stepBack,
  type ExploreState,
} from '../../src/chess/variation';
import { OPERA_PGN } from '../fixtures/chesscom';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const game = parseGame(OPERA_PGN); // 1. e4 e5 2. Nf3 d6 …
const at = (position: number): ExploreState => ({ position, variation: null, cursor: 0 });

describe('saisie des coups (F10)', () => {
  it('accepte la notation anglaise, française et par cases', () => {
    expect(makePly(START, 'Nf3', 1)?.san).toBe('Nf3');
    expect(makePly(START, 'Cf3', 1)?.san).toBe('Nf3');
    expect(makePly(START, 'g1f3', 1)?.san).toBe('Nf3');
    const afterE4E5 = game.plies[1]!.fenAfter;
    // « R » se lit d'abord en anglais (tour), puis en français (roi) si la tour ne peut pas jouer.
    expect(makePly(afterE4E5, 'Re2', 3)?.san).toBe('Ke2');
    expect(makePly(afterE4E5, 'Fc4', 3)?.san).toBe('Bc4');
  });

  it('refuse les coups illégaux, illisibles et le coup nul', () => {
    expect(makePly(START, 'e5', 1)).toBeNull();
    expect(makePly(START, 'bonjour', 1)).toBeNull();
    expect(makePly(START, '--', 1)).toBeNull();
    expect(makePly(START, { from: 'e2', to: 'e5' }, 1)).toBeNull();
  });

  it('promeut en dame par défaut au glisser-déposer', () => {
    const fen = '8/P7/8/8/8/8/k7/7K w - - 0 1';
    expect(makePly(fen, { from: 'a7', to: 'a8' }, 1)?.san).toBe('a8=Q+');
    expect(makePly(fen, 'a8=N', 1)?.san).toBe('a8=N');
  });

  it('décrit le coup joué comme un demi-coup de la partie', () => {
    const ply = makePly(game.plies[1]!.fenAfter, 'Bc4', 3)!;
    expect(ply).toMatchObject({
      index: 3,
      color: 'w',
      moveNumber: 2,
      uci: 'f1c4',
      from: 'f1',
      to: 'c4',
      fenBefore: game.plies[1]!.fenAfter,
    });
    expect(ply.legalMoveCount).toBeGreaterThan(20);
  });
});

describe('variantes à partir de la partie (F10)', () => {
  it('le coup réellement joué fait avancer dans la partie', () => {
    expect(playMove(game, at(0), 'e4')).toEqual(at(1));
  });

  it('un autre coup ouvre une variante depuis la position affichée', () => {
    const state = playMove(game, at(2), 'Bc4')!;
    expect(state.position).toBe(2);
    expect(state.cursor).toBe(1);
    expect(state.variation).toMatchObject({ base: 2, startFen: game.plies[1]!.fenAfter });
    expect(state.variation!.plies.map((p) => p.san)).toEqual(['Bc4']);
    expect(state.variation!.plies[0]!.index).toBe(3);
    expect(currentFen(game, state)).toBe(state.variation!.plies[0]!.fenAfter);
    expect(currentPly(game, state)?.san).toBe('Bc4');
  });

  it('prolonge, parcourt et remplace la suite de la variante', () => {
    let state = playMove(game, at(2), 'Bc4')!;
    state = playMove(game, state, 'Nf6')!;
    state = playMove(game, state, 'd3')!;
    expect(state.variation!.plies.map((p) => p.san)).toEqual(['Bc4', 'Nf6', 'd3']);

    // Rejouer le coup suivant de la variante avance sans rien effacer.
    const back = stepBack(stepBack(state));
    expect(back.cursor).toBe(1);
    expect(currentPly(game, back)?.san).toBe('Bc4');
    expect(playMove(game, back, 'Nf6')).toMatchObject({ cursor: 2 });
    expect(playMove(game, back, 'Nf6')!.variation!.plies).toHaveLength(3);

    // Un autre coup remplace la suite à partir du curseur.
    const replaced = playMove(game, back, 'Nc6')!;
    expect(replaced.variation!.plies.map((p) => p.san)).toEqual(['Bc4', 'Nc6']);

    // Au départ de la variante : la position et le dernier coup sont ceux de la partie.
    const start = { ...state, cursor: 0 };
    expect(currentFen(game, start)).toBe(game.plies[1]!.fenAfter);
    expect(currentPly(game, start)?.san).toBe('e5');
  });

  it('un coup illégal ne change rien', () => {
    expect(playMove(game, at(0), 'Ke2')).toBeNull();
  });

  it('recule dans la partie hors variante', () => {
    expect(stepBack(at(3))).toEqual(at(2));
    expect(stepBack(at(0))).toEqual(at(0));
  });
});

describe('suite proposée par le moteur', () => {
  it('convertit la ligne UCI en notation algébrique numérotée', () => {
    expect(formatLine(START, pvToSan(START, ['e2e4', 'e7e5', 'g1f3']))).toBe('1. e4 e5 2. Nf3');
    const black = game.plies[0]!.fenAfter;
    expect(formatLine(black, pvToSan(black, ['e7e5', 'g1f3', 'b8c6']))).toBe('1... e5 2. Nf3 Nc6');
  });

  it('s’arrête au premier coup illisible et respecte la limite', () => {
    expect(pvToSan(START, ['e2e4', 'e2e4', 'g1f3'])).toEqual(['e4']);
    expect(pvToSan(START, ['e2e4', 'e7e5', 'g1f3', 'b8c6'], 2)).toEqual(['e4', 'e5']);
  });
});
