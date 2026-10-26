// Calibre le modèle Elo (T11) sur data/calibration.jsonl et l'écrit dans src/data/elo-model.json.
// Usage : npm run elo:calibrate -- [--preset standard|deep]
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { FEATURE_NAMES, featureVector, type EloModel } from '../src/analysis/elo';
import { PRESET_DEPTH, type Preset } from '../src/analysis/runAnalysis';
import { loadRows } from './elo-data';
import { fitRidge, median, quantile } from './regression';

const MODEL_FILE = new URL('../src/data/elo-model.json', import.meta.url);
const LAMBDA = 1;
const ENGINE = 'stockfish-19-lite-single';

const { values } = parseArgs({ options: { preset: { type: 'string', default: 'standard' } } });
const preset = values.preset as Preset;
if (!(preset in PRESET_DEPTH)) throw new Error(`Préréglage inconnu : ${values.preset}`);

const { rows, skipped } = loadRows(preset, 'calibration.jsonl');
if (rows.length < FEATURE_NAMES.length * 10) {
  throw new Error(`Trop peu d'échantillons analysés pour calibrer : ${rows.length}`);
}
const xs = rows.map((r) => featureVector(r.features, r.sample.timeClass));
const ys = rows.map((r) => r.sample.rating);
const coefficients = fitRidge(xs, ys, LAMBDA);

const residuals = xs
  .map((x, i) => ys[i]! - x.reduce((sum, value, j) => sum + value * coefficients[j]!, 0))
  .sort((a, b) => a - b);

const model = JSON.parse(readFileSync(MODEL_FILE, 'utf8')) as EloModel;
model.features = [...FEATURE_NAMES];
model.presets[preset] = {
  coefficients: coefficients.map((c) => Number(c.toFixed(3))),
  lower: Math.round(quantile(residuals, 0.1)),
  upper: Math.round(quantile(residuals, 0.9)),
  samples: rows.length,
  depth: PRESET_DEPTH[preset],
  engine: ENGINE,
};
writeFileSync(MODEL_FILE, `${JSON.stringify(model, null, 2)}\n`);

console.log(
  `Préréglage ${preset} : ${rows.length} échantillons (écartés : ${JSON.stringify(skipped)}).`,
);
FEATURE_NAMES.forEach((name, i) =>
  console.log(`  ${name.padEnd(18)} ${coefficients[i]!.toFixed(1)}`),
);
console.log(
  `Résidus : quantile 10 % ${model.presets[preset]!.lower}, 90 % ${model.presets[preset]!.upper}, ` +
    `erreur absolue médiane en calibration ${Math.round(median(residuals.map(Math.abs)))}`,
);
console.log('Modèle écrit dans src/data/elo-model.json');
