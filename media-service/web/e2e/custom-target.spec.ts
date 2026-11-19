import { expect, test, type Page } from '@playwright/test';

const D = (ch: string) => ch.repeat(64);
const rasterChange = {
  requirementCode: 'minimum_raster_unmet',
  targetId: 'minimumRasterClass',
  requiredValueDigest: D('b'),
};
const audioChange = {
  requirementCode: 'primary_audio_unmet',
  targetId: 'acceptedPrimaryAudioClasses',
  requiredValueDigest: D('c'),
};

async function fixture(
  page: Page,
  mode: 'ready' | 'stale' | 'unknown' | 'held' | 'unknown-held' | 'preview-pending' | 'preview-ineligible',
  open = true,
) {
  const item = {
    formationViewId: 'view-movie',
    subjectId: 'subject-movie',
    displayIdentity: '巴黎夜旅人 (2022)',
    contentProfile: 'movie',
    structureKind: 'single',
    classification: 'attention_required',
    status: 'active',
    myRating: 5,
    myRatingSource: 'self',
    myRatingRevision: 1,
    addedAtMs: 1,
    primaryMaterialCount: 1,
    organizingRequirement: 'HEVC · 4K · 50 GiB',
    organizingAction: '需要人工处理',
    organizingSteps: [],
    currentPlan: null,
    executorIssue: null,
    handoffB: null,
    productIdentityIssue: null,
    unresolvedReasonCode: null,
    targetShelfId: 'shelf-movie',
    targetShelfName: '高分电影',
    routingState: 'resolved',
    nextAction: { label: '需要处理', state: 'attention_required', progress: null },
    currentRun: {
      libraRunId: 'run-movie',
      state: 'frozen',
      stateRevision: 2,
      stateDigest: D('a'),
      priorityClass: 'normal',
      packageRevisionHead: 0,
      currentIdentityRevision: 1,
    },
    customTarget: {
      active: false,
      targetKind: 'standard',
      revision: 0,
      changes: [],
      replacingRun: false,
      canCustomize: true,
    },
  };

  const state = { submitted: false, changed: false, failPreview: false };
  const writes: Array<Record<string, unknown>> = [];
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const summary = { totalCount: 1, inProgressCount: 0, attentionRequiredCount: 1, completedCount: 0, endedCount: 0 };

  await page.route('**/v1/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;

    if (path.endsWith('/actions/prepare-custom-target-preview')) {
      if (state.failPreview && mode === 'preview-pending') {
        return route.fulfill({ json: { kind: 'evidence_pending', replayed: false } });
      }
      if (state.failPreview && mode === 'preview-ineligible') {
        return route.fulfill({ json: { kind: 'ineligible', reasonCode: 'no_relaxable_gaps', replayed: false } });
      }
      return route.fulfill({
        json: {
          kind: 'preview',
          replayed: false,
          record: {
            schemaRef: 'libra.custom-target-preview@1',
            basis: {
              subjectId: 'subject-movie',
              libraRunId: 'run-movie',
              runState: 'frozen',
              runStateRevision: 2,
              runStateDigest: D('a'),
              customTargetRevision: 0,
              handoffState: 'no_offer',
              contentProfile: 'movie',
              structureKind: 'single',
              shelfId: 'shelf-movie',
            },
            baseRequirements: {
              mandatoryMedia: { videoCodec: 'hevc', minimumRasterClass: '4k', acceptedPrimaryAudioClasses: ['dts_hd_ma'] },
              space: { maxSizeGiB: 50, maxSizeBytes: 50 * 1024 * 1024 * 1024 },
              metadata: { requiredFieldCodes: ['plot'], requiredArtifactKinds: ['nfo', 'poster'] },
            },
            proposals: [
              {
                change: rasterChange,
                changeDigest: D('b'),
                evidenceRefs: [{ resultId: 'probe-1', resultDigest: D('b') }],
              },
              {
                change: audioChange,
                changeDigest: D('c'),
                evidenceRefs: [{ resultId: 'probe-1', resultDigest: D('b') }],
              },
            ],
            actorId: 'admin',
            createdAtMs: 1000,
            outcome: 'requires_new_production',
            previewDigest: state.changed ? D('d') : D('c'),
          },
        },
      });
    }

    if (path.endsWith('/actions/confirm-custom-target')) {
      writes.push(req.postDataJSON());
      if (mode === 'held' || (mode === 'unknown-held' && writes.length === 2)) await held;
      if (mode === 'stale' && writes.length === 1) {
        state.changed = true;
        return route.fulfill({
          status: 409,
          json: {
            error: {
              code: 'LIBRA_CUSTOM_TARGET_PREVIEW_STALE',
              message: '整理依据或评分标准已变化，请重新获取预览。',
            },
          },
        });
      }
      if ((mode === 'unknown' || mode === 'unknown-held') && writes.length === 1) {
        return route.abort('connectionreset');
      }
      state.submitted = true;
      return route.fulfill({
        status: 202,
        json: {
          kind: 'confirmed',
          record: {
            intentId: D('e'),
            subjectId: 'subject-movie',
            libraRunId: 'run-movie',
            revision: 1,
            intentDigest: D('f'),
          },
          replayed: mode === 'unknown' || mode === 'unknown-held',
        },
      });
    }

    if (path.endsWith('/defect-admission-candidate')) {
      return route.fulfill({
        json: {
          eligibility: 'ineligible',
          message: '请使用自定义标准调整。',
          ineligibleReasons: ['movie'],
          missingEvidence: [],
        },
      });
    }

    if (path === '/v1/admin/runtime') {
      return route.fulfill({
        json: { mode: 'running', desiredMode: 'running', normalSupplyAllowed: true, revision: 1, operation: null, activity: {} },
      });
    }

    if (path === '/v1/admin/formation') {
      const active = url.searchParams.get('section') === 'active';
      const current = state.submitted
        ? {
            ...item,
            classification: 'in_progress',
            organizingRequirement: '自定义标准 · HEVC · 50 GiB',
            currentRun: { ...item.currentRun, state: 'active', stateRevision: 3, stateDigest: D('g') },
            customTarget: {
              active: true,
              targetKind: 'user_custom',
              revision: 1,
              changes: [rasterChange, audioChange],
              replacingRun: true,
              canCustomize: false,
            },
            nextAction: { label: '按新标准重新整理', state: 'running', progress: null },
          }
        : item;
      return route.fulfill({
        json: {
          items: active ? [current] : [],
          summary: state.submitted ? { totalCount: 1, inProgressCount: 1, attentionRequiredCount: 0, completedCount: 0, endedCount: 0 } : summary,
          nextCursor: null,
          projection: { status: 'ready', asOfMs: 1 },
        },
      });
    }

    if (path === '/v1/admin/formation/view-movie') {
      return route.fulfill({ json: item });
    }

    return route.fulfill({
      json: { items: [], summary, counts: {}, nextCursor: null, state: 'ready', completionState: 'complete' },
    });
  });

  await page.goto('/formation');
  const customize = page.getByRole('button', { name: '调整收藏标准', exact: true });
  await expect(customize).toBeEnabled();
  const dialog = page.getByRole('dialog', { name: '调整收藏标准' });
  if (open) {
    await customize.press('Enter');
    await expect(dialog).toBeVisible();
  }
  return { dialog, writes, state, release, customize };
}

