// Valide le modèle Elo sur data/validation.jsonl, joueurs absents de la calibration (AC-F6-4),
// et écrit le rapport docs/elo-validation.md (statistiques agrégées seulement).
// Usage : npm run elo:validate -- [--preset standard|deep]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { estimateElo, type EloModel } from '../src/analysis/elo';
import { PRESET_DEPTH, type Preset } from '../src/analysis/runAnalysis';
import { bandLabel, bandOf, TIME_CLASSES } from './dataset';
import { loadRows } from './elo-data';
import { median } from './regression';

const TARGET = { games: 300, medianError: 300, coverageMin: 75, coverageMax: 85 };

const { values } = parseArgs({ options: { preset: { type: 'string', default: 'standard' } } });
const preset = values.preset as Preset;
if (!(preset in PRESET_DEPTH)) throw new Error(`Préréglage inconnu : ${values.preset}`);

const model = JSON.parse(
  readFileSync(new URL('../src/data/elo-model.json', import.meta.url), 'utf8'),
) as EloModel;
const presetModel = model.presets[preset];
if (!presetModel) throw new Error(`Aucun modèle calibré pour ${preset} : lancer elo:calibrate`);

const { rows, skipped } = loadRows(preset, 'validation.jsonl');
const results = rows.flatMap(({ sample, features }) => {
  const estimate = estimateElo(features, sample.timeClass, presetModel);
  if (estimate?.kind !== 'estimate') return [];
  return [
    {
      sample,
      error: Math.abs(estimate.value - sample.rating),
      covered: sample.rating >= estimate.low && sample.rating <= estimate.high,
    },
  ];
});

type Result = (typeof results)[number];
const stats = (items: Result[]) => ({
  n: items.length,
  medianError: items.length ? Math.round(median(items.map((r) => r.error))) : NaN,
  coverage: items.length ? (100 * items.filter((r) => r.covered).length) / items.length : NaN,
});
const row = (label: string, items: Result[]) => {
  const s = stats(items);
  return `| ${label} | ${s.n} | ${s.medianError} | ${s.coverage.toFixed(1)} % |`;
};

const all = stats(results);
const games = new Set(results.map((r) => r.sample.game)).size;
const passed =
  games >= TARGET.games &&
  all.medianError <= TARGET.medianError &&
  all.coverage >= TARGET.coverageMin &&
  all.coverage <= TARGET.coverageMax;

const bands = [...new Set(results.map((r) => bandOf(r.sample.rating)))].sort(
  (a, b) => (a ?? -1) - (b ?? -1),
);
const lines = [
  '# Validation de l’estimation d’Elo (AC-F6-4)',
  '',
  `Généré par \`npm run elo:validate -- --preset ${preset}\` le ${new Date().toISOString().slice(0, 10)}.`,
  `Moteur ${presetModel.engine}, profondeur ${presetModel.depth}, modèle calibré sur ${presetModel.samples} échantillons.`,
  `Validation : ${all.n} échantillons, ${games} parties, joueurs absents de la calibration (écartés : ${skipped.notAnalysed} non analysés, ${skipped.tooShort} trop courts, ${skipped.incomplete} incomplets).`,
  '',
  `Critère : au moins ${TARGET.games} parties, erreur absolue médiane ≤ ${TARGET.medianError}, ${TARGET.coverageMin} à ${TARGET.coverageMax} % des classements réels dans l’intervalle à 80 %.`,
  '',
  `**Résultat : ${passed ? 'atteint' : 'non atteint'}** (erreur médiane ${all.medianError}, couverture ${all.coverage.toFixed(1)} %).`,
  '',
  '| Groupe | Échantillons | Erreur médiane | Couverture |',
  '| --- | --- | --- | --- |',
  row('Tous', results),
  ...TIME_CLASSES.map((t) =>
    row(
      t,
      results.filter((r) => r.sample.timeClass === t),
    ),
  ),
  ...bands.map((band) =>
    row(
      band === null ? 'hors 400-2599' : bandLabel(band),
      results.filter((r) => bandOf(r.sample.rating) === band),
    ),
  ),
  '',
];
const report = lines.join('\n');
mkdirSync(new URL('../docs/', import.meta.url), { recursive: true });
writeFileSync(new URL(`../docs/elo-validation-${preset}.md`, import.meta.url), report);
console.log(report);
if (!passed) process.exitCode = 1;
