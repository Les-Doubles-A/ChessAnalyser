import { describe, expect, it, vi } from 'vitest';
import {
  ChessComClient,
  ChessComError,
  countMoves,
  outcomeFor,
  validateUsername,
} from '../../src/api/chesscom';
import {
  ARCHIVES_URL,
  MONTH_URLS,
  OCTOBER_GAMES,
  OPERA_PGN,
  SEPTEMBER_GAMES,
} from '../fixtures/chesscom';

type Reply = { status: number; body?: unknown } | Error;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body ?? {}), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Faux fetch : chaque URL renvoie la suite de réponses prévue, dans l'ordre. */
function fakeFetch(routes: Record<string, Reply[]>) {
  let inFlight = 0;
  let maxInFlight = 0;
  const calls: string[] = [];
  const fetch = vi.fn(async (url: string) => {
    calls.push(url);
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 1));
    inFlight--;
    const reply = routes[url]?.shift();
    if (!reply) throw new Error(`URL inattendue : ${url}`);
    if (reply instanceof Error) throw reply;
    return jsonResponse(reply.status, reply.body);
  });
  return { fetch, calls, maxInFlight: () => maxInFlight };
}

const noSleep = vi.fn(async () => undefined);

describe('validateUsername', () => {
  it('accepte un pseudo valide et le normalise', () => {
    expect(validateUsername('  Magnus_C-1 ')).toEqual({ ok: true, value: 'magnus_c-1' });
  });

  it.each(['', 'ab', 'a'.repeat(26), 'jean dupont', 'é_lève', 'x/../y', 'pseudo?'])(
    'refuse « %s »',
    (raw) => {
      expect(validateUsername(raw).ok).toBe(false);
    },
  );
});

describe('outils', () => {
  it('compte les coups complets du PGN', () => {
    expect(countMoves(OPERA_PGN)).toBe(17);
  });

  it('traduit le résultat chess.com', () => {
    expect(outcomeFor({ username: 'a', rating: 1, result: 'win' })).toBe('win');
    expect(outcomeFor({ username: 'a', rating: 1, result: 'repetition' })).toBe('draw');
    expect(outcomeFor({ username: 'a', rating: 1, result: 'timeout' })).toBe('loss');
  });
});

