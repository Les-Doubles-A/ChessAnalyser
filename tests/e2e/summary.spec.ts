import { expect, test, type Page } from '@playwright/test';
import { FOOLS_MATE_PGN } from '../fixtures/chesscom';
import { foolsMateTable, mockEngine } from './fakeEngine';
import { mockChessCom, searchFor } from './helpers';

async function openGame(page: Page, opponent: RegExp) {
  await mockChessCom(page);
  await page.goto('/');
  await searchFor(page, 'testeur');
  await page.getByRole('button', { name: opponent }).click();
}

const summary = (page: Page) => page.getByRole('region', { name: 'Synthèse' });
const indicator = (page: Page) => page.locator('.position-indicator');

test.describe('Synthèse de la partie (F7), faux moteur', () => {
  test('compteurs, ouverture et moments clés du mat du lion', async ({ page }) => {
    await mockEngine(page, foolsMateTable(FOOLS_MATE_PGN));
    await openGame(page, /pressé/);
    await expect(page.getByText(/^Analyse terminée/)).toBeVisible({ timeout: 15000 });

    await expect(summary(page).locator('.opening')).toHaveText(/^Ouverture : A0\d · /);
    const row = (name: string) => summary(page).getByRole('row', { name: new RegExp(name) });
    await expect(row('Erreur')).toHaveText(/Erreur10$/);
    await expect(row('Gaffe')).toHaveText(/Gaffe10$/);
    await expect(row('Livre')).toHaveText(/Livre02$/);
    await expect(summary(page).getByRole('row', { name: /Non analysé/ })).toHaveCount(0);

    // AC-F7-3 : ordre chronologique, clic qui affiche la position.
    const moments = summary(page).locator('.key-moments button');
    await expect(moments).toHaveCount(2);
    await expect(moments.nth(0)).toHaveAccessibleName('Erreur au coup 1. f3, meilleur coup e4');
    await expect(moments.nth(1)).toHaveAccessibleName('Gaffe au coup 2. g4, meilleur coup e4');
    await moments.nth(1).click();
    await expect(indicator(page)).toHaveText('Demi-coup 3 sur 4');
    await moments.nth(0).focus();
    await page.keyboard.press('Enter');
    await expect(indicator(page)).toHaveText('Demi-coup 1 sur 4');
  });

  test('AC-F7-4 : lien vers la partie sur chess.com', async ({ page }) => {
    await mockEngine(page, foolsMateTable(FOOLS_MATE_PGN));
    await openGame(page, /pressé/);
    const link = summary(page).getByRole('link', { name: 'Voir sur chess.com' });
    await expect(link).toHaveAttribute('href', 'https://www.chess.com/game/live/1000000002');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  test('AC-F7-3 : « Aucune erreur majeure »', async ({ page }) => {
    await mockEngine(page, {}); // toutes les positions à 0.0
    await openGame(page, /prudent/);
    await expect(page.getByText(/^Analyse terminée/)).toBeVisible({ timeout: 15000 });
    await expect(summary(page)).toContainText('Aucune erreur majeure');
    await expect(summary(page).locator('.key-moments')).toHaveCount(0);
  });

  test('E4 : attente pendant l’analyse, puis synthèse partielle après annulation', async ({
    page,
  }) => {
    await mockEngine(page, foolsMateTable(FOOLS_MATE_PGN), { delayMs: 700 });
    await openGame(page, /pressé/);
    await expect(summary(page)).toContainText('Disponible à la fin de l’analyse');
    await expect(summary(page).getByRole('table')).toHaveCount(0);

    await expect(page.getByText(/Analyse : [1-3] \/ 5 positions/)).toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: 'Annuler' }).click();
    await expect(summary(page)).toContainText('Analyse incomplète : synthèse partielle');
    await expect(summary(page).getByRole('row', { name: /Non analysé/ })).toBeVisible();
  });
});
