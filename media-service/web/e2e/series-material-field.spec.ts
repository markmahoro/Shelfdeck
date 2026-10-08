import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';

test('registers Series from the source page with failure recovery and keyboard controls', async ({ page }, testInfo) => {
  let saved: any = null;
  const writes: any[] = [];
  let routing: any = null;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/v1/admin/material-fields' && route.request().method() === 'POST') {
      const body = route.request().postDataJSON(); writes.push(body);
      if (writes.length === 1) {
        await route.fulfill({ status: 409, json: { error: { code: 'ADMIN_FIELD_CONFLICT', message: '目录不可访问', correlationId: 'test' } } });
        return;
      }
      saved = { fieldId: body.fieldId, name: body.name, status: 'active', extractionPolicyId: body.policy.extractionPolicyId,
        extractionPolicyRevision: 1, currentAccessRevision: 1, currentObservationRevision: null,
        currentProfileHintSnapshot: { revision: 1, contentProfileHint: body.contentProfileHint },
        access: { ...body.access, endpointId: 'endpoint', mountScopeId: 'mount', mountScopeRevision: 1 }, policy: body.policy,
        procurementStatus: { stage: 'not_started', runCount: 0, activeRunCount: 0, sealedRunCount: 0,
          generatedPackageCount: 0, acceptedPackageCount: 0, waitingAcceptanceCount: 0, rejectedPackageCount: 0 } };
      await route.fulfill({ json: { materialField: saved } }); return;
    }
    if (path === '/v1/admin/material-fields') { await route.fulfill({ json: { items: saved ? [saved] : [] } }); return; }
    if (path.endsWith('/intake-admission')) {
      await route.fulfill({ json: { fieldId: saved.fieldId, predeckPipelineSeats: 3, policyRevision: 1, updatedAtMs: 1, pipelineTokensHeld: 0, pipelineSeatsFree: 3 } }); return;
    }
    if (route.request().method() === 'PATCH' && path.includes('/routing/')) {
      routing = route.request().postDataJSON().policy;
      await route.fulfill({ json: { policy: { ...routing, revision: 1 } } }); return;
    }
    if (path === '/v1/admin/shelves') { await route.fulfill({json:{items:[{shelfId:'series',name:'剧集架',status:'active'}]}}); return; }
    if (path.startsWith('/v1/admin/routing/material-fields/')) { await route.fulfill({ json: { policy: null, items: [] } }); return; }
    await route.fulfill({ json: { items: [], counts: {}, nextCursor: null, state: 'ready', completionState: 'complete' } });
  });
  await page.goto('/material-fields');
  const profile = page.getByLabel('媒体类型');
  await expect(profile).toHaveValue('movie');
  await profile.focus(); await profile.press('ArrowDown'); await profile.press('Tab');
  await expect(profile).toHaveValue('series');
  await expect(page.getByLabel('来源名称')).toBeFocused();
  await page.getByLabel('来源名称').fill('我的剧集');
  await page.getByLabel('媒体目录').fill('/media/Series');
  await page.screenshot({ path: testInfo.outputPath('series-form.png'), fullPage: true });
  expect((await new AxeBuilder({ page }).include('.material-fields-page').analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: '保存文件来源' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(profile).toHaveValue('series');
  await expect(page.getByLabel('媒体目录')).toHaveValue('/media/Series');
  await page.getByRole('button', { name: '保存文件来源' }).click();
  await expect(page.getByRole('heading', { name: '我的剧集' })).toBeVisible();
  await expect(page.getByText('剧集', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '扫描新文件' })).toBeEnabled();
  expect(writes).toHaveLength(2); expect(writes[1]).toEqual(writes[0]);
  expect(writes[1].contentProfileHint).toBe('series');
  await page.screenshot({ path: testInfo.outputPath('series-saved.png'), fullPage: true });
  expect((await new AxeBuilder({ page }).include('.material-fields-page').analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByText('收藏架分拣策略', {exact:true}).click();
  await page.getByRole('combobox', {name:'模式',exact:true}).selectOption('sorting');
  await page.getByLabel('事实类型').selectOption('resolved_provider_identity');
  await page.getByLabel('TMDB ID').fill('1399');
  await expect(page.getByLabel('TMDB ID')).toHaveValue('1399');
  await page.getByRole('button', {name:'发布策略'}).click();
  await expect(page.locator('.routing-policy-panel').getByRole('status')).toContainText('分拣策略已发布');
  const identity = routing.targets[0].matchExpression.expectedValue;
  expect(identity).toMatchObject({provider:'tmdb',namespace:'tmdb_series',providerKey:'1399',identityRevision:1});
  const body = {identityRevision:1, namespace:'tmdb_series', provider:'tmdb', providerKey:'1399'};
  expect(identity.identityDigest).toBe(createHash('sha256').update(JSON.stringify(body)).digest('hex'));
  expect(errors).toEqual([]);
});
