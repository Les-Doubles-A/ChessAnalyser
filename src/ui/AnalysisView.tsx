import { useEffect, useMemo, useState } from 'react';
import type { GameSummary } from '../api/chesscom';
import { isError } from '../analysis/classify';
import { loadOpeningIndex, type OpeningIndex } from '../analysis/openings';
import { buildReport } from '../analysis/report';
import { fenAt, parseGame, type ParsedGame } from '../chess/game';
import { AnalysisControls } from './AnalysisControls';
import { Board } from './Board';
import { ARROW_COLOR, formatAccuracy } from './categories';
import { EvalBar } from './EvalBar';
import { EvalGraph } from './EvalGraph';
import { formatDate, OUTCOME_LABELS, perspective, TIME_CLASS_LABELS } from './format';
import { MoveList } from './MoveList';
import { MovePanel } from './MovePanel';
import { Summary } from './Summary';
import { useAnalysis } from './useAnalysis';

interface Props {
  game: GameSummary;
  username: string;
  onBack: () => void;
}

function tryParse(pgn: string): ParsedGame | null {
  try {
    return parseGame(pgn);
  } catch (error) {
    console.error(error);
    return null;
  }
}

export function AnalysisView({ game, username, onBack }: Props) {
  const parsed = useMemo(() => tryParse(game.pgn), [game.pgn]);
  const view = perspective(game, username);

  if (!parsed) {
    return (
      <section className="analysis">
        <p className="status error" role="alert">
          Cette partie n’a pas pu être lue.
        </p>
        <button type="button" onClick={onBack}>
          Retour à la liste
        </button>
      </section>
    );
  }

  return (
    <section className="analysis" aria-labelledby="analysis-title">
      <div className="analysis-head">
        <button type="button" className="back" onClick={onBack}>
          Retour à la liste
        </button>
        <h1 id="analysis-title">
          {game.white.username} contre {game.black.username}
        </h1>
        <p className="meta">
          {formatDate(game.endTime)} · {TIME_CLASS_LABELS[game.timeClass]} ·{' '}
          {OUTCOME_LABELS[view.outcome]} pour {view.me.username}
        </p>
      </div>
      <Replay parsed={parsed} game={game} orientation={view.color} />
    </section>
  );
}

function Replay({
  parsed,
  game,
  orientation,
}: {
  parsed: ParsedGame;
  game: GameSummary;
  orientation: 'white' | 'black';
}) {
  const last = parsed.plies.length;
  const [position, setPosition] = useState(0);
  const go = (target: number) => setPosition(Math.max(0, Math.min(last, target)));

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (target?.closest('input, select, textarea, [contenteditable="true"]')) return;
      const moves: Record<string, (p: number) => number> = {
        ArrowLeft: (p) => p - 1,
        ArrowRight: (p) => p + 1,
        Home: () => 0,
        End: () => last,
      };
      const move = moves[event.key];
      if (!move) return;
      event.preventDefault();
      setPosition((p) => Math.max(0, Math.min(last, move(p))));
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [last]);

  const { state, start, cancel } = useAnalysis(parsed);
  const [openings, setOpenings] = useState<OpeningIndex>();
  useEffect(() => {
    let alive = true;
    loadOpeningIndex()
      .then((index) => alive && setOpenings(index))
      .catch((error: unknown) => console.error('Base d’ouvertures indisponible', error));
    return () => {
      alive = false;
    };
  }, []);
  const report = useMemo(
    () => buildReport(parsed, state.evals, openings),
    [parsed, state.evals, openings],
  );

  const top = orientation === 'white' ? game.black : game.white;
  const bottom = orientation === 'white' ? game.white : game.black;
  const current = report.moves[position - 1];
  const arrows =
    current && isError(current.category) && current.bestMoveUci
      ? [
          {
            startSquare: current.bestMoveUci.slice(0, 2),
            endSquare: current.bestMoveUci.slice(2, 4),
            color: ARROW_COLOR,
          },
        ]
      : undefined;

  return (
    <div className="replay">
      <div className="board-column">
        <PlayerTag name={top.username} rating={top.rating} />
        <div className="board-with-bar">
          <EvalBar score={state.evals[position]?.score} orientation={orientation} />
          <Board
            fen={fenAt(parsed, position)}
            orientation={orientation}
            lastMove={parsed.plies[position - 1]}
            arrows={arrows}
          />
        </div>
        <PlayerTag name={bottom.username} rating={bottom.rating} />
        <div className="nav" role="group" aria-label="Navigation dans la partie">
          <button type="button" onClick={() => go(0)}>
            Début
          </button>
          <button type="button" onClick={() => go(position - 1)}>
            Précédent
          </button>
          <button type="button" onClick={() => go(position + 1)}>
            Suivant
          </button>
          <button type="button" onClick={() => go(last)}>
            Fin
          </button>
        </div>
        <p className="position-indicator" aria-live="polite">
          {position === 0 ? 'Position de départ' : `Demi-coup ${position} sur ${last}`}
        </p>
      </div>
      <div className="side-column">
        <AnalysisControls state={state} onCancel={cancel} onStart={start} />
        <EvalGraph
          evals={state.evals}
          moves={report.moves}
          plies={parsed.plies}
          position={position}
          onSelect={go}
        />
        <MovePanel
          ply={parsed.plies[position - 1]}
          analysis={current}
          before={state.evals[position - 1]}
          after={state.evals[position]}
        />
        <p className="accuracy">
          Précision{report.complete ? '' : ' (partielle)'} : Blancs{' '}
          <strong>{formatAccuracy(report.accuracy.white)}</strong> · Noirs{' '}
          <strong>{formatAccuracy(report.accuracy.black)}</strong>
        </p>
        <Summary
          game={parsed}
          report={report}
          openings={openings}
          url={game.url}
          pending={!report.complete && state.status === 'running'}
          onSelect={go}
        />
        <MoveList plies={parsed.plies} moves={report.moves} position={position} onSelect={go} />
      </div>
    </div>
  );
}

function PlayerTag({ name, rating }: { name: string; rating: number }) {
  return (
    <p className="player-tag">
      <span className="player-name">{name}</span> <span className="rating">({rating})</span>
    </p>
  );
}
