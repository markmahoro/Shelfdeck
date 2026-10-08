import { createRequire } from 'node:module';
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const require = createRequire(import.meta.url);
const { BETA_RECOMMENDED_RULES, RULES_SCHEMA_REF, validateRuleTemplateRules } = require('../../src/helix/domains/arca/model/rule-template-contracts.js');

test('edits per-Episode Series limits without changing Movie rules', async ({ page }, testInfo) => {
  const rules = structuredClone(BETA_RECOMMENDED_RULES);
  const system = { templateId: 'system-beta-recommended', name: 'System', ownerKind: 'system', status: 'active', currentRevision: 1, current: { revision: 1, rules, rulesDigest: 'initial' } };
  const own = { ...system, templateId: 'own', ownerKind: 'user' };
  let draft = { templateId: 'own', draftRevision: 1, basePublishedRevision: 1, rulesSchemaRef: RULES_SCHEMA_REF, rules, rulesDigest: 'initial' };
  let published = false;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/v1/admin/rule-templates') { await route.fulfill({ json: { items: published ? [system, own] : [system] } }); return; }
    if (path.endsWith('/actions/copy')) { await route.fulfill({ json: { template: own, draft, replayed: false } }); return; }
    if (path.endsWith('/draft')) {
      if (route.request().method() === 'PATCH') {
        const body = route.request().postDataJSON();
        validateRuleTemplateRules(body.rulesSchemaRef, body.rules, body.rulesDigest);
        draft = { ...draft, rules: body.rules, rulesDigest: body.rulesDigest, draftRevision: 2 };
        await route.fulfill({ json: draft });
      } else await route.fulfill({ json: { templateId: 'own', writable: true, draft } });
      return;
    }
    if (path.endsWith('/actions/preview')) { await route.fulfill({ json: { templateId: 'own', affectedShelfCount: 0, currentEntryPotentialGapCount: 0, expectedDraftRevision: 2, expectedDraftDigest: draft.rulesDigest } }); return; }
    if (path.endsWith('/actions/publish')) { published = true; own.current = { ...own.current, rules: draft.rules }; await route.fulfill({ json: { template: own } }); return; }
    await route.fulfill({ json: { items: [], state: 'ready', completionState: 'complete', counts: {} } });
  });
  await page.goto('/shelves');
  await expect(page.getByRole('region', { name: '剧集整理标准' })).toContainText('每集 · 最多 0.75 GiB');
  await page.getByRole('button', { name: '复制模板' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('媒体类型').focus();
  await dialog.getByLabel('媒体类型').press('ArrowDown');
  await dialog.getByLabel('媒体类型').press('Tab');
  await expect(dialog.getByLabel('媒体类型')).toHaveValue('series');
  await dialog.getByLabel('每集空间上限 GiB').nth(1).fill('0.5');
  await dialog.getByLabel('媒体类型').selectOption('movie');
  await expect(dialog.getByLabel('空间上限 GiB', { exact: true }).nth(1)).toHaveValue('2');
  await dialog.getByLabel('媒体类型').selectOption('series');
  await expect(dialog.getByLabel('每集空间上限 GiB').nth(1)).toHaveValue('0.5');
  await dialog.getByRole('button', { name: '预览影响' }).click();
  await expect(dialog.getByRole('button', { name: '发布整理标准' })).toBeEnabled();
  expect((await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('series-standard.png'), fullPage: true });
  expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  const bounds = await dialog.boundingBox();
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(draft.rules.profileRuleSets.find((p: any) => p.contentProfile === 'movie')).toEqual(rules.profileRuleSets.find((p: any) => p.contentProfile === 'movie'));
  await dialog.getByRole('button', { name: '发布整理标准' }).click();
  await expect(page.getByRole('status')).toContainText('整理标准已发布');
  await expect(page.getByRole('region', { name: '剧集整理标准' })).toContainText('每集 · 最多 0.5 GiB');
  expect(errors).toEqual([]);
});
