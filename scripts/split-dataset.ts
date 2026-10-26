// Séparation fixe du jeu collecté en calibration et validation (T10, AC-F6-4).
// Usage : npm run dataset:split -- [--seed texte] [--validation 0.15]
// L'unité est la partie vue d'un joueur ; tous les échantillons d'un joueur restent du
// même côté. Écrit data/calibration.jsonl, data/validation.jsonl et data/split-report.txt.
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { dataPath, readJsonl, writeJsonl } from './data-files';
import { distributionReport, samplesOf, splitSamples, type CollectedGame } from './dataset';

const TARGET = { calibration: 2000, validation: 300 };

const { values } = parseArgs({
  options: {
    seed: { type: 'string', default: 'chessanalyser-t10' },
    validation: { type: 'string', default: '0.15' },
  },
});

const games = readJsonl<CollectedGame>('games.jsonl');
const { calibration, validation } = splitSamples(
  games.flatMap(samplesOf),
  values.seed,
  Number(values.validation),
);
writeJsonl('calibration.jsonl', calibration);
writeJsonl('validation.jsonl', validation);

const distinct = (samples: typeof calibration, key: 'player' | 'game') =>
  new Set(samples.map((s) => s[key])).size;
const describe = (samples: typeof calibration) =>
  `${samples.length} échantillons, ${distinct(samples, 'game')} parties, ${distinct(samples, 'player')} joueurs`;
const lines = [
  `Graine « ${values.seed} », part de validation ${values.validation}, ${games.length} parties collectées.`,
  `Calibration : ${describe(calibration)} (visé ≥ ${TARGET.calibration} parties).`,
  `Validation : ${describe(validation)} (visé ≥ ${TARGET.validation} parties).`,
  '',
  distributionReport('Calibration, par classement du joueur', calibration),
  '',
  distributionReport('Validation, par classement du joueur', validation),
];
const report = lines.join('\n');
writeFileSync(dataPath('split-report.txt'), `${report}\n`);
console.log(report);

if (
  distinct(calibration, 'game') < TARGET.calibration ||
  distinct(validation, 'game') < TARGET.validation
) {
  console.warn('\nEffectifs visés non atteints : poursuivre la collecte.');
  process.exitCode = 1;
}
