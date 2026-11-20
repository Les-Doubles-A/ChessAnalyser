// Analyse Stockfish (Node) des parties collectées, avec les mêmes moteur, profondeurs et
// orchestrateur que le site (ADR-2, ADR-3), pour que le modèle Elo reste valable.
// Usage : npm run dataset:analyse -- [--preset standard|deep] [--engine lite|native]
//         [--limit N] [--skip N] [--until N] [--part K]
// Reprise : les parties déjà analysées (data/analysis-<préréglage>[-native]*.jsonl) sont sautées.
// `--skip` et `--until` bornent les parties collectées traitées (index de début inclus, de
// fin exclu), pour répartir l'analyse entre plusieurs processus sans doublon ; `--part`
// donne à chaque processus son propre fichier de sortie.
// `--engine native` utilise le Stockfish natif de l'application de bureau (desktop/).
import { parseArgs } from 'node:util';
import { PRESET_DEPTH, runAnalysis, type Preset } from '../src/analysis/runAnalysis';
import { parseGame, type ParsedGame } from '../src/chess/game';
import { appendJsonl, readJsonl } from './data-files';
import type { AnalysedGame, CollectedGame } from './dataset';
import {
  analysisFile,
  createEngine,
  ENGINE_NAMES,
  ENGINE_OPTION,
  engineKind,
  readAnalyses,
} from './engine-choice';

const { values } = parseArgs({
  options: {
    preset: { type: 'string', default: 'standard' },
    limit: { type: 'string' },
    skip: { type: 'string', default: '0' },
    until: { type: 'string' },
    part: { type: 'string' },
    ...ENGINE_OPTION,
  },
});
const preset = values.preset as Preset;
if (!(preset in PRESET_DEPTH)) throw new Error(`Préréglage inconnu : ${values.preset}`);
const kind = engineKind(values.engine);
const ENGINE = ENGINE_NAMES[kind];
const depth = PRESET_DEPTH[preset];
const output = analysisFile(preset, kind, values.part);

// Seules les analyses réussies comptent : une partie en erreur est retentée au lancement
// suivant (scripts/elo-data.ts ignore déjà les lignes en erreur).
const done = new Set(readAnalyses(preset, kind).map((row) => row.id));
const todo = readJsonl<CollectedGame>('games.jsonl')
  .slice(Number(values.skip), values.until ? Number(values.until) : undefined)
  .filter((game) => !done.has(game.id))
  .slice(0, values.limit ? Number(values.limit) : undefined);

console.log(
  `${done.size} parties déjà analysées (${preset}, profondeur ${depth}), ${todo.length} à faire.`,
);
let engine = createEngine(kind);
const started = Date.now();

try {
  for (const [i, game] of todo.entries()) {
    const row: AnalysedGame = { id: game.id, preset, depth, engine: ENGINE };
    let parsed: ParsedGame | undefined;
    try {
      parsed = parseGame(game.pgn);
    } catch (error) {
      row.error = error instanceof Error ? error.message : String(error);
      console.warn(`Partie ${game.id} illisible : ${row.error}`);
    }
    if (parsed) {
      try {
        const result = await runAnalysis(parsed, engine, { depth });
        row.evals = result.evals.map((e) => ({
          s: e!.score,
          ...(e!.bestMoveUci ? { b: e!.bestMoveUci } : {}),
        }));
      } catch (error) {
        row.error = error instanceof Error ? error.message : String(error);
        console.warn(`Partie ${game.id} ignorée : ${row.error} ; moteur relancé.`);
        // Le moteur peut être hors service (figé, arrêté) : on repart d'un moteur neuf
        // plutôt que d'échouer sur toutes les parties suivantes.
        engine.terminate();
        engine = createEngine(kind);
      }
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
