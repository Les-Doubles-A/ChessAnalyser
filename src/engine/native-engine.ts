// Stockfish natif (exécutable) piloté depuis Node : sert à calibrer le modèle Elo de
// l'application de bureau (desktop/) avec le même moteur qu'elle embarque. Même dialogue
// UCI que le Web Worker du site (src/engine/uci.ts).
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { UciEngine, type UciTransport } from './uci';

export function createNativeEngine(executable: string): UciEngine {
  const child = spawn(executable, [], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
  const transport: UciTransport = {
    send: (command) => {
      if (child.stdin.writable) child.stdin.write(`${command}\n`);
    },
    listen: (onLine) => {
      createInterface({ input: child.stdout }).on('line', onLine);
    },
    terminate: () => {
      if (child.stdin.writable) child.stdin.end('quit\n');
      child.kill();
    },
  };
  const engine = new UciEngine(transport);
  child.on('error', (error) => engine.fail(error));
  child.on('exit', (code) => {
    if (code !== 0 && code !== null) engine.fail(new Error(`Stockfish arrêté (code ${code})`));
  });
  return engine;
}
