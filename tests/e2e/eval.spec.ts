import { expect, test, type Page } from '@playwright/test';
import { FOOLS_MATE_PGN } from '../fixtures/chesscom';
import { foolsMateTable, mockEngine } from './fakeEngine';
import { mockChessCom, searchFor } from './helpers';

async function openFoolsMate(page: Page) {
  await mockChessCom(page);
  await page.goto('/');
  await searchFor(page, 'testeur');
  await page.getByRole('button', { name: /pressé/ }).click();
}

const indicator = (page: Page) => page.locator('.position-indicator');
const bar = (page: Page) => page.locator('.eval-bar');

async function whiteHeight(page: Page): Promise<number> {
  const style = (await page.locator('.eval-bar-white').getAttribute('style')) ?? '';
  return Number(/height:\s*([\d.]+)%/.exec(style)?.[1]);
}

test.describe('Analyse moteur (F3) avec un faux moteur', () => {
  test('AC-F3-1 : l’analyse démarre seule et la progression avance', async ({ page }) => {
    await mockEngine(page, foolsMateTable(FOOLS_MATE_PGN), { delayMs: 600 });
    await openFoolsMate(page);
    await expect(page.getByText(/Analyse : [1-3] \/ 5 positions/)).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Analyse terminée (Standard, profondeur 14).')).toBeVisible({
      timeout: 15000,
    });
  });

  test('AC-F3-2 : « Suivant » répond en moins de 200 ms pendant l’analyse', async ({ page }) => {
    await mockEngine(page, foolsMateTable(FOOLS_MATE_PGN), { delayMs: 1500 });
    await openFoolsMate(page);
    await expect(page.getByText(/Analyse : \d \/ 5 positions/)).toBeVisible();
    const elapsed = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const target = document.querySelector('.position-indicator')!;
          const before = target.textContent;
          const t0 = performance.now();
          const observer = new MutationObserver(() => {
            if (target.textContent !== before) {
              observer.disconnect();
              resolve(performance.now() - t0);
            }
          });
          observer.observe(target, { childList: true, characterData: true, subtree: true });
          const next = [...document.querySelectorAll('button')].find(
            (b) => b.textContent === 'Suivant',
          )!;
          next.click();
        }),
    );
    expect(elapsed).toBeLessThan(200);
  });

  test('AC-F3-3 : annuler arrête vite et garde les évaluations obtenues', async ({ page }) => {
    await mockEngine(page, foolsMateTable(FOOLS_MATE_PGN), { delayMs: 700 });
    await openFoolsMate(page);
    await expect(page.getByText(/Analyse : [1-3] \/ 5 positions/)).toBeVisible({ timeout: 15000 });
    const t0 = Date.now();
    await page.getByRole('button', { name: 'Annuler' }).click();
    await expect(page.getByText('Analyse incomplète.')).toBeVisible({ timeout: 1000 });
    expect(Date.now() - t0).toBeLessThan(1000);
    await expect(bar(page)).toHaveAttribute('aria-label', 'Évaluation : +1.5');
    await expect(page.getByRole('button', { name: 'Relancer l’analyse' })).toBeVisible();
  });

  test('AC-F3-4 et AC-F4-4 : moteur indisponible, navigation conservée', async ({ page }) => {
    await page.route('**/engine/stockfish-19-lite-single.js', (route) =>
      route.fulfill({ status: 404, body: 'introuvable' }),
    );
    await openFoolsMate(page);
    await expect(page.getByRole('alert')).toHaveText(
      'Le moteur d’analyse n’a pas pu démarrer dans ce navigateur.',
    );
    await expect(bar(page)).toHaveAttribute('aria-label', 'Évaluation en attente');
    await expect(bar(page)).toHaveText('…');
    await page.getByRole('button', { name: 'Suivant' }).click();
    await expect(indicator(page)).toHaveText('Demi-coup 1 sur 4');
  });

  test('P3 : analyse profonde', async ({ page }) => {
    await mockEngine(page, foolsMateTable(FOOLS_MATE_PGN), { delayMs: 50 });
    await openFoolsMate(page);
    await page.getByRole('button', { name: 'Analyse profonde' }).click();
    await expect(page.getByText('Analyse terminée (profonde, profondeur 18).')).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByRole('button', { name: 'Analyse profonde' })).toHaveCount(0);
  });
});

test.describe('Barre et courbe d’évaluation (F4)', () => {
  test.beforeEach(async ({ page }) => {
    await mockEngine(page, foolsMateTable(FOOLS_MATE_PGN));
    await openFoolsMate(page);
    await expect(page.getByText('Analyse terminée (Standard, profondeur 14).')).toBeVisible({
      timeout: 15000,
    });
  });

  test('AC-F4-1 : +1.5 et 63 % de blanc', async ({ page }) => {
    await expect(bar(page)).toHaveAttribute('aria-label', 'Évaluation : +1.5');
    await expect(bar(page)).toContainText('+1.5');
    expect(Math.abs((await whiteHeight(page)) - 63)).toBeLessThanOrEqual(1);
  });

  test('AC-F4-2 : mat des noirs, barre entièrement noire', async ({ page }) => {
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowLeft');
    await expect(indicator(page)).toHaveText('Demi-coup 3 sur 4');
    await expect(bar(page)).toContainText('-M3');
    expect(await whiteHeight(page)).toBe(0);
  });

  test('AC-F4-3 : un clic sur la courbe déplace l’échiquier', async ({ page }) => {
    const svg = page.locator('.eval-graph svg');
    const box = (await svg.boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.5, box.y + 10);
    await expect(indicator(page)).toHaveText('Demi-coup 2 sur 4');
  });

  test('AC-F4-5 : libellé de la courbe et symboles des marqueurs', async ({ page }) => {
    await expect(
      page.getByRole('group', { name: 'Courbe d’évaluation, 5 positions' }),
    ).toBeVisible();
    const blunder = page.getByRole('button', { name: 'Gaffe : 2. g4' });
    await expect(blunder).toHaveText(/\?\?/);
    await expect(page.getByRole('button', { name: 'Erreur : 1. f3' })).toHaveText(/\?/);
    await blunder.focus();
    await page.keyboard.press('Enter');
    await expect(indicator(page)).toHaveText('Demi-coup 3 sur 4');
  });
});
