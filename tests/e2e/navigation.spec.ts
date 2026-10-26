import { expect, test, type Page } from '@playwright/test';
import { mockChessCom, searchFor } from './helpers';

async function openGame(page: Page, opponent: RegExp) {
  await mockChessCom(page);
  await page.goto('/');
  await searchFor(page, 'testeur');
  await page.getByRole('button', { name: opponent }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('contre');
}

const square = (page: Page, id: string) => page.locator(`[data-square="${id}"]`);

async function centerY(page: Page, id: string) {
  const box = await square(page, id).boundingBox();
  if (!box) throw new Error(`case ${id} introuvable`);
  return box.y + box.height / 2;
}

test.describe('Échiquier et navigation (F2)', () => {
  test('AC-F2-1 : orientation côté noirs et position de départ', async ({ page }) => {
    await openGame(page, /morphy_fan/);

    expect(await centerY(page, 'a1')).toBeLessThan(await centerY(page, 'a8'));
    await expect(square(page, 'e2').locator('[data-piece]')).toHaveCount(1);
    await expect(square(page, 'e4').locator('[data-piece]')).toHaveCount(0);
    await expect(page.getByRole('img', { name: 'Échiquier, position de départ' })).toBeVisible();
  });

  test('orientation côté blancs quand le joueur avait les blancs', async ({ page }) => {
    await openGame(page, /prudent/);
    expect(await centerY(page, 'a8')).toBeLessThan(await centerY(page, 'a1'));
  });

  test('AC-F2-2 : flèches du clavier et bornes', async ({ page }) => {
    await openGame(page, /pressé/);
    const indicator = page.locator('.position-indicator');

    await page.keyboard.press('ArrowLeft');
    await expect(indicator).toHaveText('Position de départ');

    await page.keyboard.press('ArrowRight');
    await expect(indicator).toHaveText('Demi-coup 1 sur 4');
    await expect(square(page, 'f3').locator('[data-piece]')).toHaveCount(1);

    await page.keyboard.press('End');
    await expect(indicator).toHaveText('Demi-coup 4 sur 4');
    await page.keyboard.press('ArrowRight');
    await expect(indicator).toHaveText('Demi-coup 4 sur 4');

    await page.keyboard.press('ArrowLeft');
    await expect(indicator).toHaveText('Demi-coup 3 sur 4');
    await page.keyboard.press('Home');
    await expect(indicator).toHaveText('Position de départ');

    await page.getByRole('button', { name: 'Fin' }).click();
    await expect(
      page.getByRole('img', { name: 'Échiquier, position après 2... Qh4#' }),
    ).toBeVisible();
  });

  test('AC-F2-3 : clic sur un coup de la liste', async ({ page }) => {
    await openGame(page, /morphy_fan/);
    const move = page.getByRole('button', { name: '12... Rd8' });
    await move.click();

    await expect(move).toHaveAttribute('aria-current', 'step');
    await expect(page.locator('.move[aria-current="step"]')).toHaveCount(1);
    await expect(
      page.getByRole('img', { name: 'Échiquier, position après 12... Rd8' }),
    ).toBeVisible();
    await expect(page.locator('.position-indicator')).toHaveText('Demi-coup 24 sur 33');
    // La bibliothèque applique squareStyles au div intérieur de la case.
    for (const id of ['a8', 'd8']) {
      await expect(square(page, id).locator(':scope > div')).toHaveAttribute(
        'style',
        /rgba\(240, 190, 70/,
      );
    }
    await expect(square(page, 'e7').locator(':scope > div')).not.toHaveAttribute(
      'style',
      /rgba\(240, 190, 70/,
    );
  });

  test('AC-F2-4 : partie illisible', async ({ page }) => {
    await mockChessCom(page);
    await page.goto('/');
    await searchFor(page, 'testeur');
    await page.getByRole('button', { name: 'Mois précédent' }).click();
    await page.getByRole('button', { name: /cassé/ }).click();

    await expect(page.getByRole('alert')).toHaveText('Cette partie n’a pas pu être lue.');
    await page.getByRole('button', { name: 'Retour à la liste' }).click();
    await expect(page.getByRole('heading', { name: 'Parties de testeur' })).toBeVisible();
  });

  test('AC-F2-5 : contrôles atteignables au clavier avec focus visible', async ({ page }) => {
    await openGame(page, /pressé/);
    const names = ['Début', 'Précédent', 'Suivant', 'Fin'];
    for (const name of names) {
      const button = page.getByRole('button', { name, exact: true });
      await expect(button).toBeVisible();
    }

    await page.getByRole('button', { name: 'Retour à la liste' }).focus();
    const reached: string[] = [];
    for (let i = 0; i < 12 && reached.length < names.length; i++) {
      await page.keyboard.press('Tab');
      const name = await page.evaluate(() => document.activeElement?.textContent ?? '');
      if (names.includes(name)) {
        reached.push(name);
        const outline = await page.evaluate(
          () => getComputedStyle(document.activeElement as Element).outlineStyle,
        );
        expect(outline).not.toBe('none');
      }
    }
    expect(reached).toEqual(names);
    expect(await page.locator('.board [tabindex="0"]').count()).toBeGreaterThan(0);
    expect(await page.evaluate(() => document.querySelector('.board [inert]') !== null)).toBe(true);

    await page.keyboard.press('Enter');
    await expect(page.locator('.position-indicator')).toHaveText('Demi-coup 4 sur 4');
  });

  test('retour à la liste conserve la recherche', async ({ page }) => {
    await openGame(page, /pressé/);
    await page.getByRole('button', { name: 'Retour à la liste' }).click();
    await expect(page.getByRole('button', { name: /^Partie du/ })).toHaveCount(3);
    await expect(page.getByLabel('Pseudo chess.com')).toHaveValue('testeur');
  });

  test('AC-X-1 : mention présente sur la vue de partie', async ({ page }) => {
    await openGame(page, /pressé/);
    await expect(page.getByRole('contentinfo')).toHaveText(
      'Projet indépendant, non affilié à Chess.com',
    );
  });
});