for (const method of ['escape', 'scrim', 'cancel', 'close'] as const) {
  test(`closing an idle custom-target dialog by ${method} returns focus to its trigger`, async ({ page }) => {
    const { dialog, writes, customize } = await fixture(page, 'ready');
    if (method === 'escape') await page.keyboard.press('Escape');
    if (method === 'scrim') await page.locator('.dialog-scrim').click({ position: { x: 2, y: 2 } });
    if (method === 'cancel') await dialog.getByRole('button', { name: '取消', exact: true }).press('Enter');
    if (method === 'close') await dialog.getByRole('button', { name: '关闭' }).press('Enter');
    await expect(dialog).toBeHidden();
    await expect(customize).toBeFocused({ timeout: 2000 });
    expect(writes).toHaveLength(0);
    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
  });
}

test('closing an idle custom-target dialog returns focus to a page action if its trigger disappeared', async ({ page }) => {
  const { dialog, customize } = await fixture(page, 'ready');
  await customize.evaluate((node) => node.remove());
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: '刷新', exact: true })).toBeFocused({ timeout: 2000 });
});

for (const mode of ['preview-pending', 'preview-ineligible'] as const) {
  test(`${mode} keeps focus on trigger and does not open dialog`, async ({ page }) => {
    const { dialog, customize, writes, state } = await fixture(page, mode, false);
    state.failPreview = true;
    await customize.press('Enter');
    if (mode === 'preview-pending') {
      await expect(page.getByRole('status').filter({ hasText: '正在补充源媒体与寻源证据' })).toBeVisible();
    } else {
      await expect(page.getByRole('alert')).toContainText('没有可放宽的收藏标准项');
    }
    await expect(dialog).toBeHidden();
    await expect(customize).toBeFocused({ timeout: 2000 });
    expect(writes).toHaveLength(0);
  });
}

