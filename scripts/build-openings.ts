// Génère src/data/openings.json depuis https://github.com/lichess-org/chess-openings (CC0-1.0).
// Usage : node scripts/build-openings.ts
//
// names : EPD -> [ECO, nom] pour les positions nommées.
// book  : EPD des positions intermédiaires des lignes connues qui n'ont pas de nom propre.
import { writeFileSync } from 'node:fs';
import { Chess } from 'chess.js';

const BASE = 'https://raw.githubusercontent.com/lichess-org/chess-openings/master';
const FILES = ['a.tsv', 'b.tsv', 'c.tsv', 'd.tsv', 'e.tsv'];
const OUTPUT = new URL('../src/data/openings.json', import.meta.url);

/** EPD au sens de la base Lichess : les 4 premiers champs du FEN. */
export function toEpd(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ');
}

const names: Record<string, [string, string]> = {};
const onPath = new Set<string>();
let lines = 0;

for (const file of FILES) {
  const response = await fetch(`${BASE}/${file}`);
  if (!response.ok) throw new Error(`${file} : HTTP ${response.status}`);
  const [header, ...rows] = (await response.text()).trim().split('\n');
  const columns = header!.split('\t');
  const eco = columns.indexOf('eco');
  const name = columns.indexOf('name');
  const pgn = columns.indexOf('pgn');
  if (eco < 0 || name < 0 || pgn < 0) throw new Error(`${file} : colonnes inattendues ${columns}`);

  for (const row of rows) {
    const cells = row.split('\t');
    const chess = new Chess();
    chess.loadPgn(cells[pgn]!);
    const replay = new Chess();
    for (const move of chess.history()) {
      replay.move(move);
      onPath.add(toEpd(replay.fen()));
    }
    names[toEpd(replay.fen())] = [cells[eco]!, cells[name]!];
    lines++;
  }
}

const book = [...onPath].filter((epd) => !(epd in names)).sort();
writeFileSync(
  OUTPUT,
  JSON.stringify({ source: 'lichess-org/chess-openings (CC0-1.0)', names, book }) + '\n',
);
console.log(
  `${lines} lignes, ${Object.keys(names).length} positions nommées, ${book.length} positions intermédiaires`,
);
