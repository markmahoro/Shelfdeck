import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CollectionPage from '../src/helix/CollectionPage';
import CustomTargetDialog from '../src/helix/CustomTargetDialog';
import FormationPage from '../src/helix/FormationPage';
import {
  AdminApiError,
  helixAdminApi,
  type CollectionEntry,
  type CustomTargetPreviewRecord,
  type CustomTargetProposal,
  type FormationSubject,
} from '../src/helix/api';
import { SessionProvider } from '../src/helix/session';
import { mockRunningRuntime } from './fixtures/runtime';

const D = (ch: string) => ch.repeat(64);

function makeItem(id: string, overrides: Partial<FormationSubject> = {}): FormationSubject {
  return {
    formationViewId: 'view-' + id,
    subjectId: 'subject-' + id,
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
    organizingRequirement: '自定义标准 · HEVC · 4K · 50 GiB',
    organizingAction: '需要人工处理',
    organizingSteps: [],
    currentPlan: null,
    executorIssue: null,
    handoffB: null,
    productIdentityIssue: null,
    unresolvedReasonCode: null,
    targetShelfId: 'shelf-1',
    targetShelfName: '高分电影',
    routingState: 'resolved',
    nextAction: { label: '需要处理', state: 'attention_required', progress: null },
    currentRun: {
      libraRunId: id,
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
    ...overrides,
  } as FormationSubject;
}

function makeProposal(
  requirementCode: CustomTargetProposal['change']['requirementCode'],
  targetId: string,
  digestChar: string,
): CustomTargetProposal {
  return {
    change: { requirementCode, targetId, requiredValueDigest: D(digestChar) },
    changeDigest: D(digestChar),
    evidenceRefs: [{ resultId: 'res-' + digestChar, resultDigest: D(digestChar) }],
  };
}

function makePreview(
  id: string,
  digestChar = '1',
  proposals: CustomTargetProposal[] = [
    makeProposal('minimum_raster_unmet', 'minimumRasterClass', 'b'),
    makeProposal('primary_audio_unmet', 'acceptedPrimaryAudioClasses', 'c'),
  ],
): CustomTargetPreviewRecord {
  return {
    schemaRef: 'libra.custom-target-preview@1',
    basis: {
      subjectId: 'subject-' + id,
      libraRunId: id,
      runState: 'frozen',
      runStateRevision: 2,
      runStateDigest: D('a'),
      customTargetRevision: 0,
      handoffState: 'no_offer',
      contentProfile: 'movie',
      structureKind: 'single',
      shelfId: 'shelf-1',
    },
    baseRequirements: {
      mandatoryMedia: {
        videoCodec: 'hevc',
        minimumRasterClass: '4k',
        acceptedPrimaryAudioClasses: ['dts_hd_ma'],
        container: 'matroska',
        fileExtension: 'mkv',
      },
      space: { maxSizeGiB: 50, maxSizeBytes: 50 * 1024 * 1024 * 1024 },
      metadata: { requiredFieldCodes: ['plot'], requiredArtifactKinds: ['nfo', 'poster'] },
    },
    proposals,
    actorId: 'admin',
    createdAtMs: 1000,
    outcome: 'requires_new_production',
    previewDigest: D(digestChar),
  };
}

function mountDialog(
  id: string,
  options: {
    preview?: CustomTargetPreviewRecord;
    onClose?: () => void;
    onComplete?: () => Promise<void>;
  } = {},
) {
  const onClose = options.onClose || vi.fn();
  const onComplete = options.onComplete || vi.fn().mockResolvedValue(undefined);
  const item = makeItem(id);
  const preview = options.preview || makePreview(id);
  const view = render(
    <CustomTargetDialog
      item={item}
      preview={preview}
      onClose={onClose}
      onComplete={onComplete}
      onUnauthorized={vi.fn()}
    />,
  );
  return {
    ...view,
    item,
    preview,
    onClose,
    onComplete,
    dialog: screen.getByRole('dialog', { name: '调整收藏标准' }),
  };
}

function mockFormationShell(items: FormationSubject[]) {
  mockRunningRuntime();
  const summary = {
    totalCount: items.length,
    inProgressCount: 0,
    attentionRequiredCount: items.length,
    completedCount: 0,
    endedCount: 0,
  };
  const emptySummary = {
    totalCount: 0,
    inProgressCount: 0,
    attentionRequiredCount: 0,
    completedCount: 0,
    endedCount: 0,
  };
  const projection = { status: 'ready' as const, asOfMs: 1 };
  vi.spyOn(helixAdminApi, 'listFormation').mockImplementation(async (section) =>
    section === 'active'
      ? { items, summary, nextCursor: null, projection }
      : { items: [], summary: emptySummary, nextCursor: null, projection },
  );
  vi.spyOn(helixAdminApi, 'listFormationHistory').mockResolvedValue({
    items: [],
    summary: emptySummary,
    nextCursor: null,
    projection,
  });
  vi.spyOn(helixAdminApi, 'listShelves').mockResolvedValue({
    items: [{ shelfId: 'shelf-1', name: '高分电影', targetRootLocation: '/shelf', status: 'active' } as never],
  });
  vi.spyOn(helixAdminApi, 'getPerceptionSyncState').mockRejectedValue(new Error('not configured'));
  vi.spyOn(helixAdminApi, 'listCareWork').mockResolvedValue({ items: [], counts: {}, nextCursor: null });
  vi.spyOn(helixAdminApi, 'listJavCorrectionWork').mockResolvedValue({ items: [], counts: {}, nextCursor: null });
}

describe('Custom target acceptance UI', () => {
  afterEach(() => vi.restoreAllMocks());

  it('renders proposals, requires at least one selection, and dynamically reflects retained invariants', () => {
    const preview = makePreview('retained-ui', '1', [
      makeProposal('minimum_raster_unmet', 'minimumRasterClass', 'b'),
      makeProposal('video_codec_unmet', 'videoCodec', 'd'),
      makeProposal('max_size_exceeded', 'maxSizeBytes', 'e'),
    ]);
    const { dialog } = mountDialog('retained-ui', { preview });
    const confirm = within(dialog).getByRole('button', { name: '确认按新标准重新整理' });
    const checkboxes = within(dialog).getAllByRole('checkbox');
    expect(checkboxes).toHaveLength(3);
    expect(checkboxes.every((box) => (box as HTMLInputElement).checked)).toBe(true);
    expect(confirm).toBeEnabled();

    expect(dialog).toHaveTextContent('放宽最低分辨率要求（原要求 4K，保留当前片源清晰度）');
    expect(dialog).toHaveTextContent('放宽视频编码要求');
    expect(dialog).toHaveTextContent('取消单部体积上限');
    expect(dialog).toHaveTextContent('文件完整性与播放安全检查');
    expect(dialog).not.toHaveTextContent('HEVC 编码');
    expect(dialog).not.toHaveTextContent('单部不超过 50 GiB');

    // Uncheck codec + size cap: both become retained invariants again
    fireEvent.click(within(dialog).getByLabelText('放宽视频编码要求'));
    fireEvent.click(within(dialog).getByLabelText('取消单部体积上限'));
    expect(dialog).toHaveTextContent('HEVC 编码');
    expect(dialog).toHaveTextContent('单部不超过 50 GiB');
    expect(confirm).toBeEnabled();

    // Uncheck remaining checkbox -> confirm disabled
    fireEvent.click(within(dialog).getByLabelText('放宽最低分辨率要求（原要求 4K，保留当前片源清晰度）'));
    expect(confirm).toBeDisabled();
    fireEvent.click(within(dialog).getByLabelText('放宽最低分辨率要求（原要求 4K，保留当前片源清晰度）'));
    expect(confirm).toBeEnabled();
  });

  it('invalidates stale preview on 409, requires re-preview, and submits fresh idempotencyKey', async () => {
    const first = makePreview('stale-run', '1');
    const second = makePreview('stale-run', '2');
    const confirm = vi
      .spyOn(helixAdminApi, 'confirmCustomTarget')
      .mockRejectedValueOnce(new AdminApiError(409, 'LIBRA_CUSTOM_TARGET_PREVIEW_STALE', 'stale'))
      .mockResolvedValueOnce({
        kind: 'confirmed',
        record: { intentId: D('i'), subjectId: 'subject-stale-run', libraRunId: 'stale-run', revision: 1, intentDigest: D('d') },
        replayed: false,
      });
    vi.spyOn(helixAdminApi, 'getFormation').mockResolvedValue(makeItem('stale-run'));
    const prepare = vi
      .spyOn(helixAdminApi, 'prepareCustomTargetPreview')
      .mockResolvedValue({ kind: 'preview', record: second, replayed: false });

    const { dialog, onComplete, item } = mountDialog('stale-run', { preview: first });
    fireEvent.click(within(dialog).getByRole('button', { name: '确认按新标准重新整理' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('整理依据或评分标准已变化，请重新获取预览');
    expect(within(dialog).getByRole('button', { name: '确认按新标准重新整理' })).toBeDisabled();

    fireEvent.click(within(dialog).getByRole('button', { name: '重新获取预览' }));
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: '确认按新标准重新整理' })).toBeEnabled(),
    );
    expect(prepare).toHaveBeenCalledWith(item);

    fireEvent.click(within(dialog).getByRole('button', { name: '确认按新标准重新整理' }));
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(confirm.mock.calls[0][1].previewDigest).toBe(first.previewDigest);
    expect(confirm.mock.calls[1][1].previewDigest).toBe(second.previewDigest);
    expect(confirm.mock.calls[0][1].idempotencyKey).not.toBe(confirm.mock.calls[1][1].idempotencyKey);
  });

  it('retains exact pending command across reopen on network-unknown failure and replays identical idempotencyKey', async () => {
    const confirm = vi
      .spyOn(helixAdminApi, 'confirmCustomTarget')
      .mockRejectedValueOnce(new TypeError('network reset'))
      .mockResolvedValueOnce({
        kind: 'confirmed',
        record: { intentId: D('i'), subjectId: 'subject-unknown-run', libraRunId: 'unknown-run', revision: 1, intentDigest: D('d') },
        replayed: true,
      });

    const first = mountDialog('unknown-run');
    fireEvent.click(within(first.dialog).getByRole('button', { name: '确认按新标准重新整理' }));
    expect(await within(first.dialog).findByRole('alert')).toHaveTextContent('尚未确认');
    expect(within(first.dialog).getByRole('button', { name: '确认按新标准重新整理' })).toBeDisabled();
    expect(within(first.dialog).queryByRole('button', { name: '重新获取预览' })).toBeNull();

    first.unmount();
    const second = mountDialog('unknown-run');
    fireEvent.click(within(second.dialog).getByRole('button', { name: '确认提交结果' }));
    await waitFor(() => expect(second.onComplete).toHaveBeenCalledTimes(1));
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(confirm.mock.calls[0]).toEqual(confirm.mock.calls[1]);
  });

  it('offers only status refresh without resending confirm when onComplete fails after confirmation', async () => {
    const confirm = vi.spyOn(helixAdminApi, 'confirmCustomTarget').mockResolvedValue({
      kind: 'confirmed',
      record: { intentId: D('i'), subjectId: 'subject-refresh-run', libraRunId: 'refresh-run', revision: 1, intentDigest: D('d') },
      replayed: false,
    });
    const onComplete = vi.fn().mockRejectedValueOnce(new Error('read failed')).mockResolvedValueOnce(undefined);
    const { dialog } = mountDialog('refresh-run', { onComplete });

    fireEvent.click(within(dialog).getByRole('button', { name: '确认按新标准重新整理' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('状态读取失败');
    fireEvent.click(within(dialog).getByRole('button', { name: '刷新状态' }));
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(2));
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('wires FormationPage adjust-target action separately from defect admission and handles pending/ineligible/preview states', async () => {
    const item = makeItem('formation-run', {
      customTarget: {
        active: true,
        targetKind: 'user_custom',
        revision: 1,
        changes: [makeProposal('minimum_raster_unmet', 'minimumRasterClass', 'b').change],
        replacingRun: false,
        canCustomize: true,
      },
    });
    mockFormationShell([item]);
    vi.spyOn(helixAdminApi, 'previewDefectAdmission').mockResolvedValue({
      eligibility: 'eligible',
      candidateRevision: 1,
      libraRunId: 'formation-run',
      frozenRunStateRevision: 2,
      frozenRunStateDigest: D('a'),
      terminalEvidenceDigest: D('e'),
      candidateDigest: D('f'),
      waivedRequirementCodes: ['minimum_raster_unmet'],
      defects: [{ defectCode: 'media_requirements_unmet', sourceFailureCode: 'raster', waivedRequirementCodes: ['minimum_raster_unmet'] }],
      sizeForecast: null,
    } as never);
    const prepare = vi
      .spyOn(helixAdminApi, 'prepareCustomTargetPreview')
      .mockResolvedValueOnce({ kind: 'evidence_pending', replayed: false })
      .mockResolvedValueOnce({ kind: 'ineligible', reasonCode: 'no_relaxable_gaps', replayed: false })
      .mockResolvedValueOnce({ kind: 'preview', record: makePreview('formation-run'), replayed: false });

    render(
      <MemoryRouter initialEntries={['/formation']}>
        <SessionProvider>
          <FormationPage />
        </SessionProvider>
      </MemoryRouter>,
    );

    const customizeBtn = await screen.findByRole('button', { name: '调整收藏标准' });
    expect(screen.getByText('自定义标准')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: '接受瑕疵' })).toBeInTheDocument();

    fireEvent.click(customizeBtn);
    expect(await screen.findByText('正在补充源媒体与寻源证据，请稍后再试。')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '调整收藏标准' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '调整收藏标准' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('当前任务没有可放宽的收藏标准项。');
    expect(screen.queryByRole('dialog', { name: '调整收藏标准' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '调整收藏标准' }));
    expect(await screen.findByRole('dialog', { name: '调整收藏标准' })).toBeInTheDocument();
    expect(prepare).toHaveBeenCalledTimes(3);
  });

  it('displays custom target basis on CollectionPage poster wall and detail panel while distinguishing defect_admitted and standard entries', async () => {
    const baseEntry: CollectionEntry = {
      shelfEntryId: 'entry-custom',
      shelfId: 'shelf-1',
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
      overview: 'Overview',
      genres: ['剧情'],
      people: [{ personId: 'p1', displayName: 'Virginie Efira', role: 'actor' }],
      hasPoster: true,
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
        changes: [
          makeProposal('minimum_raster_unmet', 'minimumRasterClass', 'b').change,
          makeProposal('primary_audio_unmet', 'acceptedPrimaryAudioClasses', 'c').change,
        ],
      },
    };
    const defectEntry: CollectionEntry = {
      ...baseEntry,
      shelfEntryId: 'entry-defect',
      displayIdentity: '瑕疵影片',
      collectionBasis: 'defect_admitted',
      customTarget: null,
      defectAdmission: {
        authorizedAtMs: 50,
        defectCount: 1,
        defects: [{ defectCode: 'metadata_fields_unavailable', defectScope: 'product', recordedAtMs: 50 }],
      },
    };
    const standardEntry: CollectionEntry = {
      ...baseEntry,
      shelfEntryId: 'entry-standard',
      displayIdentity: '标准影片',
      collectionBasis: 'standard',
      customTarget: null,
      defectAdmission: null,
    };

    vi.spyOn(helixAdminApi, 'listCollection').mockResolvedValue({
      items: [baseEntry, defectEntry, standardEntry],
    } as never);
    vi.spyOn(helixAdminApi, 'listPerceptionRecords').mockResolvedValue({
      items: [],
      nextCursor: null,
      currentRating: null,
    });
    vi.spyOn(helixAdminApi, 'getCare').mockImplementation(async (entryId) => ({
      shelfEntryId: entryId,
      health: { state: 'healthy' },
      basis: { inventoryRevision: 1, standardRevision: 1, placementRevision: 1, careBasisDigest: D('b') },
      history: { assessments: [], findings: [], cases: [], commits: [] },
    }) as never);

    render(
      <MemoryRouter initialEntries={['/collection']}>
        <SessionProvider>
          <CollectionPage />
        </SessionProvider>
      </MemoryRouter>,
    );

    expect(await screen.findAllByText('自定义标准')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: /查看 巴黎夜旅人 详情/ }));
    const customDialog = await screen.findByRole('dialog');
    expect(customDialog).toHaveTextContent('自定义标准（已放宽 2 项要求）');
    expect(customDialog).toHaveTextContent('已调整标准');
    expect(customDialog).toHaveTextContent('放宽最低分辨率要求（原要求 4K，保留当前片源清晰度）');
    expect(customDialog).toHaveTextContent('放宽主音轨规格要求（保留当前可用主音轨）');
    fireEvent.click(within(customDialog).getByRole('button', { name: '关闭详情' }));

    fireEvent.click(screen.getByRole('button', { name: /查看 瑕疵影片 详情/ }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('带瑕疵入藏');
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '关闭详情' }));

    fireEvent.click(screen.getByRole('button', { name: /查看 标准影片 详情/ }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('标准达标');
  });
});
