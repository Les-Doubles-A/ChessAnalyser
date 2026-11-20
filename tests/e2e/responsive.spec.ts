import { expect, test, type Page } from '@playwright/test';
import { FOOLS_MATE_PGN } from '../fixtures/chesscom';
import { foolsMateTable, mockEngine } from './fakeEngine';
import { mockChessCom, searchFor } from './helpers';

test.use({ viewport: { width: 360, height: 740 } });

async function hasNoHorizontalScroll(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
}

test('AC-X-3 : recherche, liste et partie sans défilement horizontal à 360 px', async ({
  page,
}) => {
  await mockChessCom(page);
  await page.goto('/');
  await hasNoHorizontalScroll(page);

  await searchFor(page, 'testeur');
  await expect(page.getByRole('button', { name: /^Partie du/ })).toHaveCount(3);
  await hasNoHorizontalScroll(page);

  await page.getByRole('button', { name: /morphy_fan/ }).click();
  const board = page.locator('.board');
  await expect(board).toBeVisible();
  await hasNoHorizontalScroll(page);
  const box = await board.boundingBox();
  expect(box!.width).toBeGreaterThan(300);
});

test('AC-X-3 : à 360 px, courbe sous l’échiquier, synthèse et variante sans débordement', async ({
  page,
}) => {
  await mockEngine(page, foolsMateTable(FOOLS_MATE_PGN));
  await mockChessCom(page);
  await page.goto('/');
  await searchFor(page, 'testeur');
  await page.getByRole('button', { name: /pressé/ }).click();
  await expect(page.getByText(/^Analyse terminée/)).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('heading', { name: 'Synthèse' })).toBeVisible();

  const board = (await page.locator('.board').boundingBox())!;
  const graph = (await page.locator('.eval-graph').boundingBox())!;
  expect(graph.y).toBeGreaterThanOrEqual(board.y + board.height);
  await hasNoHorizontalScroll(page);

  await page.getByRole('button', { name: 'Explorer des variantes' }).click();
  const field = page.getByLabel('Jouer un coup');
  await field.fill('e4');
  await field.press('Enter');
  await expect(page.getByRole('region', { name: /^Variante/ })).toBeVisible();
  await hasNoHorizontalScroll(page);
});
