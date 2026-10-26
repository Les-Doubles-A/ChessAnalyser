import { expect, test, type Page } from '@playwright/test';
import { FOOLS_MATE_PGN } from '../fixtures/chesscom';
import { foolsMateTable, mockEngine } from './fakeEngine';
import { mockChessCom, searchFor } from './helpers';

async function openFoolsMate(page: Page) {
  await mockEngine(page, foolsMateTable(FOOLS_MATE_PGN));
  await mockChessCom(page);
  await page.goto('/');
  await searchFor(page, 'testeur');
  await page.getByRole('button', { name: /pressé/ }).click();
  await expect(page.getByText(/^Analyse terminée/)).toBeVisible({ timeout: 15000 });
}

const indicator = (page: Page) => page.locator('.position-indicator');
const variation = (page: Page) => page.getByRole('region', { name: /^Variante/ });
const square = (page: Page, name: string) => page.locator(`#analysis-board-square-${name}`);

test.describe('Variantes (F10), faux moteur', () => {
  test.beforeEach(async ({ page }) => {
    await openFoolsMate(page);
  });

  test('essayer le meilleur coup à la place d’une gaffe', async ({ page }) => {
    await page.getByRole('button', { name: '2. g4, gaffe' }).click();
    await page.locator('.move-panel').getByRole('button', { name: 'Essayer e4' }).click();

    await expect(variation(page)).toHaveAccessibleName('Variante après 1... e5');
    await expect(page.getByRole('button', { name: 'Variante 2. e4' })).toHaveAttribute(
      'aria-current',
      'step',
    );
    await expect(indicator(page)).toHaveText('Variante : demi-coup 1 sur 1');
    await expect(page.getByRole('button', { name: 'Explorer des variantes' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // Le faux moteur donne 0.0 aux positions inconnues : la variante est évaluée.
    await expect(variation(page).locator('.variation-eval')).toHaveText(/^Évaluation : 0\.0/);
    await expect(page.locator('.eval-bar')).toHaveAttribute('aria-label', 'Évaluation : 0.0');
    // La partie reste repérée sur le coup d'où part la variante.
    await expect(page.locator('.move-list [aria-current="step"]')).toHaveText(/e5/);

    await variation(page).getByRole('button', { name: 'Revenir à la partie' }).click();
    await expect(variation(page)).toHaveCount(0);
    await expect(indicator(page)).toHaveText('Demi-coup 2 sur 4');
  });

  test('saisie au clavier, notation française, erreurs et navigation', async ({ page }) => {
    await page.getByRole('button', { name: 'Explorer des variantes' }).click();
    const field = page.getByLabel('Jouer un coup');

    // Le coup de la partie fait simplement avancer.
    await field.fill('f3');
    await field.press('Enter');
    await expect(indicator(page)).toHaveText('Demi-coup 1 sur 4');
    await expect(variation(page)).toHaveCount(0);

    await field.fill('Cc6');
    await field.press('Enter');
    await expect(indicator(page)).toHaveText('Variante : demi-coup 1 sur 1');
    await expect(page.getByRole('button', { name: 'Variante 1... Nc6' })).toBeVisible();

    await field.fill('bonjour');
    await field.press('Enter');
    await expect(page.locator('#explore-message')).toHaveText(
      'Coup impossible dans cette position : « bonjour ».',
    );
    await expect(field).toHaveValue('bonjour');

    await field.fill('e4');
    await field.press('Enter');
    await expect(indicator(page)).toHaveText('Variante : demi-coup 2 sur 2');
    await expect(page.locator('#explore-message')).toHaveText('');

    // Flèches dans la variante, Échap pour revenir à la partie.
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('ArrowLeft');
    await expect(indicator(page)).toHaveText('Variante : demi-coup 1 sur 2');
    await page.keyboard.press('Escape');
    await expect(indicator(page)).toHaveText('Demi-coup 1 sur 4');
  });

  test('coup du moteur et flèche du coup conseillé', async ({ page }) => {
    await page.getByRole('button', { name: 'Explorer des variantes' }).click();
    // Position de départ : le faux moteur conseille e2e4.
    const best = page.getByRole('button', { name: 'Coup du moteur (e4)' });
    await best.click();
    await expect(page.getByRole('button', { name: 'Variante 1. e4' })).toBeVisible();
    // Position inconnue du faux moteur : il répond a2a3, illégal pour les noirs, donc ni
    // flèche ni bouton actif.
    await expect(variation(page).locator('.variation-eval')).toHaveText(/^Évaluation : 0\.0/);
    const arrowheads = page.locator('[id^="analysis-board-arrowhead-"]');
    await expect(arrowheads).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Coup du moteur' })).toBeDisabled();

    // Départ de la variante : position connue, flèche e2-e4.
    await page.getByRole('button', { name: 'Départ' }).click();
    await expect(page.locator('[id^="analysis-board-arrowhead-"][id$="-e2-e4"]')).toHaveCount(1);
  });

  test('clic sur la pièce puis sur la case, et glisser-déposer', async ({ page }) => {
    await page.getByRole('button', { name: 'Explorer des variantes' }).click();
    await expect(page.locator('.board [inert]')).toHaveCount(0);

    await square(page, 'g1').click();
    await square(page, 'f3').click();
    await expect(page.getByRole('button', { name: 'Variante 1. Nf3' })).toBeVisible();

    await square(page, 'd7').hover();
    await page.mouse.down();
    await square(page, 'd5').hover({ position: { x: 10, y: 10 } });
    await square(page, 'd5').hover();
    await page.mouse.up();
    await expect(page.getByRole('button', { name: 'Variante 1... d5' })).toBeVisible();

    // Une pièce adverse ne se sélectionne pas : rien ne bouge.
    await square(page, 'e7').click();
    await square(page, 'e5').click();
    await expect(indicator(page)).toHaveText('Variante : demi-coup 2 sur 2');
  });

  test('l’échiquier reste non interactif hors exploration', async ({ page }) => {
    await expect(page.locator('.board [inert]')).toHaveCount(1);
    await expect(page.getByLabel('Jouer un coup')).toHaveCount(0);
  });
});
