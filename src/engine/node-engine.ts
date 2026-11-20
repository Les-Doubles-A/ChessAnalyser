// Moteur Stockfish pour Node (tests d'intégration, scripts de calibration).
// Même variante et même dialogue UCI que le Web Worker du site.
import { createRequire } from 'node:module';
import { UciEngine, type UciTransport } from './uci';

interface NodeStockfish {
  listener?: (line: string) => void;
  processCommand(command: string): void;
  terminate?: () => void;
}

/**
 * Variante « lite-single » par défaut, celle du site. « single » (réseau NNUE complet,
 * wasm de 99 Mo) ne sert qu'à mesurer l'écart avec le moteur du site (H5).
 */
export type NodeFlavor = 'lite-single' | 'single';

export function createNodeEngine(flavor: NodeFlavor = 'lite-single'): UciEngine {
  const require = createRequire(import.meta.url);
  const load = require('stockfish') as (flavor: string) => NodeStockfish;
  const engine = load(flavor);
  const transport: UciTransport = {
    send: (command) => engine.processCommand(command),
    listen: (onLine) => {
      engine.listener = onLine;
    },
    terminate: () => engine.terminate?.(),
  };
  return new UciEngine(transport);
}
