import { isError } from '../analysis/classify';
import type { MoveAnalysis } from '../analysis/report';
import { formatScore } from '../analysis/winPercent';
import type { Ply } from '../chess/game';
import type { PositionEval } from '../engine/types';
import { CATEGORY } from './categories';
import { moveLabel } from './MoveList';

interface Props {
  ply?: Ply;
  analysis?: MoveAnalysis;
  before?: PositionEval;
  after?: PositionEval;
  /** Ouvre une variante qui joue le meilleur coup à la place du coup joué. */
  onTryBest?: () => void;
}

export function MovePanel({ ply, analysis, before, after, onTryBest }: Props) {
  if (!ply) {
    return (
      <div className="move-panel" aria-live="polite">
        <p className="panel-title">Position de départ</p>
      </div>
    );
  }
  if (!analysis || !before || !after) {
    return (
      <div className="move-panel" aria-live="polite">
        <p className="panel-title">{moveLabel(ply)}</p>
        <p className="muted">Coup non analysé.</p>
      </div>
    );
  }
  const { label, symbol } = CATEGORY[analysis.category];
  return (
    <div className={`move-panel cat-${analysis.category}`} aria-live="polite">
      <p className="panel-title">
        <span className="panel-badge">
          {symbol && <span aria-hidden="true">{symbol} </span>}
          {label}
        </span>{' '}
        {moveLabel(ply)}
      </p>
      {isError(analysis.category) && analysis.bestMoveSan && (
        <p className="best-move">
          Meilleur coup : <strong>{analysis.bestMoveSan}</strong>
          {onTryBest && (
            <>
              {' '}
              <button type="button" className="try-best" onClick={onTryBest}>
                Essayer {analysis.bestMoveSan}
              </button>
            </>
          )}
        </p>
      )}
      <p className="muted">
        Évaluation avant : {formatScore(before.score)} · après : {formatScore(after.score)}
      </p>
    </div>
  );
}
