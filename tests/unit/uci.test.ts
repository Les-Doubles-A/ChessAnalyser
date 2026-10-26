import { describe, expect, it } from 'vitest';
import { parseInfo, toWhiteScore, UciEngine, type UciTransport } from '../../src/engine/uci';
import { EngineStartError, isAbortError } from '../../src/engine/types';

describe('parseInfo', () => {
  it('lit une ligne Stockfish 19', () => {
    const line =
      'info depth 14 seldepth 23 multipv 1 score cp -574 nodes 26071 nps 226704 hashfull 9 time 115 pv c4c5 f6e4 f1b5';
    expect(parseInfo(line)).toEqual({
      depth: 14,
      score: { cp: -574 },
      pv: ['c4c5', 'f6e4', 'f1b5'],
    });
  });

  it('lit un mat et ignore les bornes et les lignes sans score', () => {
    expect(
      parseInfo('info depth 10 seldepth 2 multipv 1 score mate 1 nodes 200 pv d1d8')?.score,
    ).toEqual({
      mate: 1,
    });
    expect(parseInfo('info depth 12 score cp 30 lowerbound nodes 5 pv e2e4')).toBeNull();
    expect(parseInfo('info string NNUE evaluation using nn.nnue')).toBeNull();
    expect(parseInfo('info depth 5 currmove e2e4 currmovenumber 1')).toBeNull();
  });
});

describe('toWhiteScore', () => {
  it('inverse le score quand les noirs ont le trait', () => {
    expect(toWhiteScore({ cp: 50 }, 'w')).toEqual({ cp: 50 });
    expect(toWhiteScore({ cp: 50 }, 'b')).toEqual({ cp: -50 });
    expect(toWhiteScore({ cp: 0 }, 'b')).toEqual({ cp: 0 });
    expect(toWhiteScore({ mate: 1 }, 'b')).toEqual({ mate: 1, winner: 'b' });
    expect(toWhiteScore({ mate: -2 }, 'b')).toEqual({ mate: 2, winner: 'w' });
    expect(toWhiteScore({ mate: -2 }, 'w')).toEqual({ mate: 2, winner: 'b' });
  });
});

/** Faux moteur UCI scripté. */
function fakeTransport(options: { silent?: boolean } = {}) {
  let onLine: (line: string) => void = () => undefined;
  const sent: string[] = [];
  let pendingGo = false;
  const transport: UciTransport & { sent: string[]; finishGo: () => void } = {
    sent,
    send(command) {
      sent.push(command);
      if (options.silent) return;
      queueMicrotask(() => {
        if (command === 'uci') onLine('uciok');
        if (command === 'isready') onLine('readyok');
        if (command.startsWith('go')) {
          pendingGo = true;
          onLine('info depth 1 score cp 10 pv e2e4');
          onLine('info depth 2 score cp 25 pv d2d4 d7d5');
        }
        if (command === 'stop' && pendingGo) transport.finishGo();
      });
    },
    listen(cb) {
      onLine = cb;
    },
    terminate() {},
    finishGo() {
      pendingGo = false;
      onLine('bestmove d2d4 ponder d7d5');
    },
  };
  return transport;
}

const BLACK_TO_MOVE = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';

describe('UciEngine', () => {
  it('démarre, évalue et convertit au point de vue des blancs', async () => {
    const transport = fakeTransport();
    const engine = new UciEngine(transport);
    const result = engine.evaluate(BLACK_TO_MOVE, 2);
    await new Promise((r) => setTimeout(r, 0));
    transport.finishGo();
    await expect(result).resolves.toEqual({
      fen: BLACK_TO_MOVE,
      depth: 2,
      score: { cp: -25 },
      bestMoveUci: 'd2d4',
      pv: ['d2d4', 'd7d5'],
    });
    expect(transport.sent.slice(0, 4)).toEqual([
      'uci',
      'setoption name Threads value 1',
      'setoption name Hash value 16',
      'isready',
    ]);
    expect(transport.sent).toContain(`position fen ${BLACK_TO_MOVE}`);
    expect(transport.sent).toContain('go depth 2');
  });

  it('annule : envoie stop puis rejette avec AbortError', async () => {
    const transport = fakeTransport();
    const engine = new UciEngine(transport);
    const controller = new AbortController();
    const result = engine.evaluate(BLACK_TO_MOVE, 30, controller.signal);
    await new Promise((r) => setTimeout(r, 0));
    controller.abort();
    const error = await result.catch((e: unknown) => e);
    expect(isAbortError(error)).toBe(true);
    expect(transport.sent).toContain('stop');
  });

  it('fail() fait échouer aussitôt l’évaluation en cours et les suivantes', async () => {
    const engine = new UciEngine(fakeTransport());
    const running = engine.evaluate(BLACK_TO_MOVE, 30);
    await new Promise((r) => setTimeout(r, 0));
    engine.fail(new EngineStartError('worker en erreur'));
    await expect(running).rejects.toBeInstanceOf(EngineStartError);
    await expect(engine.evaluate(BLACK_TO_MOVE, 2)).rejects.toBeInstanceOf(EngineStartError);
  });

  it('échoue au démarrage si le moteur ne répond pas', async () => {
    const engine = new UciEngine(fakeTransport({ silent: true }), { timeoutMs: 20 });
    await expect(engine.evaluate(BLACK_TO_MOVE, 2)).rejects.toBeInstanceOf(EngineStartError);
  });
});
