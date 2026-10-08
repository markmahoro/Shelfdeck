'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, expect } = require('../../web/node_modules/@playwright/test');

async function open({ host, apiKey }) {
  const output = process.env.HELIX_SERIES_BROWSER_OUTPUT;
  assert.ok(output && path.isAbsolute(output), 'Provide an absolute browser evidence directory.');
  fs.mkdirSync(output, { recursive: true });
  const address = await host.listen({ host: '127.0.0.1', port: 0 });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(15000);
  const screenshot = name => page.screenshot({ path: path.join(output, name + '.png'), fullPage: true });
  return {
    async registerSource(rootLocation) {
      await page.goto(address + '/material-fields');
      await page.getByLabel('管理凭据', { exact: true }).fill(apiKey);
      await page.getByRole('button', { name: '进入管理台', exact: true }).click();
      await page.getByLabel('媒体类型').selectOption('series');
      await page.getByLabel('来源名称').fill('Series fixture');
      await page.getByLabel('媒体目录').fill(rootLocation);
      const registration = page.waitForResponse(response => response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/v1/admin/material-fields');
      await page.getByRole('button', { name: '保存文件来源' }).click();
      const response = await registration;
      assert.ok(response.ok(), await response.text());
      const input = response.request().postDataJSON();
      assert.equal(input.contentProfileHint, 'series');
      await expect(page.getByRole('heading', { name: 'Series fixture', exact: true })).toBeVisible();
      await screenshot('source-registered');
      return input.fieldId;
    },
    async createShelf(targetRootLocation, ruleTemplateId) {
      await page.goto(address + '/shelves');
      await page.getByRole('button', { name: /自动清理残留文件/ }).click();
      const authorization = page.getByRole('dialog', { name: '自动清理残留文件', exact: true });
      await expect(authorization.getByText('共享、未知及范围外文件', { exact: true })).toBeVisible();
      await expect(authorization.getByText('此授权不包含退出收藏时销毁文件。', { exact: true })).toBeVisible();
      await screenshot('settlement-authorization');
      await authorization.getByRole('button', { name: '授权自动清理', exact: true }).click();
      await expect(authorization).toHaveCount(0);
      await expect(page.getByRole('button', { name: /自动清理残留文件/ })).toContainText('已授权');
      await expect(page.getByRole('heading', { name: '创建收藏架', exact: true })).toBeVisible();
      await page.getByLabel('收藏架名称', { exact: true }).fill('Series fixture');
      await screenshot('shelf-empty-form');
      await page.getByRole('combobox', { name: '规则模板', exact: true }).selectOption(ruleTemplateId);
      await page.getByRole('button', { name: '复制模板', exact: true }).click();
      const standard = page.getByRole('dialog', { name: '复制并发布自己的整理标准', exact: true });
      await standard.getByLabel('媒体类型').selectOption('series');
      await standard.getByLabel('每集空间上限 GiB', { exact: true }).first().fill('0.5');
      await standard.getByRole('button', { name: '预览影响', exact: true }).click();
      await expect(standard.getByRole('button', { name: '发布整理标准', exact: true })).toBeEnabled();
      await screenshot('series-standard-preview');
      const publication = page.waitForResponse(response => response.request().method() === 'POST' &&
        response.url().endsWith('/actions/publish'));
      await standard.getByRole('button', { name: '发布整理标准', exact: true }).click();
      const published = await publication;
      assert.ok(published.ok(), await published.text());
      await expect(standard).toHaveCount(0);
      await expect(page.getByRole('region', { name: '剧集整理标准' })).toContainText('每集 · 最多 0.5 GiB');

      await page.getByLabel('收藏最终目录', { exact: true }).fill(targetRootLocation);
      await page.getByLabel('目录命名', { exact: true }).fill('{title}');
      await page.getByLabel('命名示例').selectOption('series_shared');
      await expect(page.getByLabel('最终命名保存前预览')).toContainText('Season 01');
      await screenshot('shelf-create');
      const creation = page.waitForResponse(response => response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/v1/admin/shelves');
      await page.getByRole('button', { name: '创建收藏架', exact: true }).click();
      const response = await creation;
      assert.ok(response.ok(), await response.text());
      const input = response.request().postDataJSON();
      assert.equal(input.ruleTemplateId, ruleTemplateId);
      await expect(page.getByRole('heading', { name: 'Series fixture', exact: true })).toBeVisible();
      await screenshot('shelf-created');
      return input.shelfId;
    },
    async routeAndScan() {
      await page.goto(address + '/material-fields');
      await page.getByText('收藏架分拣策略', { exact: true }).click();
      await page.getByRole('combobox', { name: '模式', exact: true }).selectOption('sorting');
      await page.getByLabel('事实类型').selectOption('release_year');
      await page.getByLabel('比较方式').selectOption('gte');
      await page.getByLabel('年份', { exact: true }).fill('2020');
      await page.getByRole('button', { name: '发布策略', exact: true }).click();
      await expect(page.locator('.routing-policy-panel').getByRole('status')).toContainText('分拣策略已发布');
      await screenshot('source-routing');
      const observation = page.waitForResponse(response => response.request().method() === 'POST' &&
        response.url().endsWith('/actions/observe'));
      await page.getByRole('button', { name: '扫描新文件', exact: true }).click();
      const response = await observation;
      assert.ok(response.ok(), await response.text());
    },
    async scanNextBatch() {
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.goto(address + '/material-fields');
      const observation = page.waitForResponse(response => response.request().method() === 'POST' &&
        response.url().endsWith('/actions/observe'));
      await page.getByRole('button', { name: '扫描新文件', exact: true }).click();
      const response = await observation;
      assert.ok(response.ok(), await response.text());
      await screenshot('append-source-scan');
    },
    async chooseIdentity(prefix = '') {
      await page.goto(address + '/formation');
      const button = page.getByRole('button', { name: '手动选取剧集身份', exact: true });
      await expect(button).toBeVisible();
      await screenshot(prefix + 'formation-attention');
      await button.click();
      const dialog = page.getByRole('dialog', { name: '手动选取剧集身份' });
      await expect(dialog.getByLabel('TMDB 剧集 ID')).toBeFocused();
      await dialog.getByLabel('TMDB 剧集 ID').fill('1399');
      await dialog.getByRole('button', { name: '查询', exact: true }).click();
      await expect(dialog.getByText('第 1 季', { exact: true })).toBeVisible();
      await expect(dialog.getByRole('button', { name: '确认选取' })).toBeEnabled();
      await screenshot(prefix + 'identity-preview-desktop');
      await page.setViewportSize({ width: 390, height: 844 });
      const bounds = await dialog.boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390);
      await screenshot(prefix + 'identity-preview-narrow');
      const responsePromise = page.waitForResponse(response => response.request().method() === 'POST' &&
        response.url().endsWith('/actions/choose-product-identity'));
      await dialog.getByRole('button', { name: '确认选取' }).click();
      const response = await responsePromise;
      assert.equal(response.status(), 202);
      const receipt = await response.json();
      assert.equal(receipt.namespace, 'tmdb_series');
      assert.equal(receipt.seasonNumber, 1);
      await expect(dialog).toHaveCount(0);
    },
    async verifyCollection(entry, prefix = '') {
      for (const [name, width, height] of [['desktop', 1920, 1080], ['narrow', 390, 844]]) {
        await page.setViewportSize({ width, height });
        await page.goto(address + '/collection');
        const tile = page.getByRole('button', { name: '查看 ' + entry.displayIdentity + ' 详情', exact: false });
        await expect(tile).toBeVisible();
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
        await screenshot(prefix + 'collection-page-' + name);
        const filter = page.locator('.collection-filter summary');
        await filter.click();
        await expect(page.getByRole('navigation', { name: '收藏健康筛选' })).toBeVisible();
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
        await screenshot(prefix + 'collection-filter-' + name);
        await filter.click();
        await tile.click();
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Collection page must fit the viewport.');
        const dialog = page.getByRole('dialog', { name: entry.displayIdentity, exact: true });
        const episodes = dialog.getByRole('region', { name: '已收藏剧集' });
        await expect(episodes.getByRole('heading', { name: '第 ' + entry.series.seasonNumber + ' 季 · 已收藏 ' + entry.series.episodeCount + ' 集' })).toBeVisible();
        await expect(episodes.getByText(entry.series.physicalFileCount + ' 个视频文件', { exact: true })).toBeVisible();
        for (const episode of entry.series.episodes) {
          for (const file of episode.files) await expect(episodes.getByText(file.name, { exact: true })).toBeVisible();
        }
        assert.ok(await episodes.evaluate(element => element.scrollWidth <= element.clientWidth));
        await episodes.scrollIntoViewIfNeeded();
        await screenshot(prefix + 'collection-' + name);
        await page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0);
        await expect(tile).toBeFocused();
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
        await tile.click();
        await dialog.getByRole('region', { name: '已收藏剧集' }).scrollIntoViewIfNeeded();
        await dialog.getByRole('button', { name: '关闭详情' }).click();
        await expect(dialog).toHaveCount(0);
        await expect(tile).toBeFocused();
      }
      assert.deepEqual(errors, []);
    },
    async close() {
      try { await screenshot('last-state'); } finally { await browser.close(); }
    },
  };
}

module.exports = { open };
