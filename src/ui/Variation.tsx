import { useState, type FormEvent } from 'react';
import type { MoveAnalysis } from '../analysis/report';
import { formatScore } from '../analysis/winPercent';
import type { Ply } from '../chess/game';
import { formatLine, pvToSan, type Variation } from '../chess/variation';
import type { PositionEval } from '../engine/types';
import { CATEGORY } from './categories';
import { moveLabel } from './MoveList';

interface BarProps {
  /** Joue un coup saisi ; renvoie false s'il est illégal ou illisible. */
  onPlay: (move: string) => boolean;
  /** Meilleur coup du moteur dans la position affichée, s'il est connu. */
  bestMove?: string;
  onPlayBest: () => void;
}

/** Saisie d'un coup au clavier, alternative au glisser-déposer. */
export function ExploreBar({ onPlay, bestMove, onPlayBest }: BarProps) {
  const [text, setText] = useState('');
  const [message, setMessage] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const move = text.trim();
    if (!move) return;
    if (onPlay(move)) {
      setText('');
      setMessage('');
    } else {
      setMessage(`Coup impossible dans cette position : « ${move} ».`);
    }
  };

  return (
    <div className="explore-bar">
      <form onSubmit={submit} className="explore-form">
        <label htmlFor="explore-move">Jouer un coup</label>
        <input
          id="explore-move"
          value={text}
          onChange={(event) => setText(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          aria-describedby="explore-hint explore-message"
        />
        <button type="submit">Jouer</button>
        <button type="button" onClick={onPlayBest} disabled={!bestMove}>
          Coup du moteur{bestMove ? ` (${bestMove})` : ''}
        </button>
      </form>
      <p id="explore-hint" className="hint">
        Glisser une pièce sur l’échiquier, ou saisir le coup : Nf3, Cf3 ou g1f3.
      </p>
      <p id="explore-message" className="status error" aria-live="polite">
        {message}
      </p>
    </div>
  );
}

interface PanelProps {
  variation: Variation;
  /** Coup de la partie d'où part la variante, absent si elle part de la position initiale. */
  from?: Ply;
  cursor: number;
  moves: readonly (MoveAnalysis | undefined)[];
  current?: PositionEval;
  fen: string;
  error?: string;
  onSelect: (cursor: number) => void;
  onExit: () => void;
}

export function VariationPanel({
  variation,
  from,
  cursor,
  moves,
  current,
  fen,
  error,
  onSelect,
  onExit,
}: PanelProps) {
  const line = current?.pv.length ? formatLine(fen, pvToSan(fen, current.pv)) : '';
  return (
    <section className="variation" aria-labelledby="variation-title">
      <h2 id="variation-title">
        Variante {from ? `après ${moveLabel(from)}` : 'depuis la position de départ'}
      </h2>
      <ol className="variation-moves" aria-label="Coups de la variante">
        <li>
          <button
            type="button"
            className="move"
            aria-current={cursor === 0 ? 'step' : undefined}
            onClick={() => onSelect(0)}
          >
            Départ
          </button>
        </li>
        {variation.plies.map((ply, i) => {
          const analysis = moves[i];
          const category = analysis ? CATEGORY[analysis.category] : undefined;
          return (
            <li key={`${i}-${ply.uci}`}>
              <button
                type="button"
                className={`move${analysis ? ` cat-${analysis.category}` : ''}`}
                aria-label={`Variante ${moveLabel(ply)}${category ? `, ${category.label.toLowerCase()}` : ''}`}
                aria-current={cursor === i + 1 ? 'step' : undefined}
                onClick={() => onSelect(i + 1)}
              >
                {moveLabel(ply)}
                {category?.symbol && (
                  <span className="move-symbol" aria-hidden="true">
                    {category.symbol}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ol>
      <p className="variation-eval" aria-live="polite">
        {error ??
          (current
            ? `Évaluation : ${formatScore(current.score)}${line ? ` · Suite du moteur : ${line}` : ''}`
            : 'Évaluation en cours…')}
      </p>
      <button type="button" onClick={onExit}>
        Revenir à la partie
      </button>
    </section>
  );
}
