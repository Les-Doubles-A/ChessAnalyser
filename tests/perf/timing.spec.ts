// T12, étape 1 : durée réelle d'une analyse dans le navigateur (vrai Stockfish, site
// construit) sur 5 parties d'environ 40 coups du jeu de calibration local (data/).
// Usage : npm run measure:timing ; chaque mesure s'affiche sur une ligne « MESURE {...} ».
import { existsSync, readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { parseGame } from '../../src/chess/game';
import type { CollectedGame } from '../../scripts/dataset';

const GAMES_FILE = new URL('../../data/games.jsonl', import.meta.url);
const USER = 'mesure';
const ARCHIVES_URL = `https://api.chess.com/pub/player/${USER}/games/archives`;
const MONTH_URL = `https://api.chess.com/pub/player/${USER}/games/2026/10`;
const GAME_COUNT = 5;
/** Environ 40 coups : de 78 à 82 demi-coups. */
const MIN_PLIES = 78;
const MAX_PLIES = 82;

function pickGames(): { game: CollectedGame; plies: number }[] {
  if (!existsSync(GAMES_FILE)) return [];
  const picked: { game: CollectedGame; plies: number }[] = [];
  for (const line of readFileSync(GAMES_FILE, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const game = JSON.parse(line) as CollectedGame;
    const plies = parseGame(game.pgn).plies.length;
    if (plies >= MIN_PLIES && plies <= MAX_PLIES) picked.push({ game, plies });
    if (picked.length === GAME_COUNT) break;
  }
  return picked;
}

const games = pickGames();

/** Réponse d'archive mensuelle au format de l'API, une partie par adversaire fictif. */
const monthBody = {
  games: games.map(({ game }, i) => ({
    url: `https://www.chess.com/game/live/${9000000 + i}`,
    end_time: 1792000000 - i * 3600,
    time_class: game.timeClass,
    rules: 'chess',
    rated: true,
    white: { username: USER, rating: game.whiteRating, result: 'win' },
    black: { username: `adversaire${i + 1}`, rating: game.blackRating, result: 'resigned' },
    pgn: game.pgn,
  })),
};

test.describe.configure({ mode: 'serial' });

for (const preset of ['standard', 'deep'] as const) {
  games.forEach(({ plies }, i) => {
    test(`${preset}, partie ${i + 1} (${plies} demi-coups)`, async ({ page, browserName }) => {
      await page.route('https://api.chess.com/**', async (route) => {
        const url = route.request().url();
        const body =
          url === ARCHIVES_URL ? { archives: [MONTH_URL] } : url === MONTH_URL ? monthBody : null;
        await route.fulfill({
          status: body ? 200 : 404,
          json: body ?? {},
          headers: { 'Access-Control-Allow-Origin': '*' },
        });
      });
      await page.goto('/');
      await page.getByLabel('Analyse').selectOption(preset);
      await page.getByLabel('Pseudo chess.com').fill(USER);
      await page.getByRole('button', { name: 'Voir mes parties' }).click();

      const started = Date.now();
      await page.getByRole('button', { name: new RegExp(`adversaire${i + 1} \\(`) }).click();
      await expect(page.getByText(/^Analyse terminée/)).toBeVisible({ timeout: 20 * 60000 });
      const seconds = (Date.now() - started) / 1000;
      console.log(
        `MESURE ${JSON.stringify({ browser: browserName, preset, game: i + 1, plies, seconds })}`,
      );
    });
  });
}

if (games.length < GAME_COUNT) {
  test('mesures de durée', () => {
    test.skip(true, `data/games.jsonl absent ou sans ${GAME_COUNT} parties d'environ 40 coups`);
  });
}