test('checkbox selection controls submit state and stale 409 requires re-preview', async ({ page }) => {
  const { dialog, writes } = await fixture(page, 'stale');
  const confirm = dialog.getByRole('button', { name: '确认按新标准重新整理', exact: true });
  const rasterBox = dialog.getByLabel('放宽最低分辨率要求（原要求 4K，保留当前片源清晰度）');
  const audioBox = dialog.getByLabel('放宽主音轨规格要求（保留当前可用主音轨）');

  await expect(dialog).toContainText('HEVC 编码、单部不超过 50 GiB');
  await rasterBox.uncheck();
  await audioBox.uncheck();
  await expect(confirm).toBeDisabled();
  await rasterBox.check();
  await expect(confirm).toBeEnabled();

  await confirm.press('Enter');
  await expect(dialog.getByRole('alert')).toContainText('请重新获取预览');
  await expect(confirm).toBeDisabled();

  await dialog.getByRole('button', { name: '重新获取预览', exact: true }).press('Enter');
  await expect(confirm).toBeEnabled();
  await confirm.press('Enter');
  await expect(dialog).toBeHidden();
  expect(writes).toHaveLength(2);
  expect(writes[0].previewDigest).not.toBe(writes[1].previewDigest);
  expect(writes[0].idempotencyKey).not.toBe(writes[1].idempotencyKey);
});

test('uncertain network failure replays exact idempotencyKey via confirm-status button', async ({ page }) => {
  const { dialog, writes } = await fixture(page, 'unknown');
  await dialog.getByRole('button', { name: '确认按新标准重新整理', exact: true }).press('Enter');
  await expect(dialog.getByRole('alert')).toContainText('提交结果尚未确认');
  await expect(dialog.getByRole('button', { name: '确认按新标准重新整理', exact: true })).toBeDisabled();

  await dialog.getByRole('button', { name: '确认提交结果', exact: true }).press('Enter');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('status').filter({ hasText: '已确认自定义收藏标准' })).toBeFocused({ timeout: 2000 });
  expect(writes).toHaveLength(2);
  expect(writes[1]).toEqual(writes[0]);
});

test('keyboard focus remains trapped inside custom-target dialog while submission is pending', async ({ page }) => {
  const { dialog, writes, release } = await fixture(page, 'held');
  try {
    const confirm = dialog.getByRole('button', { name: '确认按新标准重新整理', exact: true });
    await confirm.focus();
    await page.keyboard.press('Enter');
    await expect(confirm).toBeDisabled();
    expect(writes).toHaveLength(1);
    await expect(dialog).toBeFocused();
    await expect(dialog.getByRole('status')).toHaveText('正在处理，请稍候。');
    await expect(dialog.getByRole('button', { name: '关闭' })).toBeDisabled();

    await page.keyboard.press('Tab');
    await expect(dialog).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(dialog).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    await page.locator('.dialog-scrim').click({ position: { x: 2, y: 2 } });
    await expect(dialog).toBeVisible();
    await expect(dialog).toBeFocused();
  } finally {
    release();
  }
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('status').filter({ hasText: '已确认自定义收藏标准' })).toBeFocused({ timeout: 2000 });
});

