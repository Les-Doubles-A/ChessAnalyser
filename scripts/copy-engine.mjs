// Copie Stockfish 19 lite mono-thread (≈ 1,9 Mo) de node_modules vers public/engine/.
// Seuls ces deux fichiers sont publiés ; le paquet npm complet pèse environ 205 Mo.
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const source = dirname(require('stockfish').findEngine('lite-single'));
const target = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'engine');
const files = ['stockfish-19-lite-single.js', 'stockfish-19-lite-single.wasm'];

mkdirSync(target, { recursive: true });
for (const file of files) copyFileSync(join(source, file), join(target, file));
copyFileSync(join(source, '..', 'Copying.txt'), join(target, 'COPYING-stockfish.txt'));
console.log(`Moteur copié dans ${target}`);
