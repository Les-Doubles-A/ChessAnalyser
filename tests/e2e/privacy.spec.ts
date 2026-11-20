import { expect, test } from '@playwright/test';
import { FOOLS_MATE_PGN } from '../fixtures/chesscom';
import { foolsMateTable, mockEngine } from './fakeEngine';
import { mockChessCom, searchFor } from './helpers';

// AC-X-2 : pendant le parcours P1 (recherche, liste, analyse, synthèse), le navigateur ne
// contacte que le site lui-même et api.chess.com, et aucune règle CSP n'est enfreinte
// (la CSP n'existe que dans le build : voir playwright.build.config.ts).
test('AC-X-2 : aucune requête vers un tiers et aucune violation de CSP', async ({
  page,
  baseURL,
}) => {
  const allowed = new Set([new URL(baseURL!).origin, 'https://api.chess.com']);
  const foreign: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.protocol === 'data:' || url.protocol === 'blob:') return;
    if (!allowed.has(url.origin)) foreign.push(request.url());
  });
  await page.addInitScript(() => {
    const violations: string[] = [];
    (window as unknown as { cspViolations: string[] }).cspViolations = violations;
    document.addEventListener('securitypolicyviolation', (event) =>
      violations.push(`${event.violatedDirective} ${event.blockedURI}`),
    );
  });

  await mockEngine(page, foolsMateTable(FOOLS_MATE_PGN));
  await mockChessCom(page);
  await page.goto('/');
  await searchFor(page, 'testeur');
  await page.getByRole('button', { name: /pressé/ }).click();
  await expect(page.getByText(/^Analyse terminée/)).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('heading', { name: 'Synthèse' })).toBeVisible();
  await expect(page.locator('.opening')).not.toHaveText('Ouverture : …');
  await page.getByRole('button', { name: 'Suivant' }).click();

  expect(foreign).toEqual([]);
  expect(
    await page.evaluate(() => (window as unknown as { cspViolations: string[] }).cspViolations),
  ).toEqual([]);
});
