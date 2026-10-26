import { expect, test, type Page } from '@playwright/test';
import { FOOLS_MATE_PGN } from '../fixtures/chesscom';
import { foolsMateTable, mockEngine } from './fakeEngine';
import { mockChessCom, searchFor } from './helpers';

async function openAnalysed(page: Page, opponent: RegExp) {
  await mockChessCom(page);
  await page.goto('/');
  await searchFor(page, 'testeur');
  await page.getByRole('button', { name: opponent }).click();
  await expect(page.getByText(/^Analyse terminée/)).toBeVisible({ timeout: 90000 });
}

test.describe('Classification et meilleur coup (F5), faux moteur', () => {
  test.beforeEach(async ({ page }) => {
    await mockEngine(page, foolsMateTable(FOOLS_MATE_PGN));
    await openAnalysed(page, /pressé/);
  });

  test('AC-F5-6 : catégories nommées en texte et symbolisées', async ({ page }) => {
    await expect(page.getByRole('button', { name: '1. f3, erreur' })).toContainText('f3?');
    await expect(page.getByRole('button', { name: '1... e5, livre' })).toContainText('e5L');
    await expect(page.getByRole('button', { name: '2. g4, gaffe' })).toContainText('g4??');
    await expect(page.getByRole('button', { name: '2... Qh4#, livre' })).toBeVisible();
  });

  test('AC-F5-4 : gaffe affichée avec le meilleur coup et une flèche', async ({ page }) => {
    await page.getByRole('button', { name: '2. g4, gaffe' }).click();
    const panel = page.locator('.move-panel');
    await expect(panel).toContainText('Gaffe');
    await expect(panel).toContainText('2. g4');
    await expect(panel).toContainText('Meilleur coup : e4');
    await expect(panel).toContainText('Évaluation avant : -0.6 · après : -M3');
    await expect(page.locator('[id^="analysis-board-arrowhead-"][id$="-e2-e4"]')).toHaveCount(1);

    await page.getByRole('button', { name: '1... e5, livre' }).click();
    await expect(panel).not.toContainText('Meilleur coup :');
    await expect(page.locator('[id^="analysis-board-arrowhead-"]')).toHaveCount(0);
  });

  test('AC-F5-5 : précision des deux joueurs avec une décimale', async ({ page }) => {
    await expect(page.locator('.accuracy')).toHaveText(
      /^Précision : Blancs \d{1,3},\d · Noirs \d{1,3},\d$/,
    );
  });
});

test.describe('Vrai moteur Stockfish dans le navigateur', () => {
  test('mat du lion : 2. g4 est une gaffe malgré la base d’ouvertures', async ({ page }) => {
    await openAnalysed(page, /pressé/);
    await expect(page.getByRole('button', { name: '2. g4, gaffe' })).toBeVisible();
    await expect(page.getByRole('button', { name: '2... Qh4#, livre' })).toBeVisible();
    await page.keyboard.press('End');
    await expect(page.locator('.eval-bar')).toHaveAttribute('aria-label', 'Évaluation : Mat');
  });

  test('partie de l’Opéra : analyse complète et précision affichée', async ({ page }) => {
    test.setTimeout(120000);
    await openAnalysed(page, /morphy_fan/);
    await expect(page.locator('.accuracy')).toHaveText(/^Précision : Blancs \d/);
    await expect(page.getByRole('button', { name: /^1\. e4, livre$/ })).toBeVisible();
  });
});
