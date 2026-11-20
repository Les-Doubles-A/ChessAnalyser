// Fichiers locaux du jeu de calibration, tous dans data/ (exclu de git, jamais publié).
import { randomBytes } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';

export const DATA_DIR = fileURLToPath(new URL('../data/', import.meta.url));

export const dataPath = (name: string) => `${DATA_DIR}${name}`;

/** Lit un fichier JSON Lines ; une dernière ligne tronquée (arrêt brutal) est ignorée. */
export function readJsonl<T>(name: string): T[] {
  const path = dataPath(name);
  if (!existsSync(path)) return [];
  const rows: T[] = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line) as T);
    } catch {
      console.warn(`${name} : ligne illisible ignorée`);
    }
  }
  return rows;
}

export function appendJsonl(name: string, row: unknown) {
  mkdirSync(DATA_DIR, { recursive: true });
  appendFileSync(dataPath(name), `${JSON.stringify(row)}\n`);
}

export function writeJsonl(name: string, rows: unknown[]) {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(dataPath(name), rows.map((row) => `${JSON.stringify(row)}\n`).join(''));
}

/**
 * Écrit un fichier entier via un fichier temporaire puis un renommage : un arrêt brutal
 * laisse l'ancienne version intacte au lieu d'un fichier tronqué.
 */
export function writeFileAtomic(path: string, content: string) {
  mkdirSync(DATA_DIR, { recursive: true });
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, content);
  renameSync(temporary, path);
}

/** Clé locale des pseudonymes (HMAC), créée au premier lancement et jamais publiée. */
export function loadSecret(): string {
  const path = dataPath('secret.txt');
  if (!existsSync(path)) {
    mkdirSync(DATA_DIR, { recursive: true });
    // Lisible par le seul propriétaire sous Unix (sans effet sous Windows).
    writeFileSync(path, randomBytes(32).toString('hex'), { mode: 0o600 });
  }
  return readFileSync(path, 'utf8').trim();
}