test('collection wall shows custom target basis badge and detail facts without marking as defect', async ({ page }) => {
  const summary = { totalCount: 0, inProgressCount: 0, attentionRequiredCount: 0, completedCount: 0, endedCount: 0 };
  const entry = {
    shelfEntryId: 'entry-movie',
    shelfId: 'shelf-movie',
    shelfName: '高分电影',
    structureKind: 'single',
    status: 'active',
    canonicalIdentityRevision: 1,
    canonicalIdentityKey: 'tmdb:778899',
    provider: 'tmdb',
    providerKey: '778899',
    identityKind: 'provider_identity',
    identityDigest: D('a'),
    displayIdentity: '巴黎夜旅人',
    year: 2022,
    overview: 'A survivor searches for meaning after an attack in Paris.',
    genres: ['剧情'],
    people: [{ personId: 'person-1', displayName: 'Virginie Efira', role: 'actor' }],
    hasPoster: false,
    hasNfo: true,
    occupancyBytes: 1024,
    primaryVideoBytes: 1024,
    primaryContainer: 'MKV',
    videoCodec: 'HEVC',
    videoRaster: '1080p',
    health: { state: 'healthy' },
    currentInventoryRevision: 1,
    currentDeckFactRevision: 1,
    createdAtMs: 1,
    terminalAtMs: null,
    collectionBasis: 'user_custom',
    customTarget: {
      targetRevision: 1,
      confirmedAtMs: 100,
      changes: [rasterChange, audioChange],
    },
    defectAdmission: null,
  };

  await page.route('**/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/v1/admin/runtime') {
      return route.fulfill({
        json: { mode: 'running', desiredMode: 'running', normalSupplyAllowed: true, revision: 1, operation: null, activity: {} },
      });
    }
    if (path === '/v1/admin/collection') {
      return route.fulfill({ json: { items: [entry], summary: { currentCount: 1, historyCount: 0 }, resultCount: 1, nextCursor: null } });
    }
    if (path === '/v1/admin/care/entry-movie') {
      return route.fulfill({
        json: {
          shelfEntryId: 'entry-movie',
          health: { state: 'healthy' },
          basis: { inventoryRevision: 1, standardRevision: 1, placementRevision: 1, careBasisDigest: D('b') },
          history: { assessments: [], findings: [], cases: [], commits: [] },
        },
      });
    }
    if (path.endsWith('/defect-admission-candidate')) {
      return route.fulfill({
        json: {
          acceptedGaps: [],
          unavailableRepairs: [],
          gaps: [],
          eligibility: 'ineligible',
          ineligibleReasons: ['no_current_gaps'],
        },
      });
    }
    return route.fulfill({ json: { items: [], summary, counts: {}, nextCursor: null, currentRating: null } });
  });

  await page.goto('/collection');
  await expect(page.getByText('自定义标准')).toBeVisible();
  const tile = page.getByRole('button', { name: /查看 巴黎夜旅人 详情/ });
  await tile.click();
  const detail = page.getByRole('dialog', { name: '巴黎夜旅人' });
  await expect(detail).toBeVisible();
  await expect(detail).toContainText('自定义标准（已放宽 2 项要求）');
  await expect(detail).toContainText('放宽最低分辨率要求（原要求 4K，保留当前片源清晰度）');
  await expect(detail).toContainText('放宽主音轨规格要求（保留当前可用主音轨）');
  await expect(detail).not.toContainText('带瑕疵入藏');
});