describe('ChessComClient', () => {
  it('charge le mois le plus récent, trié du plus récent au plus ancien', async () => {
    const { fetch } = fakeFetch({
      [ARCHIVES_URL]: [{ status: 200, body: { archives: MONTH_URLS } }],
      [MONTH_URLS[1]!]: [{ status: 200, body: OCTOBER_GAMES }],
    });
    const client = new ChessComClient({ fetch, sleep: noSleep });
    const result = await client.getLatestGames('testeur');

    expect(result.index).toBe(1);
    expect(result.games.map((g) => g.url.slice(-1))).toEqual(['3', '2', '1', '4']);
    expect(result.games[0]).toMatchObject({ timeClass: 'rapid', moveCount: 17, supported: true });
  });

  it('ignore une partie au format inattendu', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { fetch } = fakeFetch({ [MONTH_URLS[1]!]: [{ status: 200, body: OCTOBER_GAMES }] });
    const games = await new ChessComClient({ fetch }).getMonth(MONTH_URLS[1]!);
    expect(games).toHaveLength(4);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('marque une partie de variante comme non prise en charge (AC-F1-6)', async () => {
    const { fetch } = fakeFetch({ [MONTH_URLS[1]!]: [{ status: 200, body: OCTOBER_GAMES }] });
    const games = await new ChessComClient({ fetch }).getMonth(MONTH_URLS[1]!);
    const variant = games.find((g) => g.rules === 'chess960');
    expect(variant?.supported).toBe(false);
  });

  it('renvoie not-found pour un pseudo inconnu (AC-F1-2)', async () => {
    const { fetch } = fakeFetch({
      [ARCHIVES_URL]: [{ status: 404, body: { code: 0, message: 'User "testeur" not found.' } }],
    });
    await expect(new ChessComClient({ fetch }).getArchives('testeur')).rejects.toMatchObject({
      kind: 'not-found',
    });
  });

  it('réessaie une fois après 2 s sur 429, puis réussit (AC-F1-4)', async () => {
    const sleep = vi.fn(async () => undefined);
    const { fetch } = fakeFetch({
      [ARCHIVES_URL]: [{ status: 429 }, { status: 200, body: { archives: MONTH_URLS } }],
    });
    const archives = await new ChessComClient({ fetch, sleep }).getArchives('testeur');
    expect(archives).toEqual(MONTH_URLS);
    expect(sleep).toHaveBeenCalledWith(2000);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('abandonne après deux 429 consécutifs (AC-F1-4)', async () => {
    const { fetch } = fakeFetch({ [ARCHIVES_URL]: [{ status: 429 }, { status: 429 }] });
    await expect(
      new ChessComClient({ fetch, sleep: noSleep }).getArchives('testeur'),
    ).rejects.toMatchObject({ kind: 'rate-limited' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('renvoie unavailable sur 500 ou réseau coupé (AC-F1-4)', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { fetch } = fakeFetch({
      [ARCHIVES_URL]: [{ status: 503 }, new TypeError('Failed to fetch')],
    });
    const client = new ChessComClient({ fetch });
    await expect(client.getArchives('testeur')).rejects.toMatchObject({ kind: 'unavailable' });
    await expect(client.getArchives('testeur')).rejects.toMatchObject({ kind: 'unavailable' });
    error.mockRestore();
  });

  it('renvoie bad-response sur un JSON non conforme', async () => {
    const { fetch } = fakeFetch({
      [ARCHIVES_URL]: [{ status: 200, body: { archives: ['https://evil.example/x'] } }],
    });
    await expect(new ChessComClient({ fetch }).getArchives('testeur')).rejects.toBeInstanceOf(
      ChessComError,
    );
  });

  it('renvoie une liste vide pour un joueur sans archive (AC-F1-5)', async () => {
    const { fetch } = fakeFetch({ [ARCHIVES_URL]: [{ status: 200, body: { archives: [] } }] });
    const result = await new ChessComClient({ fetch }).getLatestGames('testeur');
    expect(result).toEqual({ archives: [], index: -1, games: [] });
  });

  it('remonte au mois précédent si le dernier est vide', async () => {
    const { fetch } = fakeFetch({
      [ARCHIVES_URL]: [{ status: 200, body: { archives: MONTH_URLS } }],
      [MONTH_URLS[1]!]: [{ status: 200, body: { games: [] } }],
      [MONTH_URLS[0]!]: [{ status: 200, body: SEPTEMBER_GAMES }],
    });
    const result = await new ChessComClient({ fetch }).getLatestGames('testeur');
    expect(result.index).toBe(0);
    expect(result.games).toHaveLength(1);
  });

  it("n'envoie jamais deux requêtes en parallèle", async () => {
    const { fetch, maxInFlight } = fakeFetch({
      [ARCHIVES_URL]: [
        { status: 200, body: { archives: MONTH_URLS } },
        { status: 200, body: { archives: MONTH_URLS } },
      ],
      [MONTH_URLS[1]!]: [{ status: 200, body: OCTOBER_GAMES }],
    });
    const client = new ChessComClient({ fetch });
    await Promise.all([
      client.getArchives('testeur'),
      client.getArchives('testeur'),
      client.getMonth(MONTH_URLS[1]!),
    ]);
    expect(maxInFlight()).toBe(1);
  });

  it('encode le pseudo dans l’URL', async () => {
    const { fetch, calls } = fakeFetch({
      'https://api.chess.com/pub/player/a%2Fb/games/archives': [
        { status: 200, body: { archives: [] } },
      ],
    });
    await new ChessComClient({ fetch }).getArchives('a/b');
    expect(calls).toEqual(['https://api.chess.com/pub/player/a%2Fb/games/archives']);
  });
});
