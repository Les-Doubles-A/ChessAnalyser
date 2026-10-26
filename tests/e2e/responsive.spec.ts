import { expect, test, type Page } from '@playwright/test';
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
