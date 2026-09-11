import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  selection: { selectionReceiptId: 'selection-1', scopeSetDigest: 'a'.repeat(64), entryCount: 3, primaryCount: 3, totalBytes: 120 * 1024 ** 3, deckCoverageRatio: 1, highVolume: true },
  escalation: null,
};

function mockWorkbench(entries: CollectionEntry[] = [], cases: OffdeckCase[] = [], historyEntries: CollectionEntry[] = []) {
  vi.spyOn(helixAdminApi, 'getOffdeckWorkbench').mockResolvedValue({ candidates:[],duplicateGroups:[],entries,
    currentCount:entries.length,candidateCount:0,nextCursor:null,shelves:[{shelfId:'shelf-1',name:'Movie Shelf'}] });
  vi.spyOn(helixAdminApi, 'listOffdeckWorkCases').mockImplementation(async classification=>({
    items:cases.filter(item=>(item.state==='completed')===(classification==='completed')),entries:historyEntries,
    counts:{active:cases.filter(item=>item.state!=='completed').length,completed:cases.filter(item=>item.state==='completed').length},nextCursor:null }));
  vi.spyOn(helixAdminApi, 'selectAllOffdeckEntries').mockResolvedValue({shelfEntryIds:entries.map(item=>item.shelfEntryId).sort()});
  vi.spyOn(helixAdminApi, 'getOffdeckEntryDisplay').mockImplementation(async ids=>({items:[...entries,...historyEntries].filter(item=>ids.includes(item.shelfEntryId))}));
  vi.spyOn(helixAdminApi, 'searchOffdeckEntries').mockImplementation(async q=>({items:entries.filter(item=>item.displayIdentity.includes(q)),nextCursor:null}));
  return vi.spyOn(helixAdminApi, 'listCollection').mockRejectedValue(new Error('Off-deck must not read Collection details.'));
}

