// Jeu de référence pour l'application de bureau (desktop/) : le portage Rust de l'analyse
// doit retrouver exactement ce que calcule le code TypeScript (FEN, coups, classification,
// précision, livre, ouverture, synthèse, variables et estimation Elo). Sans cela, le
// modèle Elo calibré par les scripts Node ne vaudrait pas pour l'application.
// Usage : npm run golden:export
//   - desktop/tests/golden/fixtures.json (versionné) : parties des fixtures de tests/,
//     évaluées par le Stockfish natif à la profondeur Standard ;
//   - data/golden-dataset.json (local, jamais publié) : parties du jeu de calibration
//     déjà analysées, si data/ existe.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { estimateElo, featureVector, playerFeatures, type EloModel } from '../src/analysis/elo';
import { summarizeGame } from '../src/analysis/keyMoments';
import { bookFlags, createOpeningIndex, type OpeningData } from '../src/analysis/openings';
import { buildReport } from '../src/analysis/report';
import { PRESET_DEPTH, runAnalysis } from '../src/analysis/runAnalysis';
import { parseGame } from '../src/chess/game';
import type { PositionEval, Score } from '../src/engine/types';
import {
  FOOLS_MATE_PGN,
  OCTOBER_GAMES,
  OPERA_PGN,
  REPETITION_PGN,
  SEPTEMBER_GAMES,
} from '../tests/fixtures/chesscom';
import { dataPath, readJsonl } from './data-files';
import type { CollectedGame } from './dataset';
import { createEngine, readAnalyses } from './engine-choice';

const openings = createOpeningIndex(
  JSON.parse(
    readFileSync(new URL('../src/data/openings.json', import.meta.url), 'utf8'),
  ) as OpeningData,
);
/** Modèle de test figé : celui du site, pour exercer le calcul quel que soit le moteur. */
const model = JSON.parse(
  readFileSync(new URL('../src/data/elo-model.json', import.meta.url), 'utf8'),
) as EloModel;
const presetModel = model.presets.standard!;

type TimeClass = 'bullet' | 'blitz' | 'rapid' | 'daily' | 'unknown';

function record(pgn: string, timeClass: TimeClass, evals: { s: Score; b?: string }[]) {
  const game = parseGame(pgn);
  const fens = [game.startFen, ...game.plies.map((p) => p.fenAfter)];
  const positionEvals: (PositionEval | undefined)[] = fens.map((fen, i) =>
    evals[i] ? { fen, depth: 14, score: evals[i]!.s, bestMoveUci: evals[i]!.b, pv: [] } : undefined,
  );
  const report = buildReport(game, positionEvals, openings);
  const synthesis = summarizeGame(game, report, openings);
  const side = (color: 'w' | 'b') => {
    const features = playerFeatures(report, color);
    return {
      features,
      vector: features ? featureVector(features, timeClass) : null,
      elo: estimateElo(features, timeClass, presetModel),
    };
  };
  return {
    pgn,
    timeClass,
    evals,
    fens,
    plies: game.plies.map((p) => ({
      san: p.san,
      uci: p.uci,
      color: p.color,
      moveNumber: p.moveNumber,
      legalMoveCount: p.legalMoveCount,
      clockSeconds: p.clockSeconds ?? null,
    })),
    book: bookFlags(
      game.plies.map((p) => p.fenAfter),
      openings,
    ),
    report: {
      moves: report.moves.map((m) =>
        m
          ? {
              category: m.category,
              loss: m.loss,
              accuracy: m.accuracy,
              winBefore: m.winBefore,
              winAfter: m.winAfter,
              bestMoveSan: m.bestMoveSan ?? null,
            }
          : null,
      ),
      white: report.accuracy.white,
      black: report.accuracy.black,
      complete: report.complete,
    },
    opening: synthesis.opening ?? null,
    counts: synthesis.counts,
    keyMoments: synthesis.keyMoments.map((m) => m.plyIndex),
    white: side('w'),
    black: side('b'),
  };
}

const header = { model: presetModel, note: 'Généré par npm run golden:export ; ne pas éditer.' };

// 1. Fixtures du dépôt, évaluées par le moteur natif.
const fixturePgns: [string, TimeClass][] = [
  [OPERA_PGN, 'rapid'],
  [FOOLS_MATE_PGN, 'blitz'],
  [REPETITION_PGN, 'bullet'],
  ...[...OCTOBER_GAMES.games, ...SEPTEMBER_GAMES.games].flatMap((g): [string, TimeClass][] =>
    g.rules === 'chess' && typeof g.pgn === 'string' ? [[g.pgn, g.time_class as TimeClass]] : [],
  ),
];
const engine = createEngine('native');
const fixtures = [];
try {
  for (const [pgn, timeClass] of fixturePgns) {
    let game;
    try {
      game = parseGame(pgn);
    } catch {
      continue; // partie volontairement illisible des fixtures
    }
    const result = await runAnalysis(game, engine, { depth: PRESET_DEPTH.standard });
    const evals = result.evals.map((e) => ({
      s: e!.score,
      ...(e!.bestMoveUci ? { b: e!.bestMoveUci } : {}),
    }));
    fixtures.push(record(pgn, timeClass, evals));
    // Variante incomplète : seules les premières positions sont évaluées.
    if (evals.length > 6) fixtures.push(record(pgn, timeClass, evals.slice(0, 5)));
  }
} finally {
  engine.terminate();
}
const fixturesFile = new URL('../desktop/tests/golden/fixtures.json', import.meta.url);
mkdirSync(new URL('.', fixturesFile), { recursive: true });
writeFileSync(fixturesFile, `${JSON.stringify({ ...header, games: fixtures })}\n`);
console.log(`${fixtures.length} parties de référence dans desktop/tests/golden/fixtures.json`);

// 2. Jeu de calibration local (moteur natif si analysé, sinon moteur du site).
if (existsSync(dataPath('games.jsonl'))) {
  const native = readAnalyses('standard', 'native');
  const analyses = new Map(
    (native.length > 0 ? native : readAnalyses('standard', 'lite')).map((a) => [a.id, a]),
  );
  const games = readJsonl<CollectedGame>('games.jsonl').filter((g) => analyses.has(g.id));
  const dataset = games.map((g) => record(g.pgn, g.timeClass, analyses.get(g.id)!.evals!));
  writeFileSync(dataPath('golden-dataset.json'), JSON.stringify({ ...header, games: dataset }));
  console.log(`${dataset.length} parties du jeu local dans data/golden-dataset.json`);
}
