import { useEffect, useMemo, useState } from 'react';
import type { GameSummary } from '../api/chesscom';
import { isError } from '../analysis/classify';
import { loadOpeningIndex, type OpeningIndex } from '../analysis/openings';
import { buildReport, uciToSan } from '../analysis/report';
import { PRESET_DEPTH } from '../analysis/runAnalysis';
import { parseGame, type ParsedGame } from '../chess/game';
import {
  currentFen,
  currentPly,
  playMove,
  stepBack,
  variationGame,
  type ExploreState,
  type MoveInput,
} from '../chess/variation';
import type { PositionEval } from '../engine/types';
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
import { ExploreBar, VariationPanel } from './Variation';
import { useVariationEvals } from './useVariationEvals';

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
  const [nav, setNav] = useState<ExploreState>({ position: 0, variation: null, cursor: 0 });
  const [exploring, setExploring] = useState(false);
  const { position, variation, cursor } = nav;
  /** Position de la partie mise en avant (celle d'où part la variante, le cas échéant). */
  const shown = variation ? variation.base : position;
  const go = (target: number) =>
    setNav({ position: Math.max(0, Math.min(last, target)), variation: null, cursor: 0 });
  const exitVariation = () => setNav((n) => ({ ...n, variation: null, cursor: 0 }));

  // Flèches, Début et Fin parcourent la variante si elle est affichée, sinon la partie.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (target?.closest('input, select, textarea, [contenteditable="true"]')) return;
      if (event.key === 'Escape') {
        setNav((n) => (n.variation ? { ...n, variation: null, cursor: 0 } : n));
        return;
      }
      const moves: Record<string, (p: number, end: number) => number> = {
        ArrowLeft: (p) => p - 1,
        ArrowRight: (p) => p + 1,
        Home: () => 0,
        End: (_, end) => end,
      };
      const move = moves[event.key];
      if (!move) return;
      event.preventDefault();
      setNav((n) => {
        const clamp = (value: number, end: number) => Math.max(0, Math.min(end, value));
        if (n.variation) {
          const end = n.variation.plies.length;
          return { ...n, cursor: clamp(move(n.cursor, end), end) };
        }
        return { ...n, position: clamp(move(n.position, last), last) };
      });
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

  // Variante : évaluée au même préréglage que la partie affichée.
  const depth = PRESET_DEPTH[state.shownPreset ?? 'standard'];
  const known = useMemo(
    () =>
      new Map(state.evals.filter((e): e is PositionEval => e !== undefined).map((e) => [e.fen, e])),
    [state.evals],
  );
  const variationFens = useMemo(
    () => (variation ? [variation.startFen, ...variation.plies.map((p) => p.fenAfter)] : []),
    [variation],
  );
  const { evals: variationEvals, error: variationError } = useVariationEvals(
    variationFens,
    cursor,
    depth,
    known,
  );
  const variationMoves = variation
    ? buildReport(variationGame(variation), variationEvals).moves
    : [];

  const fen = currentFen(parsed, nav);
  const shownEval = variation ? variationEvals[cursor] : state.evals[position];
  const inVariationMove = variation !== null && cursor > 0;
  const panel = inVariationMove
    ? {
        ply: variation.plies[cursor - 1],
        analysis: variationMoves[cursor - 1],
        before: variationEvals[cursor - 1],
        after: variationEvals[cursor],
      }
    : {
        ply: parsed.plies[shown - 1],
        analysis: report.moves[shown - 1],
        before: state.evals[shown - 1],
        after: state.evals[shown],
      };

  const play = (input: MoveInput) => {
    const next = playMove(parsed, nav, input);
    if (!next) return false;
    setNav(next);
    return true;
  };
  // Remplace le coup affiché par le meilleur coup du moteur, dans une variante.
  const tryBest = () => {
    const best = panel.analysis?.bestMoveUci;
    if (!best) return;
    const back = inVariationMove
      ? stepBack(nav)
      : { position: Math.max(0, shown - 1), variation: null, cursor: 0 };
    const next = playMove(parsed, back, best);
    if (next) {
      setNav(next);
      setExploring(true);
    }
  };

  const toArrow = (uci: string) => [
    { startSquare: uci.slice(0, 2), endSquare: uci.slice(2, 4), color: ARROW_COLOR },
  ];
  // Coup conseillé dans la position affichée, seulement s'il y est jouable.
  const bestMoveSan = shownEval?.bestMoveUci ? uciToSan(fen, shownEval.bestMoveUci) : undefined;
  // Partie : meilleur coup sur les erreurs. Variante : coup conseillé dans la position affichée.
  const arrows = variation
    ? bestMoveSan && shownEval?.bestMoveUci
      ? toArrow(shownEval.bestMoveUci)
      : undefined
    : panel.analysis && isError(panel.analysis.category) && panel.analysis.bestMoveUci
      ? toArrow(panel.analysis.bestMoveUci)
      : undefined;

  const top = orientation === 'white' ? game.black : game.white;
  const bottom = orientation === 'white' ? game.white : game.black;

  return (
    <div className="replay">
      <div className="board-column">
        <PlayerTag name={top.username} rating={top.rating} />
        <div className="board-with-bar">
          <EvalBar score={shownEval?.score} orientation={orientation} />
          <Board
            fen={fen}
            orientation={orientation}
            lastMove={currentPly(parsed, nav)}
            arrows={arrows}
            onMove={exploring ? (from, to) => play({ from, to }) : undefined}
          />
        </div>
        <PlayerTag name={bottom.username} rating={bottom.rating} />
        <div className="nav" role="group" aria-label="Navigation dans la partie">
          <button type="button" onClick={() => go(0)}>
            Début
          </button>
          <button
            type="button"
            onClick={() =>
              variation ? setNav({ ...nav, cursor: Math.max(0, cursor - 1) }) : go(position - 1)
            }
          >
            Précédent
          </button>
          <button
            type="button"
            onClick={() =>
              variation
                ? setNav({ ...nav, cursor: Math.min(variation.plies.length, cursor + 1) })
                : go(position + 1)
            }
          >
            Suivant
          </button>
          <button type="button" onClick={() => go(last)}>
            Fin
          </button>
        </div>
        <p className="position-indicator" aria-live="polite">
          {variation
            ? `Variante : demi-coup ${cursor} sur ${variation.plies.length}`
            : position === 0
              ? 'Position de départ'
              : `Demi-coup ${position} sur ${last}`}
        </p>
        <button
          type="button"
          className="explore-toggle"
          aria-pressed={exploring}
          onClick={() => setExploring((e) => !e)}
        >
          Explorer des variantes
        </button>
        {exploring && (
          <ExploreBar
            onPlay={play}
            bestMove={bestMoveSan}
            onPlayBest={() => shownEval?.bestMoveUci && play(shownEval.bestMoveUci)}
          />
        )}
      </div>
      <div className="side-column">
        <AnalysisControls state={state} onCancel={cancel} onStart={start} />
        <EvalGraph
          evals={state.evals}
          moves={report.moves}
          plies={parsed.plies}
          position={shown}
          onSelect={go}
        />
        {variation && (
          <VariationPanel
            variation={variation}
            from={parsed.plies[variation.base - 1]}
            cursor={cursor}
            moves={variationMoves}
            current={shownEval}
            fen={fen}
            error={variationError}
            onSelect={(c) => setNav({ ...nav, cursor: c })}
            onExit={exitVariation}
          />
        )}
        <MovePanel {...panel} onTryBest={tryBest} />
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
        <MoveList plies={parsed.plies} moves={report.moves} position={shown} onSelect={go} />
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
