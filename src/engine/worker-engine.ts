import { EngineStartError } from './types';
import { UciEngine, type UciTransport } from './uci';

/** Fichier copié depuis node_modules/stockfish/bin par scripts/copy-engine.mjs. */
export const ENGINE_FILE = 'stockfish-19-lite-single.js';
export const ENGINE_NAME = 'stockfish-19-lite-single';

/** Moteur Stockfish dans un Web Worker. Le .wasm doit être servi à côté du .js. */
export function createWorkerEngine(): UciEngine {
  if (typeof WebAssembly !== 'object' || typeof Worker !== 'function') {
    throw new EngineStartError('WebAssembly ou Web Worker indisponible');
  }
  let worker: Worker;
  try {
    worker = new Worker(`${import.meta.env.BASE_URL}engine/${ENGINE_FILE}`);
  } catch (error) {
    throw new EngineStartError(error);
  }
  const transport: UciTransport = {
    send: (command) => worker.postMessage(command),
    listen: (onLine) => {
      worker.onmessage = (event: MessageEvent) => {
        if (typeof event.data === 'string') onLine(event.data);
      };
    },
    terminate: () => worker.terminate(),
  };
  const engine = new UciEngine(transport);
  worker.onerror = (event) => {
    console.error('Erreur du moteur', event.message);
    engine.fail(new EngineStartError(event.message));
  };
  return engine;
}
