// Choix du moteur des scripts du jeu de calibration : « lite » (Stockfish WebAssembly du
// site) ou « native » (Stockfish natif de l'application de bureau, desktop/). Chaque moteur
// a ses propres fichiers d'analyse, son modèle Elo et son rapport de validation.
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DATA_DIR, readJsonl } from './data-files';
import type { AnalysedGame } from './dataset';
import type { Preset } from '../src/analysis/runAnalysis';
import { createNativeEngine } from '../src/engine/native-engine';
import { createNodeEngine } from '../src/engine/node-engine';
import type { UciEngine } from '../src/engine/uci';

export type EngineKind = 'lite' | 'native';

/** Option `--engine` de parseArgs. */
export const ENGINE_OPTION = { engine: { type: 'string', default: 'lite' } } as const;

export function engineKind(value: string | undefined): EngineKind {
  if (value === 'lite' || value === 'native') return value;
  throw new Error(`Moteur inconnu : ${value} (lite ou native)`);
}

export const ENGINE_NAMES: Record<EngineKind, string> = {
  lite: 'stockfish-19-lite-single',
  native: 'stockfish-19-native',
};

/** Exécutable natif : CHESSANALYSER_STOCKFISH, sinon desktop/engine/stockfish.exe. */
export function nativeEnginePath(): string {
  return (
    process.env.CHESSANALYSER_STOCKFISH ??
    fileURLToPath(new URL('../desktop/engine/stockfish.exe', import.meta.url))
  );
}

export function createEngine(kind: EngineKind): UciEngine {
  return kind === 'native' ? createNativeEngine(nativeEnginePath()) : createNodeEngine();
}

const analysisBase = (preset: Preset, kind: EngineKind) =>
  kind === 'native' ? `analysis-${preset}-native` : `analysis-${preset}`;

/**
 * Fichier d'analyse. Avec `part`, chaque processus d'une analyse répartie écrit dans son
 * propre fichier (`<base>.part2.jsonl`) : aucun risque d'entrelacer des lignes.
 */
export function analysisFile(preset: Preset, kind: EngineKind, part?: string): string {
  return part
    ? `${analysisBase(preset, kind)}.part${part}.jsonl`
    : `${analysisBase(preset, kind)}.jsonl`;
}

/** Toutes les analyses réussies d'un préréglage et d'un moteur, parties réparties comprises. */
export function readAnalyses(preset: Preset, kind: EngineKind): AnalysedGame[] {
  const base = analysisBase(preset, kind);
  const files = existsSync(DATA_DIR)
    ? readdirSync(DATA_DIR).filter(
        (name) =>
          name === `${base}.jsonl` || (name.startsWith(`${base}.part`) && name.endsWith('.jsonl')),
      )
    : [];
  return files.flatMap((name) => readJsonl<AnalysedGame>(name)).filter((row) => row.evals);
}

export function modelFile(kind: EngineKind): URL {
  return kind === 'native'
    ? new URL('../desktop/data/elo-model.json', import.meta.url)
    : new URL('../src/data/elo-model.json', import.meta.url);
}

export function validationReport(preset: Preset, kind: EngineKind): URL {
  const suffix = kind === 'native' ? '-native' : '';
  return new URL(`../docs/elo-validation-${preset}${suffix}.md`, import.meta.url);
}
