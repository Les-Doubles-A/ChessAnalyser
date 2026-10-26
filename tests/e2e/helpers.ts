import type { Page } from '@playwright/test';
import { ARCHIVES_URL, MONTH_URLS, OCTOBER_GAMES, SEPTEMBER_GAMES } from '../fixtures/chesscom';

export type MockReply = { status: number; body?: unknown };

/**
 * Simule api.chess.com. Chaque URL peut recevoir une suite de réponses ; la
 * dernière est répétée. Renvoie la liste des URL appelées.
 */
export async function mockChessCom(page: Page, overrides: Record<string, MockReply[]> = {}) {
  const routes: Record<string, MockReply[]> = {
    [ARCHIVES_URL]: [{ status: 200, body: { archives: MONTH_URLS } }],
    [MONTH_URLS[1]!]: [{ status: 200, body: OCTOBER_GAMES }],
    [MONTH_URLS[0]!]: [{ status: 200, body: SEPTEMBER_GAMES }],
    ...overrides,
  };
  const calls: string[] = [];
  await page.route('https://api.chess.com/**', async (route) => {
    const url = route.request().url();
    calls.push(url);
    const queue = routes[url];
    const reply = queue && (queue.length > 1 ? queue.shift() : queue[0]);
    if (!reply) {
      await route.fulfill({ status: 404, json: { code: 0, message: 'not found' } });
      return;
    }
    await route.fulfill({
      status: reply.status,
      json: reply.body ?? {},
      headers: { 'Access-Control-Allow-Origin': '*' },
    });
  });
  return calls;
}

export async function searchFor(page: Page, username: string) {
  await page.getByLabel('Pseudo chess.com').fill(username);
  await page.getByRole('button', { name: 'Voir mes parties' }).click();
}
