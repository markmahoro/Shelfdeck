'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, expect } = require('../../web/node_modules/@playwright/test');

async function open({ host, apiKey, scenario }) {
  const base = process.env.HELIX_SERIES_BROWSER_OUTPUT;
  const output = scenario && base ? path.join(base,scenario) : base;
  assert.ok(output && path.isAbsolute(output), 'Provide an absolute browser evidence directory.');
  fs.mkdirSync(output, { recursive: true });
  const address = await host.listen({ host: '127.0.0.1', port: 0 });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [], observations = [], seen = new Set();
  page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(15000);
  await page.goto(address + '/formation');
  await page.getByLabel('管理凭据', { exact: true }).fill(apiKey);
  await page.getByRole('button', { name: '进入管理台', exact: true }).click();
  let stopped = false, failure;
  async function capture(label) {
    const index = String(observations.length).padStart(2, '0');
    for (const [name, width, height] of [['desktop', 1920, 1080], ['narrow', 390, 844]]) {
      await page.setViewportSize({ width, height });
      if (label === 'committed-collection') await page.getByRole('region', { name: '已收藏剧集' }).scrollIntoViewIfNeeded();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
      await page.screenshot({ path: path.join(output, index + '-' + name + '.png'), fullPage: true });
      const active=page.locator('.formation-plan-node[data-state="running"], .formation-plan-node[data-state="failed"]').first();
      if(await active.count()){
        await active.scrollIntoViewIfNeeded();
        await page.screenshot({path:path.join(output,index+'-'+name+'-step.png'),fullPage:true});
      }
    }
    await page.setViewportSize({ width: 1920, height: 1080 });
    observations.push({ label, text: await page.locator('body').innerText() });
    fs.writeFileSync(path.join(output, 'observations.json'), JSON.stringify(observations, null, 2));
  }
  const watching = (async () => {
    while (!stopped) {
      const current = page.locator('.formation-stub-current').first();
      if (await current.count()) {
        const label = await current.innerText();
        const activePlan=await page.locator('.formation-actual-plan[data-state="running"] > summary').allTextContents();
        const observationKey=label+JSON.stringify(activePlan);
        if (label && !seen.has(observationKey)) {
          seen.add(observationKey);
          if (!(await page.getByRole('dialog').count())) {
            const button = page.getByRole('button', { name: '查看过程', exact: true }).first();
            if (await button.count()) {
              await button.focus();await page.keyboard.press('Enter');
              await expect(page.getByRole('dialog')).toBeVisible();
              await page.keyboard.press('Escape');
              await expect(page.getByRole('dialog')).toHaveCount(0);
              await expect(button).toBeFocused();
              await page.keyboard.press('Enter');
            }
          }
          await expect(page.getByRole('dialog').getByText(label,{exact:true}).first()).toBeVisible();
          assert.equal(await page.getByRole('columnheader').count(),9);
          await expect(page.getByRole('dialog')).toContainText('本批 2 集（E01、E02）');
          await capture(label);
        }
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  })().catch(error => { failure = error; });
  return {
    async finish({ failed, entry }) {
      stopped = true;
      await watching;
      assert.ifError(failure);
      await page.keyboard.press('Escape');
      await page.goto(address + (failed ? '/formation' : '/collection'));
      if (failed) {
        await expect(page.getByRole('button', { name: '放弃整理', exact: true })).toBeVisible();
        if(scenario==='technical')await expect(page.getByText('视频处理失败，无法接受瑕疵。',{exact:true})).toBeVisible();
        await expect(page.getByText('当前成品有不可豁免的安全或身份问题。',{exact:true})).toHaveCount(0);
        await expect(page.getByRole('button',{name:/^重试(?:验收|上架)$/})).toHaveCount(0);
        await page.getByRole('button', { name: '查看过程', exact: true }).first().click();
        await expect(page.getByRole('dialog')).toBeVisible();
        if(scenario==='technical')await expect(page.getByRole('dialog')).toContainText('视频处理工具执行失败');
      } else {
        const tile = page.getByRole('button', { name: /查看.*详情.*第 1 季/ });
        await expect(tile).toBeVisible();
        await tile.click();
        await expect(page.getByRole('heading', { name: '第 1 季 · 已收藏 2 集', exact: true })).toBeVisible();
        const episodes=page.getByRole('region',{name:'已收藏剧集'});
        await expect(episodes.getByText(entry.series.physicalFileCount+' 个视频文件',{exact:true})).toBeVisible();
        for(const episode of entry.series.episodes)for(const file of episode.files)
          await expect(episodes.getByText(file.name,{exact:true}).first()).toBeVisible();
        await episodes.scrollIntoViewIfNeeded();
      }
      await capture(failed ? 'terminal-failure' : 'committed-collection');
      assert.ok(observations.length > (failed ? 0 : 1), 'Observe the actual terminal UI and the successful path in progress.');
      assert.deepEqual(errors, []);
    },
    async discard(checkSource) {
      await page.keyboard.press('Escape');
      const button=page.getByRole('button',{name:'放弃整理',exact:true});
      await button.click();
      const dialog=page.getByRole('dialog',{name:'确认放弃整理',exact:true});
      await expect(dialog).toContainText('原始媒体不会被删除');
      await dialog.getByRole('button',{name:'取消',exact:true}).click();
      await expect(dialog).toHaveCount(0);checkSource(false);
      await button.click();
      const response=page.waitForResponse(value=>value.request().method()==='POST'&&value.url().includes('/actions/discard'));
      await dialog.getByRole('button',{name:'确认放弃',exact:true}).click();
      const result=await response;assert.ok(result.ok());assert.equal((await result.json()).resultKind,'discarded');
      await expect(dialog).toHaveCount(0);
      await expect(page.getByText('本次整理已结束。',{exact:true})).toBeVisible();
      checkSource(true);await capture('discarded-source-preserved');
    },
    async close() {
      stopped = true;
      await watching;
      try { await page.screenshot({ path: path.join(output, 'last-state.png'), fullPage: true }); }
      finally { await browser.close(); }
    },
  };
}

module.exports = { open };
