import { Chessboard, type Arrow } from 'react-chessboard';
import type { Ply } from '../chess/game';

interface Props {
  fen: string;
  orientation: 'white' | 'black';
  lastMove?: Ply;
  arrows?: Arrow[];
}

// Palette propre au projet (ardoise et ivoire), distincte de celle de chess.com.
const LIGHT = { backgroundColor: '#e9e4d6' };
const DARK = { backgroundColor: '#7d8fa0' };
const LAST_MOVE = { backgroundColor: 'rgba(240, 190, 70, 0.55)' };
const NO_ARROWS: Arrow[] = [];

export function Board({ fen, orientation, lastMove, arrows = NO_ARROWS }: Props) {
  const label = lastMove
    ? `Échiquier, position après ${lastMove.moveNumber}${lastMove.color === 'w' ? '.' : '...'} ${lastMove.san}`
    : 'Échiquier, position de départ';
  const squareStyles = lastMove ? { [lastMove.from]: LAST_MOVE, [lastMove.to]: LAST_MOVE } : {};

  // L'échiquier n'est pas interactif : `inert` retire de la tabulation les 32 pièces
  // que la bibliothèque rend focalisables pour le glisser-déposer.
  return (
    <div className="board" role="img" aria-label={label}>
      <div inert>
        <Chessboard
          options={{
            id: 'analysis-board',
            position: fen,
            boardOrientation: orientation,
            allowDragging: false,
            allowDrawingArrows: false,
            arrows,
            lightSquareStyle: LIGHT,
            darkSquareStyle: DARK,
            squareStyles,
            animationDurationInMs: 150,
          }}
        />
      </div>
    </div>
  );
}
