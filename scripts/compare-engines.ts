// T12, étape 2 (hypothèse H5) : le moteur allégé du site (stockfish-19-lite-single) repère-t-il
// les mêmes gaffes que le moteur complet (stockfish-19-single, réseau NNUE complet) ?
// Usage : npm run h5:compare -- [--games 50]
//
// Les évaluations du moteur allégé viennent de data/analysis-standard.jsonl (T10). Les
// parties sont réanalysées au même préréglage (Standard) avec le moteur complet ; les
// résultats sont gardés dans data/analysis-standard-full.jsonl pour pouvoir reprendre.
// Rapport : docs/h5-moteurs.md (statistiques agrégées seulement).
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import type { Category } from '../src/analysis/classify';
import { createOpeningIndex, type OpeningData } from '../src/analysis/openings';
import { buildReport } from '../src/analysis/report';
import { PRESET_DEPTH, runAnalysis } from '../src/analysis/runAnalysis';
import { parseGame, type ParsedGame } from '../src/chess/game';
import { createNodeEngine } from '../src/engine/node-engine';
import type { PositionEval } from '../src/engine/types';
import { appendJsonl, readJsonl } from './data-files';
import type { AnalysedGame, CollectedGame } from './dataset';

const { values } = parseArgs({ options: { games: { type: 'string', default: '50' } } });
const count = Number(values.games);
const depth = PRESET_DEPTH.standard;
const FULL_FILE = 'analysis-standard-full.jsonl';
const FULL_ENGINE = 'stockfish-19-single';

const openings = createOpeningIndex(
  JSON.parse(
    readFileSync(new URL('../src/data/openings.json', import.meta.url), 'utf8'),
  ) as OpeningData,
);
const lite = new Map(
  readJsonl<AnalysedGame>('analysis-standard.jsonl')
    .filter((row) => row.evals)
    .map((row) => [row.id, row]),
);
const full = new Map(
  readJsonl<AnalysedGame>(FULL_FILE)
    .filter((row) => row.evals)
    .map((row) => [row.id, row]),
);
// Les premières parties du jeu analysées par le moteur allégé : choix fixe et reproductible.
const games = readJsonl<CollectedGame>('games.jsonl')
  .filter((game) => lite.has(game.id))
  .slice(0, count);
if (games.length < count) throw new Error(`Seulement ${games.length} parties analysées en T10.`);

const toEvals = (parsed: ParsedGame, row: AnalysedGame): PositionEval[] => {
  const fens = [parsed.startFen, ...parsed.plies.map((p) => p.fenAfter)];
  return row.evals!.map((e, i) => ({
    fen: fens[i]!,
    depth: row.depth,
    score: e.s,
    bestMoveUci: e.b,
    pv: [],
  }));
};

const todo = games.filter((game) => !full.has(game.id));
console.log(`${games.length} parties, ${todo.length} à analyser avec ${FULL_ENGINE}.`);
const started = Date.now();
if (todo.length > 0) {
  const engine = createNodeEngine('single');
  try {
    for (const [i, game] of todo.entries()) {
      const result = await runAnalysis(parseGame(game.pgn), engine, { depth });
      const row: AnalysedGame = {
        id: game.id,
        preset: 'standard',
        depth,
        engine: FULL_ENGINE,
        evals: result.evals.map((e) => ({
          s: e!.score,
          ...(e!.bestMoveUci ? { b: e!.bestMoveUci } : {}),
        })),
      };
      appendJsonl(FULL_FILE, row);
      full.set(game.id, row);
      const perGame = (Date.now() - started) / (i + 1) / 1000;
      console.log(`${i + 1}/${todo.length} parties, ${perGame.toFixed(1)} s par partie`);
    }
  } finally {
    engine.terminate();
  }
}

// Comparaison coup par coup.
const SERIOUS: readonly Category[] = ['mistake', 'blunder'];
let liteBlunders = 0;
let fullBlunders = 0;
let bothBlunders = 0;
let fullBlunderSeenAsSerious = 0;
let moves = 0;
let sameCategory = 0;
for (const game of games) {
  const parsed = parseGame(game.pgn);
  const a = buildReport(parsed, toEvals(parsed, lite.get(game.id)!), openings).moves;
  const b = buildReport(parsed, toEvals(parsed, full.get(game.id)!), openings).moves;
  a.forEach((moveLite, i) => {
    const moveFull = b[i];
    if (!moveLite || !moveFull) return;
    moves++;
    if (moveLite.category === moveFull.category) sameCategory++;
    const l = moveLite.category === 'blunder';
    const f = moveFull.category === 'blunder';
    if (l) liteBlunders++;
    if (f) fullBlunders++;
    if (l && f) bothBlunders++;
    if (f && SERIOUS.includes(moveLite.category)) fullBlunderSeenAsSerious++;
  });
}

const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)} %` : 'n/a');
const union = liteBlunders + fullBlunders - bothBlunders;
const report = `# H5 : gaffes du moteur allégé et du moteur complet

Généré par \`npm run h5:compare\` le ${new Date().toISOString().slice(0, 10)}.

- Parties : ${games.length} (les premières du jeu de calibration analysées en T10), ${moves} coups comparés.
- Préréglage Standard (profondeur ${depth}) ; moteur du site \`stockfish-19-lite-single\`, référence \`${FULL_ENGINE}\` (réseau NNUE complet), même orchestrateur et même classification (\`buildReport\`).

| Mesure | Valeur |
|---|---|
| Gaffes selon le moteur allégé | ${liteBlunders} |
| Gaffes selon le moteur complet | ${fullBlunders} |
| Gaffes communes | ${bothBlunders} |
| Taux d'accord (communes / gaffes signalées par l'un ou l'autre) | ${pct(bothBlunders, union)} |
| Gaffes du moteur complet retrouvées comme gaffes par le moteur allégé | ${pct(bothBlunders, fullBlunders)} |
| Gaffes du moteur complet retrouvées comme erreur ou gaffe | ${pct(fullBlunderSeenAsSerious, fullBlunders)} |
| Gaffes du moteur allégé confirmées par le moteur complet | ${pct(bothBlunders, liteBlunders)} |
| Coups de même catégorie (toutes catégories) | ${pct(sameCategory, moves)} |
`;
writeFileSync(new URL('../docs/h5-moteurs.md', import.meta.url), report);
console.log(report);
