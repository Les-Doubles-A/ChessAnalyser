import type { Page } from '@playwright/test';
import { parseGame } from '../../src/chess/game';

/** Réponse UCI du point de vue du camp au trait, ex. `cp 150` ou `mate -3`. */
export interface FakeReply {
  score: string;
  best: string;
}

/**
 * Remplace Stockfish par un faux moteur UCI scripté (Web Worker) : chaque FEN reçoit
 * l'évaluation prévue, après `delayMs`. Les FEN absents valent `cp 0`.
 */
export async function mockEngine(
  page: Page,
  table: Record<string, FakeReply>,
  options: { delayMs?: number } = {},
) {
  const source = `
    const table = ${JSON.stringify(table)};
    const delay = ${options.delayMs ?? 0};
    let fen = '';
    let timer = null;
    let reply = null;
    const finish = () => {
      timer = null;
      postMessage('info depth 14 seldepth 14 multipv 1 score ' + reply.score + ' pv ' + reply.best);
      postMessage('bestmove ' + reply.best);
    };
    onmessage = (event) => {
      const cmd = event.data;
      if (cmd === 'uci') postMessage('uciok');
      else if (cmd === 'isready') postMessage('readyok');
      else if (cmd.startsWith('position fen ')) fen = cmd.slice(13);
      else if (cmd.startsWith('go')) {
        reply = table[fen] || { score: 'cp 0', best: 'a2a3' };
        timer = setTimeout(finish, delay);
      } else if (cmd === 'stop' && timer) {
        clearTimeout(timer);
        finish();
      }
    };
  `;
  await page.route('**/engine/stockfish-19-lite-single.js', (route) =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: source }),
  );
}

/** Table pour le mat du lion (1. f3 e5 2. g4 Qh4#), évaluations choisies pour les tests. */
export function foolsMateTable(pgn: string): Record<string, FakeReply> {
  const game = parseGame(pgn);
  const fens = [game.startFen, ...game.plies.map((p) => p.fenAfter)];
  return {
    [fens[0]!]: { score: 'cp 150', best: 'e2e4' }, // blancs au trait : +1.5
    [fens[1]!]: { score: 'cp 40', best: 'e7e5' }, // noirs au trait : -0.4 pour les blancs
    [fens[2]!]: { score: 'cp -60', best: 'e2e4' }, // blancs au trait : -0.6
    [fens[3]!]: { score: 'mate 3', best: 'd8h4' }, // noirs au trait, mat : -M3
  };
}
