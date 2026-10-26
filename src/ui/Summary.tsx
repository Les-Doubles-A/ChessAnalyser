import { COUNT_KEYS, summarizeGame, type CountKey } from '../analysis/keyMoments';
import type { OpeningIndex } from '../analysis/openings';
import type { GameReport } from '../analysis/report';
import type { ParsedGame } from '../chess/game';
import { CATEGORY } from './categories';
import { moveLabel } from './MoveList';

interface Props {
  game: ParsedGame;
  report: GameReport;
  openings?: OpeningIndex;
  /** URL de la partie sur chess.com, validée par le client API. */
  url: string;
  /** Analyse en cours sans résultat complet à montrer. */
  pending: boolean;
  onSelect: (position: number) => void;
}

const COUNT_LABEL = (key: CountKey) => (key === 'unanalysed' ? 'Non analysé' : CATEGORY[key].label);

export function Summary({ game, report, openings, url, pending, onSelect }: Props) {
  const link = (
    <p>
      <a href={url} target="_blank" rel="noopener noreferrer">
        Voir sur chess.com
      </a>
    </p>
  );

  if (pending) {
    return (
      <section className="summary" aria-labelledby="summary-title">
        <h2 id="summary-title">Synthèse</h2>
        <p className="muted">Disponible à la fin de l’analyse</p>
        {link}
      </section>
    );
  }

  const { counts, opening, keyMoments } = summarizeGame(game, report, openings);
  const keys = COUNT_KEYS.filter(
    (key) => key !== 'unanalysed' || counts.w.unanalysed + counts.b.unanalysed > 0,
  );

  return (
    <section className="summary" aria-labelledby="summary-title">
      <h2 id="summary-title">Synthèse</h2>
      {!report.complete && (
        <p className="status" role="status">
          Analyse incomplète : synthèse partielle
        </p>
      )}

      <p className="opening">
        Ouverture :{' '}
        {opening === undefined
          ? '…'
          : opening
            ? `${opening.eco} · ${opening.name}`
            : 'Ouverture non répertoriée'}
      </p>

      <table className="counts">
        <caption>Coups par catégorie</caption>
        <thead>
          <tr>
            <th scope="col">Catégorie</th>
            <th scope="col">Blancs</th>
            <th scope="col">Noirs</th>
          </tr>
        </thead>
        <tbody>
          {keys.map((key) => (
            <tr key={key} className={key === 'unanalysed' ? undefined : `cat-${key}`}>
              <th scope="row">
                {key !== 'unanalysed' && CATEGORY[key].symbol && (
                  <span className="move-symbol" aria-hidden="true">
                    {CATEGORY[key].symbol}{' '}
                  </span>
                )}
                {COUNT_LABEL(key)}
              </th>
              <td>{counts.w[key]}</td>
              <td>{counts.b[key]}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Moments clés</h3>
      {keyMoments.length === 0 ? (
        <p className="muted">Aucune erreur majeure</p>
      ) : (
        <ol className="key-moments">
          {keyMoments.map((moment) => {
            const ply = game.plies[moment.plyIndex - 1]!;
            const { label, symbol } = CATEGORY[moment.category];
            return (
              <li key={moment.plyIndex}>
                <button
                  type="button"
                  className={`key-moment cat-${moment.category}`}
                  aria-label={`${label} au coup ${moveLabel(ply)}${moment.bestMoveSan ? `, meilleur coup ${moment.bestMoveSan}` : ''}`}
                  onClick={() => onSelect(moment.plyIndex)}
                >
                  <span className="key-moment-move">
                    {moveLabel(ply)}
                    <span className="move-symbol" aria-hidden="true">
                      {symbol}
                    </span>
                  </span>{' '}
                  <span className="muted">
                    {label}
                    {moment.bestMoveSan && ` · meilleur : ${moment.bestMoveSan}`}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}

      {link}
    </section>
  );
}
