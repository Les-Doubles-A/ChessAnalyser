// T12 : parcours réels (M1, M2, M4 en partie) contre l'API publique de chess.com et le vrai
// moteur, sur le site construit. Rien n'est simulé : il faut un accès à Internet.
// Usage : npm run smoke:real ; pseudo public par défaut « hikaru »
// (CHESSANALYSER_SMOKE_USER pour un autre), captures d'écran dans CHESSANALYSER_SHOTS.
import { expect, test, type Page } from '@playwright/test';

const USER = (process.env.CHESSANALYSER_SMOKE_USER ?? 'hikaru').toLowerCase();
const SHOTS = process.env.CHESSANALYSER_SHOTS;

async function search(page: Page, username: string) {
  await page.getByLabel('Pseudo chess.com').fill(username);
  await page.getByRole('button', { name: 'Voir mes parties' }).click();
}

async function shot(page: Page, name: string, browserName: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${browserName}-${name}.png`, fullPage: true });
}

test('M1 : liste réelle, filtre, mois précédent, pseudo inconnu, réseau coupé', async ({
  page,
  browserName,
}) => {
  await page.goto('/');
  await search(page, USER);
  await expect(page.getByRole('heading', { name: `Parties de ${USER}` })).toBeVisible({
    timeout: 30000,
  });
  const games = page.getByRole('button', { name: /^Partie du/ });
  const first = await games.count();
  expect(first).toBeGreaterThan(0);
  await shot(page, 'liste', browserName);

  await page.getByLabel('Cadence').selectOption('blitz');
  for (const label of await games.evaluateAll((rows) => rows.map((r) => r.ariaLabel ?? ''))) {
    expect(label).toContain(', blitz,');
  }
  await page.getByLabel('Cadence').selectOption('all');

  const previous = page.getByRole('button', { name: 'Mois précédent' });
  if (await previous.isVisible()) {
    await previous.click();
    await expect.poll(() => games.count(), { timeout: 30000 }).toBeGreaterThan(first);
  }

  await search(page, 'zzinexistant-ca-9x7q');
  await expect(
    page.getByText('Aucun joueur chess.com ne porte le pseudo « zzinexistant-ca-9x7q ».'),
  ).toBeVisible({ timeout: 30000 });

  // Coupure simulée en interrompant les requêtes : en simple mode hors ligne, le navigateur
  // ressert les archives depuis son cache HTTP et la liste s'affiche quand même.
  const cut = '**/api.chess.com/**';
  await page.route(cut, (route) => route.abort('internetdisconnected'));
  await search(page, USER);
  await expect(page.getByText('chess.com ne répond pas.')).toBeVisible({ timeout: 30000 });
  await page.unroute(cut);
  await page.getByRole('button', { name: 'Réessayer' }).click();
  await expect(page.getByRole('heading', { name: `Parties de ${USER}` })).toBeVisible({
    timeout: 30000,
  });
});

test('M2 et M4 : partie réelle analysée par le vrai moteur', async ({ page, browserName }) => {
  const months: { url: string; body: { games?: { url: string; pgn: string }[] } }[] = [];
  page.on('response', async (response) => {
    if (/\/games\/\d{4}\/\d{2}$/.test(response.url())) {
      months.push({ url: response.url(), body: await response.json().catch(() => ({})) });
    }
  });
  await page.goto('/');
  await search(page, USER);
  const games = page.getByRole('button', { name: /^Partie du/ });
  await expect(games.first()).toBeVisible({ timeout: 30000 });
  await games.first().click();

  await expect(page.getByText(/^Analyse terminée/)).toBeVisible({ timeout: 10 * 60000 });
  await expect(page.locator('.opening')).not.toHaveText('Ouverture : …');

  // Ouverture affichée et code ECO de l'en-tête PGN de chess.com, pour comparaison.
  const url = await page.getByRole('link', { name: 'Voir sur chess.com' }).getAttribute('href');
  expect(url).toMatch(/^https:\/\/www\.chess\.com\//);
  const pgn = months.flatMap((m) => m.body.games ?? []).find((g) => g.url === url)?.pgn ?? '';
  const eco = /\[ECO "([^"]+)"\]/.exec(pgn)?.[1] ?? 'absent';
  const opening = (await page.locator('.opening').textContent()) ?? '';
  const orientation = (await page.locator('.board').getAttribute('aria-label')) ?? '';
  console.log(`M4 ${JSON.stringify({ browser: browserName, url, eco, opening })}`);
  console.log(`M2 ${JSON.stringify({ browser: browserName, orientation })}`);
  await shot(page, 'analyse', browserName);

  // Premier moment clé, s'il y en a : l'échiquier s'y place et la flèche du meilleur coup apparaît.
  const moments = page.locator('.key-moment');
  if ((await moments.count()) > 0) {
    await moments.first().click();
    await expect(page.locator('.position-indicator')).toHaveText(/^Demi-coup \d+ sur \d+$/);
    await expect(page.locator('[id^="analysis-board-arrowhead-"]')).toHaveCount(1);
    await shot(page, 'moment-cle', browserName);
  }

  // Navigation pendant et après l'analyse : réponse sans délai perceptible.
  await page.getByRole('button', { name: 'Fin' }).click();
  await expect(page.locator('.position-indicator')).toHaveText(/^Demi-coup (\d+) sur \1$/);
  await page.setViewportSize({ width: 360, height: 740 });
  await shot(page, 'analyse-360', browserName);
});
