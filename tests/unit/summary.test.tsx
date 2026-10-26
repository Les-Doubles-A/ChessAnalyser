import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { EloModel } from '../../src/analysis/elo';
import { buildReport } from '../../src/analysis/report';
import { parseGame } from '../../src/chess/game';
import type { PositionEval } from '../../src/engine/types';
import { Summary } from '../../src/ui/Summary';
import { OPERA_PGN } from '../fixtures/chesscom';

const game = parseGame(OPERA_PGN);
const fens = [game.startFen, ...game.plies.map((p) => p.fenAfter)];
const evals: PositionEval[] = fens.map((fen) => ({ fen, depth: 14, score: { cp: 30 }, pv: [] }));

const eloModel: EloModel = {
  features: [],
  presets: {
    standard: {
      coefficients: [1000, 500, 0, 0, 0, 0, 0, 0, 0, 0],
      lower: -350,
      upper: 350,
      samples: 2000,
      depth: 14,
      engine: 'test',
    },
  },
};

function renderSummary(
  report = buildReport(game, evals),
  preset: 'standard' | 'deep' = 'standard',
) {
  render(
    <Summary
      game={game}
      report={report}
      url="https://www.chess.com/game/live/1"
      pending={false}
      onSelect={() => undefined}
      white={{ username: 'morphy_fan', rating: 1650, result: 'win' }}
      black={{ username: 'Testeur', rating: 1580, result: 'checkmated' }}
      timeClass="rapid"
      preset={preset}
      eloModel={eloModel}
    />,
  );
}

afterEach(cleanup);

describe('niveau joué dans la synthèse (F6)', () => {
  it('AC-F6-1 : estimation, intervalle et classement chess.com à côté', () => {
    renderSummary();
    // Toutes les positions à +0.3 : aucun coup ne perd, précision 100 → 1000 + 500 = 1500.
    const white = screen.getByText(/^Blancs, morphy_fan/).closest('li')!;
    expect(white.textContent).toBe(
      'Blancs, morphy_fan : Niveau estimé sur cette partie : ≈ 1500 (1150 à 1850), confiance moyenne · classement chess.com 1650',
    );
    expect(screen.getByText(/^Noirs, Testeur/).closest('li')!.textContent).toContain(
      'classement chess.com 1580',
    );
  });

  it('AC-F6-3 : rien d’estimé si l’analyse est incomplète', () => {
    renderSummary(buildReport(game, evals.slice(0, 5)));
    const items = screen.getAllByText(/Disponible quand l’analyse est complète/);
    expect(items).toHaveLength(2);
    expect(screen.queryByText(/Niveau estimé/)).toBeNull();
  });

  it('préréglage sans modèle calibré', () => {
    renderSummary(buildReport(game, evals), 'deep');
    expect(screen.getAllByText(/Estimation non calibrée pour ce préréglage/)).toHaveLength(2);
  });
});
