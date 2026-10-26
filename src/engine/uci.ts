// Dialogue UCI commun au Web Worker (navigateur) et au moteur Node (scripts, tests).
import { abortError, EngineStartError, type Engine, type PositionEval, type Score } from './types';

export interface UciTransport {
  send(command: string): void;
  /** Enregistre le récepteur des lignes émises par le moteur. */
  listen(onLine: (line: string) => void): void;
  terminate(): void;
}

export interface InfoLine {
  depth: number;
  /** Score du point de vue du camp au trait, comme le renvoie UCI. */
  score: { cp: number } | { mate: number };
  pv: string[];
}

/** Lit une ligne `info … score …`. Ignore les bornes (lowerbound, upperbound). */
export function parseInfo(line: string): InfoLine | null {
  if (!line.startsWith('info ') || / (lower|upper)bound\b/.test(line)) {
    return null;
  }
  const tokens = line.split(/\s+/);
  const depthAt = tokens.indexOf('depth');
  const scoreAt = tokens.indexOf('score');
  if (depthAt < 0 || scoreAt < 0) return null;
  const depth = Number(tokens[depthAt + 1]);
  const kind = tokens[scoreAt + 1];
  const value = Number(tokens[scoreAt + 2]);
  if (!Number.isFinite(depth) || !Number.isFinite(value)) return null;
  if (kind !== 'cp' && kind !== 'mate') return null;
  const multipvAt = tokens.indexOf('multipv');
  if (multipvAt >= 0 && tokens[multipvAt + 1] !== '1') return null;
  const pvAt = tokens.indexOf('pv');
  const pv = pvAt >= 0 ? tokens.slice(pvAt + 1) : [];
  return { depth, score: kind === 'cp' ? { cp: value } : { mate: value }, pv };
}

/** Convertit un score UCI (camp au trait) en score du point de vue des blancs. */
export function toWhiteScore(score: InfoLine['score'], sideToMove: 'w' | 'b'): Score {
  const sign = sideToMove === 'w' ? 1 : -1;
  if ('cp' in score) return { cp: score.cp * sign + 0 };
  const moverWins = score.mate > 0;
  const winner = moverWins === (sideToMove === 'w') ? 'w' : 'b';
  return { mate: Math.abs(score.mate), winner };
}

export function sideToMove(fen: string): 'w' | 'b' {
  return fen.split(' ')[1] === 'b' ? 'b' : 'w';
}

const START_TIMEOUT_MS = 20000;

interface Pending {
  fen: string;
  last?: InfoLine;
  aborted: boolean;
  resolve: (value: PositionEval) => void;
  reject: (reason: unknown) => void;
}

/**
 * Pilote un moteur UCI : une commande `go` à la fois, file d'attente pour le reste.
 * L'annulation envoie `stop` puis attend `bestmove` pour garder le protocole synchrone.
 */
export class UciEngine implements Engine {
  private readonly transport: UciTransport;
  private readonly ready: Promise<void>;
  private queue: Promise<unknown> = Promise.resolve();
  private pending?: Pending;
  private waiters: { token: string; resolve: () => void }[] = [];
  private readonly failure: Promise<never>;
  private rejectFailure!: (error: Error) => void;

  constructor(transport: UciTransport, options: { hashMb?: number; timeoutMs?: number } = {}) {
    this.transport = transport;
    this.failure = new Promise<never>((_, reject) => {
      this.rejectFailure = reject;
    });
    transport.listen((line) => this.onLine(line));
    this.ready = this.start(options.hashMb ?? 16, options.timeoutMs ?? START_TIMEOUT_MS);
    // Évite des rejets non gérés si personne n'utilise le moteur.
    this.ready.catch(() => undefined);
    this.failure.catch(() => undefined);
  }

  /** Met le moteur hors service (erreur fatale du worker) : toute attente échoue aussitôt. */
  fail(error: Error): void {
    this.pending = undefined;
    this.rejectFailure(error);
  }

  newGame(): Promise<void> {
    return this.enqueue(async () => {
      this.transport.send('ucinewgame');
      await this.waitFor('readyok', () => this.transport.send('isready'));
    });
  }

  evaluate(fen: string, depth: number, signal?: AbortSignal): Promise<PositionEval> {
    return this.enqueue(
      () =>
        new Promise<PositionEval>((resolve, reject) => {
          if (signal?.aborted) {
            reject(abortError());
            return;
          }
          const pending: Pending = { fen, aborted: false, resolve, reject };
          this.pending = pending;
          signal?.addEventListener(
            'abort',
            () => {
              if (this.pending !== pending) return;
              pending.aborted = true;
              this.transport.send('stop');
            },
            { once: true },
          );
          this.transport.send(`position fen ${fen}`);
          this.transport.send(`go depth ${depth}`);
        }),
    );
  }

  terminate(): void {
    this.transport.terminate();
  }

  private async start(hashMb: number, timeoutMs: number): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new EngineStartError('délai dépassé')), timeoutMs);
    });
    try {
      await Promise.race([
        this.waitFor('uciok', () => this.transport.send('uci')),
        timeout,
        this.failure,
      ]);
      this.transport.send('setoption name Threads value 1');
      this.transport.send(`setoption name Hash value ${hashMb}`);
      await Promise.race([
        this.waitFor('readyok', () => this.transport.send('isready')),
        timeout,
        this.failure,
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = async () => {
      await this.ready;
      return Promise.race([task(), this.failure]);
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private waitFor(token: string, send: () => void): Promise<void> {
    return new Promise((resolve) => {
      this.waiters.push({ token, resolve });
      send();
    });
  }

  private onLine(line: string): void {
    const waiter = this.waiters.find((w) => line.trim() === w.token);
    if (waiter) {
      this.waiters = this.waiters.filter((w) => w !== waiter);
      waiter.resolve();
      return;
    }
    const pending = this.pending;
    if (!pending) return;
    if (line.startsWith('info ')) {
      const info = parseInfo(line);
      if (info && (!pending.last || info.depth >= pending.last.depth)) pending.last = info;
      return;
    }
    if (line.startsWith('bestmove')) {
      this.pending = undefined;
      if (pending.aborted) {
        pending.reject(abortError());
        return;
      }
      const best = line.split(/\s+/)[1];
      if (!pending.last) {
        pending.reject(new Error(`Aucune évaluation reçue pour ${pending.fen}`));
        return;
      }
      pending.resolve({
        fen: pending.fen,
        depth: pending.last.depth,
        score: toWhiteScore(pending.last.score, sideToMove(pending.fen)),
        bestMoveUci: best && best !== '(none)' ? best : undefined,
        pv: pending.last.pv,
      });
    }
  }
}