describe('Off-deck progress', () => {
  afterEach(() => { history.replaceState(null, '', '/'); vi.useRealTimers(); vi.restoreAllMocks(); });

  it('keeps all 1000 selected IDs in one Review while rendering at most 25 selection rows', async()=>{
    const entries=Array.from({length:1000},(_,i)=>collectionEntry('entry-'+String(i).padStart(4,'0'),'Movie '+i,100));
    const collection=mockWorkbench(entries);
    vi.mocked(helixAdminApi.getOffdeckWorkbench).mockResolvedValue({candidates:[],duplicateGroups:[],entries:[],currentCount:1000,candidateCount:0,nextCursor:null,shelves:[]});
    vi.mocked(helixAdminApi.searchOffdeckEntries).mockResolvedValue({items:entries.slice(0,25),nextCursor:'next'});
    const create=vi.spyOn(helixAdminApi,'createOffdeckReview').mockResolvedValue(highVolumeReview);
    render(<SessionProvider><OffdeckPage/></SessionProvider>);
    await screen.findByRole('heading',{name:'手动退出'});
    expect(helixAdminApi.searchOffdeckEntries).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'全选当前收藏'}));
    const confirm=await screen.findByRole('button',{name:'确认退出'});
    await waitFor(()=>expect(confirm).toBeEnabled());
    expect(screen.getAllByRole('checkbox')).toHaveLength(25);
    fireEvent.click(confirm);
    await waitFor(()=>expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0][0].shelfEntryIds).toEqual(entries.map(item=>item.shelfEntryId));
    expect(collection).not.toHaveBeenCalled();
  });

  it('discards an older search response and supports explicit retry after failure',async()=>{
    vi.useFakeTimers();mockWorkbench([collectionEntry('entry','Initial',1)]);
    let resolveOld!:(value:{items:CollectionEntry[];nextCursor:null})=>void;
    const search=vi.mocked(helixAdminApi.searchOffdeckEntries);
    search.mockImplementationOnce(()=>new Promise(resolve=>{resolveOld=resolve;}))
      .mockResolvedValueOnce({items:[collectionEntry('new','New title',1)],nextCursor:null})
      .mockRejectedValueOnce(new Error('Search unavailable'))
      .mockResolvedValueOnce({items:[collectionEntry('retry','Retry title',1)],nextCursor:null});
    await act(async()=>{render(<SessionProvider><OffdeckPage/></SessionProvider>);});
    const input=screen.getByRole('searchbox');
    fireEvent.change(input,{target:{value:'Old'}});
    await act(async()=>{await vi.advanceTimersByTimeAsync(250);});
    fireEvent.change(input,{target:{value:'New'}});
    await act(async()=>{await vi.advanceTimersByTimeAsync(250);});
    await act(async()=>{resolveOld({items:[collectionEntry('old','Old title',1)],nextCursor:null});});
    expect(screen.getByText('New title')).toBeInTheDocument();expect(screen.queryByText('Old title')).not.toBeInTheDocument();
    fireEvent.change(input,{target:{value:'Retry'}});
    await act(async()=>{await vi.advanceTimersByTimeAsync(250);});
    expect(screen.getByRole('alert')).toHaveTextContent('Search unavailable');
    fireEvent.click(screen.getByRole('button',{name:'重新搜索'}));
    await act(async()=>{await vi.advanceTimersByTimeAsync(250);});
    expect(screen.getByText('Retry title')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not count completed cases as currently exiting', async () => {
    vi.spyOn(helixAdminApi, 'getOffdeckPolicy').mockResolvedValue(policy);
    mockWorkbench([], [offdeckCase('active', 'executing'), offdeckCase('done', 'completed')]);
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
    const current = collectionEntry('entry-current', 'Current Movie', 1_000);
    const historical = { ...collectionEntry('entry-done', 'Finished Movie', 2_000), status:'off_deck', terminalAtMs:2 };
    const list = mockWorkbench([current],[offdeckCase('done','completed')],[historical]);
    vi.spyOn(helixAdminApi, 'listShelves').mockResolvedValue({ items:[] });

    render(<SessionProvider><OffdeckPage /></SessionProvider>);

    expect(await screen.findByText('Finished Movie')).toBeInTheDocument();
    expect(screen.queryByText('这里只记录已经完成的退出收藏，不包含收藏架注销。')).not.toBeInTheDocument();
    const selection = screen.getByRole('heading', { name:'手动退出' }).closest('section')!;
    fireEvent.click(within(selection).getByRole('button', { name:'全选当前收藏' }));
    expect(await within(selection).findByText('Current Movie')).toBeInTheDocument();
    expect(within(selection).queryByText('Finished Movie')).not.toBeInTheDocument();
    expect(list).not.toHaveBeenCalled();
  });

  it('selects every current Entry into one batch Review and exposes High-volume confirmation', async () => {
    const entries = [
      collectionEntry('entry-c', 'Movie C', 3_000),
      collectionEntry('entry-a', 'Movie A', 1_000),
      collectionEntry('entry-b', 'Movie B', 2_000),
    ];
    vi.spyOn(helixAdminApi, 'getOffdeckPolicy').mockResolvedValue(policy);
    mockWorkbench(entries);
    vi.spyOn(helixAdminApi, 'listShelves').mockResolvedValue({ items: [] });
    const createReview = vi.spyOn(helixAdminApi, 'createOffdeckReview').mockResolvedValue(highVolumeReview);
    vi.spyOn(helixAdminApi, 'getOffdeckReview').mockResolvedValue(highVolumeReview);

    render(<SessionProvider><OffdeckPage /></SessionProvider>);

    await screen.findByRole('heading', { name: '手动退出' });
    expect(screen.queryByText('退出规则')).not.toBeInTheDocument();
    expect(screen.queryByText('审阅')).not.toBeInTheDocument();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: '全选当前收藏' }));
    expect(await screen.findByText('已选择 3 部')).toBeInTheDocument();
    await waitFor(()=>expect(screen.getByRole('button',{name:'确认退出'})).toBeEnabled());
    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
    expect(screen.getAllByRole('checkbox').every((item) => (item as HTMLInputElement).checked)).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: '确认退出' }));
    await waitFor(() => expect(createReview).toHaveBeenCalledTimes(1));
    expect(createReview).toHaveBeenCalledWith(expect.objectContaining({
      shelfEntryIds: ['entry-a', 'entry-b', 'entry-c'], actorId: 'admin',
      idempotencyKey: expect.stringMatching(/^offdeck-batch:/),
    }));
    expect(await screen.findByRole('button', { name: '再次确认大批量' })).toBeInTheDocument();
  });

  it('shows actual destruction roles and immutable totals before separate escalation and authorization', async () => {
    const review: OffdeckReview = { ...highVolumeReview, scopes: [{
      destructionScopeId: 'scope-1', shelfEntryId: 'entry-a', memberCount: 3,
      totalBytes: 120 * 1024 ** 3, scopeDigest: 'b'.repeat(64), state: 'sealed',
      materials: [
        { ordinal: 0, materialKey: 'main', role: 'primary_payload', location: '/movies/影片/BDMV/STREAM/00000.m2ts', sizeBytes: 119 * 1024 ** 3, deleteCondition: 'delete_primary' },
        { ordinal: 1, materialKey: 'structure', role: 'structural_dependency', location: '/movies/影片/BDMV/index.bdmv', sizeBytes: 1024, deleteCondition: 'delete_primary' },
        { ordinal: 2, materialKey: 'poster', role: 'poster', location: '/movies/影片/poster.jpg', sizeBytes: 1024, deleteCondition: 'release_related_then_delete_if_unreferenced' },
      ],
    }], selection: { ...highVolumeReview.selection!, entryCount: 1, primaryCount: 2, deckCoverageRatio: 0.25, shelfCoverageRatios: { 'shelf-1': 0.5 } } };
    review.scopes.push({ ...review.scopes[0], destructionScopeId: 'excluded', state: 'stale', materials: [{ ...review.scopes[0].materials[0], location: '/excluded/keep.mkv' }] });
    mockWorkbench([collectionEntry('entry-a', '影片', 1)]);
    vi.spyOn(helixAdminApi, 'getOffdeckReview').mockResolvedValue(review);
    const escalate = vi.spyOn(helixAdminApi, 'confirmOffdeckHighVolume').mockResolvedValue({ ...review, state: 'selection_confirmed' });
    const authorize = vi.spyOn(helixAdminApi, 'authorizeOffdeck').mockResolvedValue({} as never);
    history.replaceState(null, '', '/offdeck?review=review-bulk');
    render(<SessionProvider><OffdeckPage /></SessionProvider>);

    const dialog = await screen.findByRole('dialog', { name: '再次核对大批量退出' });
    expect(within(dialog).getByText('1 部收藏 · 2 个主视频或光盘结构文件 · 1 个附属文件')).toBeInTheDocument();
    expect(within(dialog).getByText('文件总空间：120.00 GiB · 占全部当前收藏 25.0%')).toBeInTheDocument();
    expect(within(dialog).getByText('收藏架：Movie Shelf')).toBeInTheDocument();
    expect(within(dialog).getByText('收藏架覆盖率：Movie Shelf 50.0%（确认选择时）')).toBeInTheDocument();
    expect(within(dialog).getByText('1 部范围已排除或失效，不会按本次范围删除。')).toBeInTheDocument();
    expect(within(dialog).queryByText(/excluded\/keep/)).not.toBeInTheDocument();
    expect(within(dialog).getByText('主视频 · /movies/影片/BDMV/STREAM/00000.m2ts')).toBeInTheDocument();
    expect(within(dialog).getByText('光盘结构文件 · /movies/影片/BDMV/index.bdmv')).toBeInTheDocument();
    expect(within(dialog).getByText('附属文件 · /movies/影片/poster.jpg · 仍被引用时保留')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: '确认删除' })).not.toBeInTheDocument();
    expect(authorize).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: '再次确认大批量' }));
    await screen.findByRole('button', { name: '确认删除' });
    expect(escalate).toHaveBeenCalledWith('review-bulk', { actorId: 'admin' });
    expect(authorize).not.toHaveBeenCalled();
    expect(helixAdminApi.getOffdeckWorkbench).toHaveBeenCalledTimes(1);
    expect(helixAdminApi.listOffdeckWorkCases).toHaveBeenCalledTimes(2);
    expect(helixAdminApi.listCollection).not.toHaveBeenCalled();
  });

  it('does not present a cancelled receipt as a future deletion or releasable space', async () => {
    mockWorkbench();
    vi.spyOn(helixAdminApi, 'getOffdeckReview').mockResolvedValue({ ...highVolumeReview, state: 'cancelled' });
    const authorize = vi.spyOn(helixAdminApi, 'authorizeOffdeck');
    history.replaceState(null, '', '/offdeck?review=review-bulk');
    render(<SessionProvider><OffdeckPage /></SessionProvider>);
    const dialog = await screen.findByRole('dialog', { name: '已取消的退出审阅' });
    expect(within(dialog).getByText('本次退出已取消，不会依据这次审阅删除文件。')).toBeInTheDocument();
    expect(within(dialog).queryByText(/文件总空间|最终授权后|120.00/)).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: '确认删除' })).not.toBeInTheDocument();
    expect(authorize).not.toHaveBeenCalled();
  });

  it('does not overlap slow preparation reads or reopen a closed review with a late response', async () => {
    vi.useFakeTimers();
    mockWorkbench();
    const preparing = { ...highVolumeReview, state: 'preparing', selection: null };
    let resolveRead!: (value: OffdeckReview) => void;
    vi.spyOn(helixAdminApi, 'getOffdeckReview').mockResolvedValueOnce(preparing);
    const read = vi.spyOn(helixAdminApi, 'getOffdeckReviewProgress')
      .mockImplementation(() => new Promise((resolve) => { resolveRead = resolve; }));
    history.replaceState(null, '', '/offdeck?review=review-bulk');
    await act(async () => { render(<SessionProvider><OffdeckPage /></SessionProvider>); });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(read).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(12000); });
    expect(read).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '关闭', exact: true }));
    await act(async () => { resolveRead(highVolumeReview); });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(read).toHaveBeenCalledTimes(1);
    expect(helixAdminApi.listCollection).not.toHaveBeenCalled();
  });


  it('polls only the compact head while preparing and reads fresh scope once ready', async () => {
    vi.useFakeTimers();
    mockWorkbench();
    const preparing = { ...highVolumeReview, state: 'preparing', selection: null };
    const full = vi.spyOn(helixAdminApi, 'getOffdeckReview').mockResolvedValueOnce(preparing).mockResolvedValue(highVolumeReview);
    const progress = vi.spyOn(helixAdminApi, 'getOffdeckReviewProgress')
      .mockResolvedValueOnce({reviewId:'review-bulk',state:'preparing',createdAtMs:1})
      .mockResolvedValueOnce({reviewId:'review-bulk',state:'awaiting_escalation',createdAtMs:1});
    history.replaceState(null, '', '/offdeck?review=review-bulk');
    await act(async () => { render(<SessionProvider><OffdeckPage /></SessionProvider>); });
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(progress).toHaveBeenCalledTimes(1); expect(full).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(progress).toHaveBeenCalledTimes(2); expect(full).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button',{name:'再次确认大批量'})).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(progress).toHaveBeenCalledTimes(2); expect(full).toHaveBeenCalledTimes(2);
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
