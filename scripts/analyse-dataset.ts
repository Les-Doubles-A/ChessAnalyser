// Analyse Stockfish (Node) des parties collectées, avec les mêmes moteur, profondeurs et
// orchestrateur que le site (ADR-2, ADR-3), pour que le modèle Elo reste valable.
// Usage : npm run dataset:analyse -- [--preset standard|deep] [--limit N] [--skip N]
// Reprise : les parties déjà présentes dans data/analysis-<préréglage>.jsonl sont sautées.
// `--skip N` ignore les N premières parties collectées, pour faire tourner un second
// processus sur la suite sans doublon (une ligne en double serait sans effet).
import { parseArgs } from 'node:util';
import { PRESET_DEPTH, runAnalysis, type Preset } from '../src/analysis/runAnalysis';
import { parseGame } from '../src/chess/game';
import { createNodeEngine } from '../src/engine/node-engine';
import { appendJsonl, readJsonl } from './data-files';
import type { AnalysedGame, CollectedGame } from './dataset';

const ENGINE = 'stockfish-19-lite-single';

const { values } = parseArgs({
  options: {
    preset: { type: 'string', default: 'standard' },
    limit: { type: 'string' },
    skip: { type: 'string', default: '0' },
  },
});
const preset = values.preset as Preset;
if (!(preset in PRESET_DEPTH)) throw new Error(`Préréglage inconnu : ${values.preset}`);
const depth = PRESET_DEPTH[preset];
const output = `analysis-${preset}.jsonl`;

const done = new Set(readJsonl<AnalysedGame>(output).map((row) => row.id));
const todo = readJsonl<CollectedGame>('games.jsonl')
  .slice(Number(values.skip))
  .filter((game) => !done.has(game.id))
  .slice(0, values.limit ? Number(values.limit) : undefined);

console.log(
  `${done.size} parties déjà analysées (${preset}, profondeur ${depth}), ${todo.length} à faire.`,
);
const engine = createNodeEngine();
const started = Date.now();

try {
  for (const [i, game] of todo.entries()) {
    const row: AnalysedGame = { id: game.id, preset, depth, engine: ENGINE };
    try {
      const result = await runAnalysis(parseGame(game.pgn), engine, { depth });
      row.evals = result.evals.map((e) => ({
        s: e!.score,
        ...(e!.bestMoveUci ? { b: e!.bestMoveUci } : {}),
      }));
    } catch (error) {
      row.error = error instanceof Error ? error.message : String(error);
      console.warn(`Partie ${game.id} ignorée : ${row.error}`);
    }
    appendJsonl(output, row);

    const count = i + 1;
    if (count % 10 === 0 || count === todo.length) {
      const perGame = (Date.now() - started) / count;
      const left = Math.round((perGame * (todo.length - count)) / 60000);
      console.log(
        `${count}/${todo.length} parties, ${(perGame / 1000).toFixed(1)} s par partie, reste ≈ ${left} min`,
      );
    }
  }
} finally {
  engine.terminate();
}
