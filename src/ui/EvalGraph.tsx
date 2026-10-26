import type { KeyboardEvent, MouseEvent } from 'react';
import { isError } from '../analysis/classify';
import type { MoveAnalysis } from '../analysis/report';
import { whiteBarPercent } from '../analysis/winPercent';
import type { Ply } from '../chess/game';
import type { PositionEval } from '../engine/types';
import { CATEGORY } from './categories';

interface Props {
  evals: readonly (PositionEval | undefined)[];
  moves: readonly (MoveAnalysis | undefined)[];
  plies: readonly Ply[];
  position: number;
  onSelect: (position: number) => void;
}

const W = 600;
const H = 120;

export function EvalGraph({ evals, moves, plies, position, onSelect }: Props) {
  const total = plies.length + 1;
  const x = (i: number) => (total > 1 ? (i / (total - 1)) * W : W / 2);
  const y = (percent: number) => H - (percent / 100) * H;

  const points: [number, number][] = [];
  for (let i = 0; i < total; i++) {
    const evaluation = evals[i];
    if (!evaluation) break;
    points.push([x(i), y(whiteBarPercent(evaluation.score))]);
  }
  const line = points.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(' ');
  const area =
    points.length > 0
      ? `${points[0]![0].toFixed(1)},${H} ${line} ${points.at(-1)![0].toFixed(1)},${H}`
      : '';

  const onClick = (event: MouseEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - box.left) / box.width;
    onSelect(Math.round(Math.max(0, Math.min(1, ratio)) * (total - 1)));
  };

  const markers = moves.flatMap((move) =>
    move && isError(move.category) ? [{ move, ply: plies[move.plyIndex - 1]! }] : [],
  );

  return (
    <div className="eval-graph" role="group" aria-label={`Courbe d’évaluation, ${total} positions`}>
      <svg viewBox={`0 0 ${W} ${H + 14}`} onClick={onClick}>
        <rect className="graph-bg" x={0} y={0} width={W} height={H} />
        {area && <polygon className="graph-area" points={area} />}
        <line className="graph-mid" x1={0} x2={W} y1={H / 2} y2={H / 2} />
        {line && <polyline className="graph-line" points={line} />}
        <line className="graph-cursor" x1={x(position)} x2={x(position)} y1={0} y2={H} />
        {markers.map(({ move, ply }) => {
          const evaluation = evals[move.plyIndex];
          if (!evaluation) return null;
          const { label, symbol } = CATEGORY[move.category];
          const mx = x(move.plyIndex);
          const my = y(whiteBarPercent(evaluation.score));
          const name = `${label} : ${ply.moveNumber}${ply.color === 'w' ? '.' : '...'} ${ply.san}`;
          const activate = () => onSelect(move.plyIndex);
          return (
            <g
              key={move.plyIndex}
              className={`graph-marker cat-${move.category}`}
              role="button"
              tabIndex={0}
              aria-label={name}
              onClick={(event) => {
                event.stopPropagation();
                activate();
              }}
              onKeyDown={(event: KeyboardEvent) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  activate();
                }
              }}
            >
              <title>{name}</title>
              <circle cx={mx} cy={my} r={5} />
              <text x={mx} y={my < 16 ? my + 16 : my - 8} textAnchor="middle">
                {symbol}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
