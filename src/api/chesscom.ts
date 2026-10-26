// Client de l'API publique chess.com (https://www.chess.com/news/view/published-data-api).
// Les requêtes passent par une file série : l'API tolère l'accès en série mais peut
// répondre 429 aux requêtes parallèles.

const API_BASE = 'https://api.chess.com/pub/player/';
const RATE_LIMIT_RETRY_MS = 2000;
const MAX_EMPTY_MONTHS_SKIPPED = 3;

export type TimeClass = 'bullet' | 'blitz' | 'rapid' | 'daily';
export type Outcome = 'win' | 'loss' | 'draw';

export interface PlayerSide {
  username: string;
  rating: number;
  result: string;
}

export interface GameSummary {
  url: string;
  endTime: number;
  timeClass: TimeClass | 'unknown';
  rules: string;
  rated: boolean;
  white: PlayerSide;
  black: PlayerSide;
  pgn: string;
  moveCount: number;
  supported: boolean;
}

export type ChessComErrorKind = 'not-found' | 'rate-limited' | 'unavailable' | 'bad-response';

export class ChessComError extends Error {
  readonly kind: ChessComErrorKind;

  constructor(kind: ChessComErrorKind, message: string) {
    super(message);
    this.name = 'ChessComError';
    this.kind = kind;
  }
}

export type UsernameCheck = { ok: true; value: string } | { ok: false; message: string };

// Règle locale volontairement stricte, à confronter aux règles réelles de chess.com.
const USERNAME_RE = /^[A-Za-z0-9_-]{3,25}$/;

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export function validateUsername(raw: string): UsernameCheck {
  const value = normalizeUsername(raw);
  if (!USERNAME_RE.test(value)) {
    return {
      ok: false,
      message: 'Pseudo invalide : 3 à 25 caractères, lettres, chiffres, « _ » ou « - ».',
    };
  }
  return { ok: true, value };
}

const DRAW_RESULTS = new Set([
  'agreed',
  'repetition',
  'stalemate',
  'insufficient',
  '50move',
  'timevsinsufficient',
]);

export function outcomeFor(side: PlayerSide): Outcome {
  if (side.result === 'win') return 'win';
  if (DRAW_RESULTS.has(side.result)) return 'draw';
  return 'loss';
}

/** Nombre de coups complets, d'après la numérotation du PGN. */
export function countMoves(pgn: string): number {
  const movetext = pgn.replace(/\[[^\]]*\]/g, ' ').replace(/\{[^}]*\}/g, ' ');
  let max = 0;
  for (const match of movetext.matchAll(/(\d+)\.(?!\.)/g)) {
    max = Math.max(max, Number(match[1]));
  }
  return max;
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface ClientOptions {
  fetch?: Fetch;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class ChessComClient {
  private readonly fetchImpl: Fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(options: ClientOptions = {}) {
    this.fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.sleep = options.sleep ?? defaultSleep;
  }

  /** URLs des archives mensuelles, de la plus ancienne à la plus récente. */
  async getArchives(username: string): Promise<string[]> {
    const url = `${API_BASE}${encodeURIComponent(username)}/games/archives`;
    const body = await this.getJson(url);
    const archives = isRecord(body) ? body.archives : undefined;
    if (!Array.isArray(archives) || !archives.every(isArchiveUrl)) {
      throw new ChessComError('bad-response', 'Réponse inattendue de chess.com.');
    }
    return archives;
  }

  /** Parties d'une archive mensuelle, de la plus récente à la plus ancienne. */
  async getMonth(archiveUrl: string): Promise<GameSummary[]> {
    if (!isArchiveUrl(archiveUrl)) {
      throw new ChessComError('bad-response', 'Adresse d’archive inattendue.');
    }
    const body = await this.getJson(archiveUrl);
    const games = isRecord(body) ? body.games : undefined;
    if (!Array.isArray(games)) {
      throw new ChessComError('bad-response', 'Réponse inattendue de chess.com.');
    }
    const parsed: GameSummary[] = [];
    for (const raw of games) {
      const game = toGameSummary(raw);
      if (game) parsed.push(game);
      else console.warn('Partie ignorée : format inattendu', raw);
    }
    return parsed.sort((a, b) => b.endTime - a.endTime);
  }

  /**
   * Charge le mois le plus récent qui contient des parties, en remontant au plus
   * quelques mois vides.
   */
  async getLatestGames(
    username: string,
  ): Promise<{ archives: string[]; index: number; games: GameSummary[] }> {
    const archives = await this.getArchives(username);
    const oldest = Math.max(0, archives.length - MAX_EMPTY_MONTHS_SKIPPED);
    for (let index = archives.length - 1; index >= oldest; index--) {
      const games = await this.getMonth(archives[index]!);
      if (games.length > 0) return { archives, index, games };
    }
    return { archives, index: -1, games: [] };
  }

  private getJson(url: string): Promise<unknown> {
    const run = () => this.request(url);
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async request(url: string, retried = false): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImpl(url, { headers: { Accept: 'application/json' } });
    } catch (error) {
      console.error('Requête chess.com en échec', error);
      throw new ChessComError('unavailable', 'chess.com ne répond pas.');
    }
    if (response.status === 404) {
      throw new ChessComError('not-found', 'Joueur introuvable.');
    }
    if (response.status === 429) {
      if (!retried) {
        await this.sleep(RATE_LIMIT_RETRY_MS);
        return this.request(url, true);
      }
      throw new ChessComError('rate-limited', 'chess.com ne répond pas.');
    }
    if (!response.ok) {
      throw new ChessComError('unavailable', 'chess.com ne répond pas.');
    }
    try {
      return await response.json();
    } catch {
      throw new ChessComError('bad-response', 'Réponse inattendue de chess.com.');
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isArchiveUrl(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(API_BASE);
}

const TIME_CLASSES: readonly string[] = ['bullet', 'blitz', 'rapid', 'daily'];

function toPlayerSide(value: unknown): PlayerSide | null {
  if (!isRecord(value)) return null;
  const { username, rating, result } = value;
  if (typeof username !== 'string' || typeof rating !== 'number' || typeof result !== 'string') {
    return null;
  }
  return { username, rating, result };
}

function toGameSummary(value: unknown): GameSummary | null {
  if (!isRecord(value)) return null;
  const white = toPlayerSide(value.white);
  const black = toPlayerSide(value.black);
  const { url, end_time, rules, pgn, time_class, rated } = value;
  if (
    !white ||
    !black ||
    typeof url !== 'string' ||
    !url.startsWith('https://www.chess.com/') ||
    typeof end_time !== 'number' ||
    typeof rules !== 'string' ||
    typeof pgn !== 'string'
  ) {
    return null;
  }
  return {
    url,
    endTime: end_time,
    timeClass:
      typeof time_class === 'string' && TIME_CLASSES.includes(time_class)
        ? (time_class as TimeClass)
        : 'unknown',
    rules,
    rated: rated === true,
    white,
    black,
    pgn,
    moveCount: countMoves(pgn),
    supported: rules === 'chess',
  };
}
