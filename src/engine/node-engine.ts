// Moteur Stockfish pour Node (tests d'intégration, scripts de calibration).
// Même variante et même dialogue UCI que le Web Worker du site.
import { createRequire } from 'node:module';
import { UciEngine, type UciTransport } from './uci';

interface NodeStockfish {
  listener?: (line: string) => void;
  processCommand(command: string): void;
  terminate?: () => void;
}

export function createNodeEngine(): UciEngine {
  const require = createRequire(import.meta.url);
  const load = require('stockfish') as (flavor: string) => NodeStockfish;
  const engine = load('lite-single');
  const transport: UciTransport = {
    send: (command) => engine.processCommand(command),
    listen: (onLine) => {
      engine.listener = onLine;
    },
    terminate: () => engine.terminate?.(),
  };
  return new UciEngine(transport);
}
