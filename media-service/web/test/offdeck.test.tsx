import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import OffdeckPage from '../src/helix/OffdeckPage';
import { helixAdminApi, type CollectionEntry, type OffdeckCase, type OffdeckPolicy, type OffdeckReview } from '../src/helix/api';
import { SessionProvider } from '../src/helix/session';

const policy: OffdeckPolicy = {
  policyId: 'arca-offdeck-system-policy',
  revision: 1,
  status: 'disabled',
  duplicateScheduleEnabled: false,
  entryRules: [],
  policyDigest: 'a'.repeat(64),
};

function offdeckCase(offdeckCaseId: string, state: OffdeckCase['state']): OffdeckCase {
  return {
    offdeckCaseId,
    shelfEntryId: `entry-${offdeckCaseId}`,
    state,
    recoveryRevision: 1,
    retryAtMs: null,
    blockedReason: null,
    createdAtMs: 1,
    terminalAtMs: state === 'completed' ? 2 : null,
  };
}

function collectionEntry(shelfEntryId: string, displayIdentity: string, occupancyBytes: number): CollectionEntry {
  return {
    shelfEntryId, shelfId: 'shelf-1', shelfName: 'Movie Shelf', displayIdentity, occupancyBytes,
    status: 'active', structureKind: 'single', canonicalIdentityRevision: 1, canonicalIdentityKey: shelfEntryId,
    provider: 'tmdb', providerKey: shelfEntryId, identityKind: 'tmdb_movie', identityDigest: shelfEntryId,
    year: 2026, overview: null, genres: [], people: [], hasPoster: true, hasNfo: true,
    primaryVideoBytes: occupancyBytes, primaryContainer: 'MKV', videoCodec: 'HEVC', videoRaster: '1080p',
    defectAdmission: null, health: { state: 'healthy' }, currentInventoryRevision: 1, currentDeckFactRevision: 1,
    createdAtMs: 1, terminalAtMs: null,
  };
}

const highVolumeReview: OffdeckReview = {
  reviewId: 'review-bulk', originKind: 'batch', originRef: 'batch-selection', state: 'awaiting_escalation', createdAtMs: 1,
  reservations: [], scopes: [],
  selection: { selectionReceiptId: 'selection-1', scopeSetDigest: 'a'.repeat(64), entryCount: 3, primaryCount: 3, totalBytes: 6_000, deckCoverageRatio: 1, highVolume: true },
  escalation: null,
};

