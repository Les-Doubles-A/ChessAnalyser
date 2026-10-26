import { useState, type CSSProperties } from 'react';
import { Chessboard, type Arrow } from 'react-chessboard';
import type { Ply } from '../chess/game';

interface Props {
  fen: string;
  orientation: 'white' | 'black';
  lastMove?: Ply;
  arrows?: Arrow[];
  /** Rend l'échiquier jouable (variantes) ; renvoie false si le coup est refusé. */
  onMove?: (from: string, to: string) => boolean;
}

// Palette propre au projet (ardoise et ivoire), distincte de celle de chess.com.
const LIGHT = { backgroundColor: '#e9e4d6' };
const DARK = { backgroundColor: '#7d8fa0' };
const LAST_MOVE = { backgroundColor: 'rgba(240, 190, 70, 0.55)' };
const SELECTED = { boxShadow: 'inset 0 0 0 4px rgba(31, 111, 178, 0.9)' };
const NO_ARROWS: Arrow[] = [];

export function Board({ fen, orientation, lastMove, arrows = NO_ARROWS, onMove }: Props) {
  const [selected, setSelected] = useState<{ square: string; fen: string } | null>(null);
  const label = lastMove
    ? `Échiquier, position après ${lastMove.moveNumber}${lastMove.color === 'w' ? '.' : '...'} ${lastMove.san}`
    : 'Échiquier, position de départ';
  // Une sélection ne survit pas à un changement de position.
  const from = selected?.fen === fen ? selected.square : null;
  const squareStyles: Record<string, CSSProperties> = lastMove
    ? { [lastMove.from]: LAST_MOVE, [lastMove.to]: LAST_MOVE }
    : {};
  if (from) squareStyles[from] = { ...squareStyles[from], ...SELECTED };

  const turn = fen.split(' ')[1] === 'b' ? 'b' : 'w';
  const ownPiece = (pieceType?: string) => pieceType?.[0] === turn;

  const options = {
    id: 'analysis-board',
    position: fen,
    boardOrientation: orientation,
    allowDrawingArrows: false,
    arrows,
    lightSquareStyle: LIGHT,
    darkSquareStyle: DARK,
    squareStyles,
    animationDurationInMs: 150,
  };

  if (!onMove) {
    // L'échiquier n'est pas interactif : `inert` retire de la tabulation les 32 pièces
    // que la bibliothèque rend focalisables pour le glisser-déposer.
    return (
      <div className="board" role="img" aria-label={label}>
        <div inert>
          <Chessboard options={{ ...options, allowDragging: false }} />
        </div>
      </div>
    );
  }

  // Mode variante : glisser-déposer, ou clic sur la pièce puis sur la case d'arrivée.
  // Au clavier, la saisie du coup en notation algébrique remplace l'échiquier.
  return (
    <div
      className="board is-playable"
      role="group"
      aria-label={`${label}, coups jouables à la souris`}
    >
      <Chessboard
        options={{
          ...options,
          allowDragging: true,
          canDragPiece: ({ piece }) => ownPiece(piece.pieceType),
          onPieceDrop: ({ sourceSquare, targetSquare }) => {
            setSelected(null);
            return targetSquare ? onMove(sourceSquare, targetSquare) : false;
          },
          onSquareClick: ({ piece, square }) => {
            if (from && from !== square && onMove(from, square)) {
              setSelected(null);
            } else if (ownPiece(piece?.pieceType) && from !== square) {
              setSelected({ square, fen });
            } else {
              setSelected(null);
            }
          },
        }}
      />
    </div>
  );
}
