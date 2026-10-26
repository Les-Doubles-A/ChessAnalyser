import { useState } from 'react';
import type { GameSummary } from '../api/chesscom';
import type { ListState } from '../App';
import { formatDate, OUTCOME_LABELS, perspective, TIME_CLASS_LABELS } from './format';

interface Props {
  state: ListState;
  onRetry: () => void;
  onLoadMore: () => void;
  onOpen: (game: GameSummary, username: string) => void;
}

type Filter = GameSummary['timeClass'] | 'all';
const FILTERS: Filter[] = ['all', 'bullet', 'blitz', 'rapid', 'daily'];

export function GameList({ state, onRetry, onLoadMore, onOpen }: Props) {
  const [filter, setFilter] = useState<Filter>('all');

  if (state.status === 'idle') return null;

  if (state.status === 'loading') {
    return (
      <section className="games" aria-busy="true">
        <p className="status" aria-live="polite">
          Chargement des parties…
        </p>
        <ul className="game-list skeleton" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <li key={i} className="game-row" />
          ))}
        </ul>
      </section>
    );
  }

  if (state.status === 'error') {
    return (
      <section className="games">
        <p className="status error" aria-live="polite">
          {state.message}
        </p>
        <button type="button" onClick={onRetry}>
          Réessayer
        </button>
      </section>
    );
  }

  const { username, games } = state;
  const visible = filter === 'all' ? games : games.filter((g) => g.timeClass === filter);

  return (
    <section className="games" aria-labelledby="games-title">
      <div className="games-head">
        <h1 id="games-title">Parties de {username}</h1>
        {games.length > 0 && (
          <label className="filter">
            Cadence
            <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
              {FILTERS.map((f) => (
                <option key={f} value={f}>
                  {f === 'all' ? 'Toutes' : TIME_CLASS_LABELS[f]}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {games.length === 0 ? (
        <p className="status" aria-live="polite">
          Aucune partie publique trouvée.
        </p>
      ) : (
        <>
          <p className="hint">
            Les parties terminées depuis peu peuvent mettre quelques heures à apparaître.
          </p>
          {visible.length === 0 && <p className="status">Aucune partie dans cette cadence.</p>}
          <ul className="game-list">
            {visible.map((game) => (
              <GameRow key={game.url} game={game} username={username} onOpen={onOpen} />
            ))}
          </ul>
        </>
      )}

      {state.oldestIndex > 0 && (
        <div className="more">
          <button type="button" onClick={onLoadMore} disabled={state.loadingMore}>
            {state.loadingMore ? 'Chargement…' : 'Mois précédent'}
          </button>
          {state.moreError && (
            <p className="status error" aria-live="polite">
              {state.moreError}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function GameRow({
  game,
  username,
  onOpen,
}: {
  game: GameSummary;
  username: string;
  onOpen: Props['onOpen'];
}) {
  const view = perspective(game, username);
  const date = formatDate(game.endTime);
  const colorLabel = view.color === 'white' ? 'Blancs' : 'Noirs';
  const cells = (
    <>
      <span className="cell date">{date}</span>
      <span className={`cell side side-${view.color}`}>{colorLabel}</span>
      <span className="cell opponent">
        {view.opponent.username} <span className="rating">({view.opponent.rating})</span>
      </span>
      <span className="cell time-class">{TIME_CLASS_LABELS[game.timeClass]}</span>
      <span className={`cell outcome outcome-${view.outcome}`}>{OUTCOME_LABELS[view.outcome]}</span>
      <span className="cell moves">{game.moveCount} coups</span>
    </>
  );

  if (!game.supported) {
    return (
      <li>
        <div className="game-row is-disabled" aria-disabled="true">
          {cells}
          <span className="cell unsupported">Variante non prise en charge</span>
        </div>
      </li>
    );
  }

  const label =
    `Partie du ${date}, ${colorLabel.toLowerCase()} contre ${view.opponent.username} ` +
    `(${view.opponent.rating}), ${TIME_CLASS_LABELS[game.timeClass].toLowerCase()}, ` +
    `${OUTCOME_LABELS[view.outcome].toLowerCase()}, ${game.moveCount} coups`;

  return (
    <li>
      <button
        type="button"
        className="game-row"
        aria-label={label}
        onClick={() => onOpen(game, username)}
      >
        {cells}
      </button>
    </li>
  );
}
