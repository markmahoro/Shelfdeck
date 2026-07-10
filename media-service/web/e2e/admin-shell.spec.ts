import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const pages = [
  ['概览', '/'], ['媒体库', '/libraries'], ['媒体', '/media'], ['演员', '/people'],
  ['任务中心', '/tasks'], ['清理建议', '/cleanup'], ['管理策略', '/policies'], ['系统设置', '/settings'],
] as const;

test('eight product pages are reachable with no legacy navigation', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '概览' })).toBeVisible();
  for (const [label, route] of pages.slice(1)) {
    if (await page.getByRole('button', { name: '打开导航' }).isVisible()) await page.getByRole('button', { name: '打开导航' }).click();
    await page.getByRole('link', { name: label, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${route.replace('/', '\\/')}$`));
    await expect(page.getByRole('heading', { name: label, exact: true })).toBeVisible();
  }
  await expect(page.getByText('高级设置')).toHaveCount(0);
});

test('shell has no serious accessibility violations', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '概览', exact: true })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact || ''))).toEqual([]);
});