describe('Off-deck progress', () => {
  afterEach(() => { history.replaceState(null, '', '/'); vi.restoreAllMocks(); });

  it('does not count completed cases as currently exiting', async () => {
    vi.spyOn(helixAdminApi, 'getOffdeckPolicy').mockResolvedValue(policy);
    vi.spyOn(helixAdminApi, 'listOffdeckCandidates').mockResolvedValue({
      candidates: [], duplicateGroups: [], suppressions: [], whitelists: [],
    });
    vi.spyOn(helixAdminApi, 'listOffdeckCases').mockResolvedValue({
      items: [offdeckCase('active', 'executing'), offdeckCase('done', 'completed')],
    });
    vi.spyOn(helixAdminApi, 'listCollection').mockResolvedValue({ items: [] });
    vi.spyOn(helixAdminApi, 'listShelves').mockResolvedValue({ items: [] });

    render(<SessionProvider><OffdeckPage /></SessionProvider>);

    const heading = await screen.findByRole('heading', { name: '正在退出' });
    const section = heading.closest('section');
    expect(section).not.toBeNull();
    expect(within(section!).getByText('1 部')).toBeInTheDocument();
    expect(within(section!).queryByText('已完成')).not.toBeInTheDocument();
  });

  it('shows completed Off-deck history as a list and never offers historical entries for selection', async () => {
    vi.spyOn(helixAdminApi, 'getOffdeckPolicy').mockResolvedValue(policy);
    vi.spyOn(helixAdminApi, 'listOffdeckCandidates').mockResolvedValue({ candidates:[], duplicateGroups:[], suppressions:[], whitelists:[] });
    vi.spyOn(helixAdminApi, 'listOffdeckCases').mockResolvedValue({ items:[offdeckCase('done', 'completed')] });
    const current = collectionEntry('entry-current', 'Current Movie', 1_000);
    const historical = { ...collectionEntry('entry-done', 'Finished Movie', 2_000), status:'off_deck', terminalAtMs:2 };
    const list = vi.spyOn(helixAdminApi, 'listCollection').mockImplementation(async (filters) => ({
      items: filters?.status === 'history' ? [historical] : [current],
    }));
    vi.spyOn(helixAdminApi, 'listShelves').mockResolvedValue({ items:[] });

    render(<SessionProvider><OffdeckPage /></SessionProvider>);

    expect(await screen.findByText('Finished Movie')).toBeInTheDocument();
    expect(screen.getByText('这里只记录已经完成的退出收藏，不包含收藏架注销。')).toBeInTheDocument();
    const selection = screen.getByRole('heading', { name:'手动退出' }).closest('section')!;
    fireEvent.click(within(selection).getByRole('button', { name:'全选当前收藏' }));
    expect(within(selection).getByText('Current Movie')).toBeInTheDocument();
    expect(within(selection).queryByText('Finished Movie')).not.toBeInTheDocument();
    expect(list).toHaveBeenCalledWith({ status:'current' });
    expect(list).toHaveBeenCalledWith({ status:'history' });
  });

  it('selects every current Entry into one batch Review and exposes High-volume confirmation', async () => {
    const entries = [
      collectionEntry('entry-c', 'Movie C', 3_000),
      collectionEntry('entry-a', 'Movie A', 1_000),
      collectionEntry('entry-b', 'Movie B', 2_000),
    ];
    vi.spyOn(helixAdminApi, 'getOffdeckPolicy').mockResolvedValue(policy);
    vi.spyOn(helixAdminApi, 'listOffdeckCandidates').mockResolvedValue({
      candidates: [], duplicateGroups: [], suppressions: [], whitelists: [],
    });
    vi.spyOn(helixAdminApi, 'listOffdeckCases').mockResolvedValue({ items: [] });
    vi.spyOn(helixAdminApi, 'listCollection').mockResolvedValue({ items: entries });
    vi.spyOn(helixAdminApi, 'listShelves').mockResolvedValue({ items: [] });
    const createReview = vi.spyOn(helixAdminApi, 'createOffdeckReview').mockResolvedValue(highVolumeReview);
    vi.spyOn(helixAdminApi, 'getOffdeckReview').mockResolvedValue(highVolumeReview);

    render(<SessionProvider><OffdeckPage /></SessionProvider>);

    await screen.findByRole('heading', { name: '手动退出' });
    expect(screen.queryByText('退出规则')).not.toBeInTheDocument();
    expect(screen.queryByText('审阅')).not.toBeInTheDocument();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: '全选当前收藏' }));
    expect(screen.getByText('3 / 3 部')).toBeInTheDocument();
    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
    expect(screen.getAllByRole('checkbox').every((item) => (item as HTMLInputElement).checked)).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: '确认退出 3 部' }));
    await waitFor(() => expect(createReview).toHaveBeenCalledTimes(1));
    expect(createReview).toHaveBeenCalledWith(expect.objectContaining({
      shelfEntryIds: ['entry-a', 'entry-b', 'entry-c'], actorId: 'admin',
      idempotencyKey: expect.stringMatching(/^offdeck-batch:/),
    }));
    expect(await screen.findByRole('button', { name: '再次确认大批量' })).toBeInTheDocument();
  });
});

describe('Off-deck rules live in settings', () => {
  afterEach(() => vi.restoreAllMocks());

  it('edits rules on the settings tab, not the off-deck page', async () => {
    vi.spyOn(helixAdminApi, 'getIntegration').mockResolvedValue({
      kind: 'douban', supported: true, configured: false, state: 'idle', configRevision: 0,
      endpoint: null, configDigest: null, capabilityCodes: [], lastTestSummary: null, landingBinding: null,
    });
    vi.spyOn(helixAdminApi, 'getOffdeckPolicy').mockResolvedValue(policy);
    vi.spyOn(helixAdminApi, 'listShelves').mockResolvedValue({ items: [] });
    render(<MemoryRouter initialEntries={['/settings']}><App /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('tab', { name: '退出规则' }));
    expect(await screen.findByRole('heading', { level: 2, name: '退出规则' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存规则' })).toBeInTheDocument();
  });
});
