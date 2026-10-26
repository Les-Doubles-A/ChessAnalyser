import { formatScore, whiteBarPercent } from '../analysis/winPercent';
import type { Score } from '../engine/types';

interface Props {
  score?: Score;
  orientation: 'white' | 'black';
}

export function EvalBar({ score, orientation }: Props) {
  if (!score) {
    return (
      <div className="eval-bar is-pending" role="img" aria-label="Évaluation en attente">
        <span className="eval-label">…</span>
      </div>
    );
  }
  const white = whiteBarPercent(score);
  const label = formatScore(score);
  const whiteAhead = white >= 50;
  return (
    <div
      className={`eval-bar orient-${orientation}`}
      role="img"
      aria-label={`Évaluation : ${label}`}
    >
      <div className="eval-bar-white" style={{ height: `${white}%` }} />
      <span className={`eval-label ${whiteAhead ? 'on-white' : 'on-black'}`}>{label}</span>
    </div>
  );
}
