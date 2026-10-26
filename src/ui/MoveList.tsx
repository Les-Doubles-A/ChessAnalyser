import { useEffect, useRef } from 'react';
import type { MoveAnalysis } from '../analysis/report';
import type { Ply } from '../chess/game';
import { CATEGORY } from './categories';

interface Props {
  plies: Ply[];
  moves: readonly (MoveAnalysis | undefined)[];
  position: number;
  onSelect: (position: number) => void;
}

export function moveLabel(ply: Ply): string {
  return `${ply.moveNumber}${ply.color === 'w' ? '.' : '...'} ${ply.san}`;
}

export function MoveList({ plies, moves, position, onSelect }: Props) {
  const listRef = useRef<HTMLOListElement>(null);

  // Garde le coup courant visible en faisant défiler la liste seule, pas la page.
  useEffect(() => {
    const list = listRef.current;
    const current = list?.querySelector<HTMLElement>('[aria-current="step"]');
    if (!list || !current) return;
    const top = current.offsetTop; // .move-list est en position relative
    if (top < list.scrollTop || top + current.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = top - list.clientHeight / 2;
    }
  }, [position]);

  const rows: { number: number; white?: Ply; black?: Ply }[] = [];
  for (const ply of plies) {
    let row = rows.at(-1);
    if (!row || row.number !== ply.moveNumber) {
      row = { number: ply.moveNumber };
      rows.push(row);
    }
    row[ply.color === 'w' ? 'white' : 'black'] = ply;
  }

  const cell = (ply?: Ply) => {
    if (!ply) return <span className="move empty" />;
    const analysis = moves[ply.index - 1];
    const category = analysis ? CATEGORY[analysis.category] : undefined;
    const name = category ? `${moveLabel(ply)}, ${category.label.toLowerCase()}` : moveLabel(ply);
    return (
      <button
        type="button"
        className={`move${analysis ? ` cat-${analysis.category}` : ''}`}
        aria-label={name}
        title={category?.label}
        aria-current={ply.index === position ? 'step' : undefined}
        onClick={() => onSelect(ply.index)}
      >
        {ply.san}
        {category?.symbol && (
          <span className="move-symbol" aria-hidden="true">
            {category.symbol}
          </span>
        )}
      </button>
    );
  };

  if (plies.length === 0) return <p className="status">Cette partie ne contient aucun coup.</p>;

  return (
    <ol ref={listRef} className="move-list" aria-label="Coups de la partie">
      {rows.map((row) => (
        <li key={row.number}>
          <span className="move-number">{row.number}.</span>
          {cell(row.white)}
          {cell(row.black)}
        </li>
      ))}
    </ol>
  );
}
