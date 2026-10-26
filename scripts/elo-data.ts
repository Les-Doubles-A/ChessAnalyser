// Variables F6 des échantillons de calibration ou de validation, calculées exactement comme
// sur le site : rapport de partie (classification, livre, précision) puis src/analysis/elo.
import { readFileSync } from 'node:fs';
import { MIN_NON_BOOK_MOVES, playerFeatures, type PlayerFeatures } from '../src/analysis/elo';
import { createOpeningIndex, type OpeningData } from '../src/analysis/openings';
import { buildReport, type GameReport } from '../src/analysis/report';
import type { Preset } from '../src/analysis/runAnalysis';
import { parseGame } from '../src/chess/game';
import type { PositionEval } from '../src/engine/types';
import { readJsonl } from './data-files';
import type { AnalysedGame, CollectedGame, Sample } from './dataset';

export interface EloRow {
  sample: Sample;
  features: PlayerFeatures;
}

export function loadRows(preset: Preset, samplesFile: string) {
  const openings = createOpeningIndex(
    JSON.parse(
      readFileSync(new URL('../src/data/openings.json', import.meta.url), 'utf8'),
    ) as OpeningData,
  );
  const games = new Map(readJsonl<CollectedGame>('games.jsonl').map((g) => [g.id, g]));
  const analyses = new Map(
    readJsonl<AnalysedGame>(`analysis-${preset}.jsonl`)
      .filter((a) => a.evals)
      .map((a) => [a.id, a]),
  );
  const reports = new Map<string, GameReport | null>();
  const skipped = { notAnalysed: 0, incomplete: 0, tooShort: 0 };
  const rows: EloRow[] = [];

  const reportOf = (id: string): GameReport | null => {
    if (reports.has(id)) return reports.get(id)!;
    const game = games.get(id);
    const analysis = analyses.get(id);
    let report: GameReport | null = null;
    if (game && analysis?.evals) {
      const parsed = parseGame(game.pgn);
      const fens = [parsed.startFen, ...parsed.plies.map((p) => p.fenAfter)];
      if (analysis.evals.length === fens.length) {
        const evals = analysis.evals.map((e, i): PositionEval => ({
          fen: fens[i]!,
          depth: analysis.depth,
          score: e.s,
          bestMoveUci: e.b,
          pv: [],
        }));
        report = buildReport(parsed, evals, openings);
      }
    }
    reports.set(id, report);
    return report;
  };

  for (const sample of readJsonl<Sample>(samplesFile)) {
    const report = reportOf(sample.game);
    if (!report) {
      skipped.notAnalysed++;
      continue;
    }
    const features = playerFeatures(report, sample.side);
    if (!features) skipped.incomplete++;
    else if (features.moves < MIN_NON_BOOK_MOVES) skipped.tooShort++;
    else rows.push({ sample, features });
  }
  return { rows, skipped };
}
