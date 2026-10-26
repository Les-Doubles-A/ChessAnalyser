import { expect, test } from '@playwright/test';
import { ARCHIVES_URL } from '../fixtures/chesscom';
import { mockChessCom, searchFor } from './helpers';

test.describe('Recherche et liste des parties (F1)', () => {
  test('AC-F1-1 : liste triée avec les informations de chaque partie', async ({ page }) => {
    await mockChessCom(page);
    await page.goto('/');
    await searchFor(page, '  Testeur ');

    await expect(page.getByRole('heading', { name: 'Parties de testeur' })).toBeVisible();
    const games = page.getByRole('button', { name: /^Partie du/ });
    await expect(games).toHaveCount(3);
    await expect(games.nth(0)).toHaveAccessibleName(
      'Partie du 20/10/2026, noirs contre morphy_fan (1650), rapide, défaite, 17 coups',
    );
    await expect(games.nth(1)).toHaveAccessibleName(
      'Partie du 18/10/2026, noirs contre pressé (820), blitz, victoire, 2 coups',
    );
    await expect(games.nth(2)).toHaveAccessibleName(
      'Partie du 15/10/2026, blancs contre prudent (1560), bullet, nulle, 4 coups',
    );
  });

  test('AC-F1-2 : pseudo inconnu', async ({ page }) => {
    await mockChessCom(page, {
      [ARCHIVES_URL]: [{ status: 404, body: { code: 0, message: 'User "testeur" not found.' } }],
    });
    await page.goto('/');
    await searchFor(page, 'testeur');

    await expect(
      page.getByText('Aucun joueur chess.com ne porte le pseudo « testeur ».'),
    ).toBeVisible();
    const input = page.getByLabel('Pseudo chess.com');
    await expect(input).toHaveValue('testeur');
    await expect(input).toBeFocused();
  });

  test('AC-F1-3 : pseudo invalide, aucune requête', async ({ page }) => {
    const calls = await mockChessCom(page);
    await page.goto('/');
    for (const value of ['', 'ab', 'jean dupont', 'a'.repeat(26), 'pseudo?']) {
      await searchFor(page, value);
      await expect(page.getByText(/^Pseudo invalide/)).toBeVisible();
    }
    expect(calls).toEqual([]);
  });

  test('AC-F1-4 : erreur serveur puis réessai', async ({ page }) => {
    await mockChessCom(page, {
      [ARCHIVES_URL]: [{ status: 503 }, { status: 200, body: { archives: [] } }],
    });
    await page.goto('/');
    await searchFor(page, 'testeur');

    await expect(page.getByText('chess.com ne répond pas.')).toBeVisible();
    await page.getByRole('button', { name: 'Réessayer' }).click();
    await expect(page.getByText('Aucune partie publique trouvée.')).toBeVisible();
  });

  test('AC-F1-4 : deux 429 consécutifs affichent le message', async ({ page }) => {
    const calls = await mockChessCom(page, { [ARCHIVES_URL]: [{ status: 429 }] });
    await page.goto('/');
    await searchFor(page, 'testeur');

    await expect(page.getByText('chess.com ne répond pas.')).toBeVisible({ timeout: 6000 });
    expect(calls).toEqual([ARCHIVES_URL, ARCHIVES_URL]);
  });

  test('AC-F1-5 : joueur sans partie', async ({ page }) => {
    await mockChessCom(page, { [ARCHIVES_URL]: [{ status: 200, body: { archives: [] } }] });
    await page.goto('/');
    await searchFor(page, 'testeur');
    await expect(page.getByText('Aucune partie publique trouvée.')).toBeVisible();
  });

  test('AC-F1-6 : variante grisée et non ouvrable', async ({ page }) => {
    await mockChessCom(page);
    await page.goto('/');
    await searchFor(page, 'testeur');

    const variant = page.locator('.game-row.is-disabled');
    await expect(variant).toContainText('Variante non prise en charge');
    await expect(variant).toContainText('fischer960');
    await expect(page.getByRole('button', { name: /fischer960/ })).toHaveCount(0);
  });

  test('filtre par cadence et mois précédent', async ({ page }) => {
    await mockChessCom(page);
    await page.goto('/');
    await searchFor(page, 'testeur');

    await page.getByLabel('Cadence').selectOption('blitz');
    await expect(page.getByRole('button', { name: /^Partie du/ })).toHaveCount(1);
    await page.getByLabel('Cadence').selectOption('all');

    await page.getByRole('button', { name: 'Mois précédent' }).click();
    await expect(page.getByRole('button', { name: /cassé/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Mois précédent' })).toHaveCount(0);
  });

  test('le dernier pseudo est mémorisé', async ({ page }) => {
    await mockChessCom(page);
    await page.goto('/');
    await searchFor(page, 'Testeur');
    await expect(page.getByRole('heading', { name: 'Parties de testeur' })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Pseudo chess.com')).toHaveValue('testeur');
  });

  test('AC-X-1 : mention de non-affiliation', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('contentinfo')).toHaveText(
      'Projet indépendant, non affilié à Chess.com',
    );
  });
});
