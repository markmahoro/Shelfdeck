import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const runRoot = path.resolve(process.env.SHELFDECK_PEOPLE_E2E_ROOT || '');
const evidenceRoot = path.join(runRoot, 'evidence');

async function signIn(page: import('@playwright/test').Page) {
  const runtime = JSON.parse(fs.readFileSync(path.join(runRoot, 'private-runtime.json'), 'utf8'));
  await page.goto('/people');
  await expect(page.getByRole('heading', { name: '进入管理台' })).toBeVisible();
  await page.getByLabel('管理凭据').fill(runtime.adminApiKey);
  await page.getByRole('button', { name: '进入管理台' }).click();
  await expect(page.getByRole('heading', { name: '人物', exact: true })).toBeVisible();
}

test('registered People render as an accessible portrait contact sheet', async ({ page }, testInfo) => {
  await signIn(page);
  const cards = page.getByRole('article', { name: /已登记/ });
  await expect(cards).toHaveCount(16);
  await expect(page.getByText('TMDB · 80000')).toBeVisible();
  const firstImage = page.getByRole('img', { name: 'Qualification Person 01头像' });
  await expect(firstImage).toBeVisible();
  await expect.poll(() => firstImage.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  await expect(cards.filter({ hasText: 'Qualification Person 16' }).getByText('使用姓名首字头像')).toBeAttached();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact || ''))).toEqual([]);
  if (testInfo.project.name === 'narrow') {
    const widths = await page.locator('.people-contact-sheet, .people-card').evaluateAll((elements) =>
      elements.slice(0, 2).map((element) => element.getBoundingClientRect().width));
    expect(Math.abs(widths[0] - widths[1])).toBeLessThan(2);
  }
  await page.screenshot({
    path: path.join(evidenceRoot, testInfo.project.name === 'narrow' ? 'people-narrow-390.png' : 'people-desktop.png'),
    fullPage: true,
  });
});
