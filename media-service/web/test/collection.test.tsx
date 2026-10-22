import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CollectionPage from '../src/helix/CollectionPage';
import { helixAdminApi, type CollectionEntry } from '../src/helix/api';
import { SessionProvider } from '../src/helix/session';
import {MemoryRouter} from 'react-router-dom';

const entry: CollectionEntry = {
  shelfEntryId: 'entry-1',
  shelfId: 'shelf-1',
  shelfName: 'movie test',
  structureKind: 'single',
  status: 'active',
  canonicalIdentityRevision: 1,
  canonicalIdentityKey: 'tmdb:278',
  provider: 'tmdb',
  providerKey: '278',
  identityKind: 'provider_identity',
  identityDigest: 'a'.repeat(64),
  displayIdentity: 'The Shawshank Redemption',
  year: 1994,
  overview: 'Two imprisoned men form a lasting bond.',
  genres: ['Drama'],
  people: [{ personId:'person-1', displayName:'Tim Robbins', role:'actor' }],
  hasPoster: true,
  hasNfo: true,
  occupancyBytes: 13314398618,
  primaryVideoBytes: 12884901888,
  primaryContainer: 'MKV',
  videoCodec: 'HEVC',
  videoRaster: '2160p',
  health: { state: 'healthy' },
  currentInventoryRevision: 1,
  currentDeckFactRevision: 1,
  createdAtMs: 1,
  terminalAtMs: null,
};

function renderCollection(url='/collection') {
  return render(<MemoryRouter initialEntries={[url]}><SessionProvider><CollectionPage /></SessionProvider></MemoryRouter>);
}

describe('Arca collection poster wall', () => {
  afterEach(() => vi.restoreAllMocks());

  it('keeps the accepted shared retry when the actual collection wall reload fails',async()=>{
    let failReads=false;
    const season={...entry,shelfEntryId:'series-collection-parent',structureKind:'season' as const,series:{seasonNumber:1,episodeCount:0,physicalFileCount:0,episodes:[]}},
      care={shelfEntryId:season.shelfEntryId,health:{state:'attention_required'},basis:{inventoryRevision:1,standardRevision:1,placementRevision:1,careBasisDigest:'d'},history:{assessments:[],findings:[],cases:[],commits:[]},sharedPresentation:{state:'attention_required',canRetry:true,canSupplyImages:false,reasonCode:'series_shared_preparation_failed'}};
    vi.spyOn(helixAdminApi,'listCollection').mockImplementation(async()=>{if(failReads)throw new Error('GET failed');return {items:[season]};});vi.spyOn(helixAdminApi,'listPerceptionRecords').mockResolvedValue({items:[],nextCursor:null,currentRating:null});vi.spyOn(helixAdminApi,'getCare').mockResolvedValue(care as never);
    const post=vi.spyOn(helixAdminApi,'checkCare').mockImplementation(async()=>{failReads=true;return {} as never;});renderCollection();fireEvent.click(await screen.findByRole('button',{name:/查看 The Shawshank Redemption 详情/}));
    fireEvent.click(await screen.findByRole('button',{name:'重试任务',exact:true}));const retry=screen.getByRole('dialog',{name:'重试任务'});fireEvent.click(within(retry).getByRole('button',{name:'重试任务',exact:true}));
    expect(await within(retry).findByRole('alert')).toHaveTextContent('任务已受理，状态读取失败');expect(post).toHaveBeenCalledTimes(1);failReads=false;
    fireEvent.click(within(retry).getByRole('button',{name:'刷新状态',exact:true}));await waitFor(()=>expect(screen.queryByRole('dialog',{name:'重试任务'})).not.toBeInTheDocument());expect(post).toHaveBeenCalledTimes(1);
  });

  it('updates the Actor dialog from the exact current Entry after refresh even when the wall no longer contains it',async()=>{
    const original={...entry,provider:'internal',identityKind:'internal_identity',displayIdentity:'Old Actor Original source'},
      updated={...original,displayIdentity:'New Actor Original source',currentInventoryRevision:2};
    vi.spyOn(helixAdminApi,'listCollection').mockResolvedValueOnce({items:[original]}).mockResolvedValue({items:[]});
    vi.spyOn(helixAdminApi,'getCare').mockResolvedValue({activeCase:null,activeCaseProgress:null,health:{state:'healthy'},basis:{careBasisDigest:'proof'}} as never);
    vi.spyOn(helixAdminApi,'listPeople').mockResolvedValue({items:[],nextCursor:null} as never);
    const read=vi.spyOn(helixAdminApi,'readCollectionEntry').mockResolvedValue(updated);
    vi.spyOn(helixAdminApi,'readInventoryActorRefresh').mockResolvedValue({shelfEntryId:entry.shelfEntryId,expectedInventoryRevision:2,
      expectedRepresentationDigest:'current',currentActor:{personId:'new-actor',displayName:'New Actor'},canRefresh:true,blockingCaseId:null,
      progress:{aftercareCaseId:'completed-case',mode:'specified',state:'resolved',reasonCode:null,works:[]}});
    renderCollection();fireEvent.click(await screen.findByRole('button',{name:/查看 Old Actor Original source 详情/}));
    expect(await screen.findByText('演员库')).toBeVisible();fireEvent.click(screen.getByRole('button',{name:'刷新演员'}));
    const dialog=await screen.findByRole('dialog',{name:'刷新影片演员'});
    expect(await within(dialog).findByText(updated.displayIdentity)).toBeVisible();expect(read).toHaveBeenCalledWith(entry.shelfEntryId);
    expect(within(dialog).queryByText(original.displayIdentity)).not.toBeInTheDocument();
  });

  it('opens an exact related-work link from the current Entry even when it is outside the wall page',async()=>{
    vi.spyOn(helixAdminApi,'listCollection').mockResolvedValue({items:[],resultCount:0,nextCursor:null,shelves:[],summary:{currentCount:1,historyCount:0}});
    const read=vi.spyOn(helixAdminApi,'readCollectionEntry').mockResolvedValue(entry);
    vi.spyOn(helixAdminApi,'getCare').mockResolvedValue({activeCase:null,activeCaseProgress:null,health:{state:'healthy'},basis:{careBasisDigest:'proof'}} as never);
    renderCollection('/collection?entry=entry-1');
    expect(await screen.findByRole('dialog')).toHaveTextContent(entry.displayIdentity);expect(read).toHaveBeenCalledWith('entry-1');
  });

  it('keeps an unread collection unknown when the first request fails', async () => {
    vi.spyOn(helixAdminApi,'listCollection').mockRejectedValue(new Error('读取失败，请重试'));
    renderCollection();
    expect(screen.getByLabelText('收藏数量未知')).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('读取失败，请重试');
    expect(screen.queryByText('还没有正式上架的收藏')).not.toBeInTheDocument();
    expect(screen.queryByText('没有找到符合条件的收藏')).not.toBeInTheDocument();
    expect(screen.queryByText('0 条收藏')).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation',{name:'收藏分页'})).not.toBeInTheDocument();
    expect(screen.getByRole('button',{name:'刷新',exact:true})).toBeEnabled();
  });

  it('UAT-212 replaces pages and navigates back without prefetching history', async () => {
    const second = { ...entry, shelfEntryId:'entry-2', displayIdentity:'Second movie' };
    const list = vi.spyOn(helixAdminApi, 'listCollection').mockImplementation(async query => ({
      items:query?.cursor ? [second] : [entry], resultCount:49,
      nextCursor:query?.cursor ? null : 'next-page', shelves:[], summary:{ currentCount:49, historyCount:0 },
    }));
    renderCollection();
    expect(await screen.findByText(entry.displayIdentity)).toBeInTheDocument();
    expect(list).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name:'下一页' }));
    expect(await screen.findByText('Second movie')).toBeInTheDocument();
    expect(screen.queryByText(entry.displayIdentity)).not.toBeInTheDocument();
    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ cursor:'next-page', limit:48 }));
    fireEvent.click(screen.getByRole('button', { name:'上一页' }));
    expect(await screen.findByText(entry.displayIdentity)).toBeInTheDocument();
    expect(screen.queryByText('Second movie')).not.toBeInTheDocument();
    expect(list).toHaveBeenCalledTimes(3);
  });

  it('distinguishes same-title Seasons by accessible name and opens the selected Season', async () => {
    const seasons = [1, 2].map(seasonNumber => ({ ...entry, shelfEntryId:`season-${seasonNumber}`, structureKind:'season' as const,
      series:{ seasonNumber, episodeCount:0, physicalFileCount:0, episodes:[] } }));
    vi.spyOn(helixAdminApi, 'listCollection').mockResolvedValue({ items:seasons });
    vi.spyOn(helixAdminApi, 'listPerceptionRecords').mockResolvedValue({ items:[], nextCursor:null, currentRating:null });
    vi.spyOn(helixAdminApi, 'getCare').mockResolvedValue({ shelfEntryId:'season-2', health:{state:'never_assessed'}, basis:{inventoryRevision:1,standardRevision:1,placementRevision:1,careBasisDigest:'d'},
      history:{ assessments:[], findings:[], cases:[], commits:[] } });
    renderCollection();
    expect(await screen.findByRole('button', { name:'查看 The Shawshank Redemption 详情，第 1 季，收藏健康：健康' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name:'查看 The Shawshank Redemption 详情，第 2 季，收藏健康：健康' }));
    const dialog=screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { name:'第 2 季 · 已收藏 0 集' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('heading', { name:'第 1 季 · 已收藏 0 集' })).not.toBeInTheDocument();
  });

  it('shows a person once across batch relations while preserving distinct people with the same name', async () => {
    const repeated = { ...entry, people: [
      { personId:'person-1', displayName:'Alex', role:'actor' },
      { personId:'person-1', displayName:'Alex', role:'actor' },
      { personId:'person-1', displayName:'Alex', role:'director' },
      { personId:'person-2', displayName:'Alex', role:'actor' },
      { personId:'', displayName:'Unknown', role:'actor' },
      { personId:'', displayName:'Unknown', role:'actor' },
    ] };
    vi.spyOn(helixAdminApi, 'listCollection').mockResolvedValue({ items:[repeated] });
    renderCollection();
    fireEvent.click(await screen.findByRole('button', { name:/查看 The Shawshank Redemption 详情/ }));
    const dialog = screen.getByRole('dialog', { name:entry.displayIdentity });
    expect(within(dialog).getByText('Alex、Alex、Unknown、Unknown', { exact:true })).toBeInTheDocument();
    expect(repeated.people).toHaveLength(6);
  });

  it('keeps an empty collection concise with its existing controls', async () => {
    vi.spyOn(helixAdminApi, 'listCollection').mockResolvedValue({ items:[] });
    renderCollection();
    expect(await screen.findByText('还没有正式上架的收藏')).toBeInTheDocument();
    expect(screen.queryByText(/只有收藏架验收并提交/)).not.toBeInTheDocument();
    expect(screen.queryByText('只显示已经上架的电影。')).not.toBeInTheDocument();
    expect(screen.queryByText(/Handoff B/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Shelf Entry/)).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '收藏架' })).toHaveValue('');
    expect(screen.getByText('0 条收藏')).toBeInTheDocument();
    expect(screen.queryByText('历史')).not.toBeInTheDocument();
  });

  it('asks the collection query for the selected shelf instead of filtering the wall locally', async () => {
    const list = vi.spyOn(helixAdminApi, 'listCollection').mockResolvedValue({
      items:[entry],
      shelves:[{ shelfId:'shelf-1', name:'movie test', currentCount:1, historyCount:0 }],
      summary:{ currentCount:1, historyCount:0 },
    });
    renderCollection();
    const shelf = await screen.findByRole('combobox', { name: '收藏架' });
    fireEvent.change(shelf, { target: { value: 'shelf-1' } });
    await waitFor(() => {
      expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ shelfId:'shelf-1', status:'current', limit:48 }));
    });
  });

  it('sends search and sort to the bounded Collection query', async () => {
    const list = vi.spyOn(helixAdminApi, 'listCollection').mockResolvedValue({ items:[entry], resultCount:1, nextCursor:null });
    renderCollection();
    await screen.findByText('The Shawshank Redemption');
    fireEvent.change(screen.getByRole('textbox', { name:'搜索收藏' }), { target:{ value:'1994' } });
    fireEvent.click(screen.getByRole('button', { name:'搜索' }));
    fireEvent.change(screen.getByRole('combobox', { name:'排序' }), { target:{ value:'title' } });
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ status:'current', q:'1994', sort:'title', limit:48 })));
  });

  it('opens one Shelf Entry detail from the poster wall and closes it with Escape', async () => {
    vi.spyOn(helixAdminApi, 'listCollection').mockResolvedValue({ items:[entry] });
    vi.spyOn(helixAdminApi, 'listPerceptionRecords').mockResolvedValue({
      items:[],
      nextCursor:null,
      currentRating:null,
    });
    vi.spyOn(helixAdminApi, 'getCare').mockResolvedValue({
      shelfEntryId: entry.shelfEntryId,
      health: { state: 'healthy' },
      basis: { inventoryRevision: 1, standardRevision: 1, placementRevision: 1, careBasisDigest: 'd' },
      activeCaseProgress: null,
      history: { assessments: [], findings: [], cases: [], commits: [] },
    });
    renderCollection();
    const tile = await screen.findByRole('button', {
      name: /查看 The Shawshank Redemption 详情/,
    });
    expect(screen.getByRole('region', { name: '收藏列表' })).toContainElement(tile);
    expect(screen.getByText('第 1 页 · 共 1 条')).toBeInTheDocument();
    expect(document.querySelector('.collection-library-heading > span')).toBeNull();
    expect(screen.queryByText('只显示已经上架的电影。')).not.toBeInTheDocument();
    fireEvent.click(tile);
    const dialog = screen.getByRole('dialog', {
      name:'The Shawshank Redemption',
    });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText('Two imprisoned men form a lasting bond.')).toBeInTheDocument();
    expect(screen.getByText('Tim Robbins')).toBeInTheDocument();
    expect(screen.getByText('占用空间')).toBeInTheDocument();
    expect(screen.getByText('12.4 GB')).toBeInTheDocument();
    expect(screen.getByText(/MKV/)).toBeInTheDocument();
    expect(screen.getByText('HEVC · 2160p')).toBeInTheDocument();
    expect(screen.getByText('有海报 · 有 NFO')).toBeInTheDocument();
    expect(screen.getByLabelText('The Shawshank Redemption评分')).toBeInTheDocument();
    expect(await within(dialog).findByText('健康', { exact: true })).toBeInTheDocument();
    expect(screen.queryByText('当前发现')).not.toBeInTheDocument();
    expect(screen.queryByText('技术标识')).not.toBeInTheDocument();
    expect(screen.queryByText('保管')).not.toBeInTheDocument();
    expect(screen.queryByText('呈现')).not.toBeInTheDocument();
    expect(screen.queryByText('合规')).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key:'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('labels the post-transcode verification stage without presenting it as 100 percent complete', async () => {
    vi.spyOn(helixAdminApi, 'listCollection').mockResolvedValue({ items:[entry] });
    vi.spyOn(helixAdminApi, 'listPerceptionRecords').mockResolvedValue({
      items:[], nextCursor:null, currentRating:null,
    });
    vi.spyOn(helixAdminApi, 'getCare').mockResolvedValue({
      shelfEntryId:entry.shelfEntryId,
      health:{ state:'repairing', dimensions:{} },
      basis:{ inventoryRevision:1, standardRevision:1, placementRevision:1, careBasisDigest:'d' },
      activeCaseProgress:{
        aftercareCaseId:'case-1', stage:'verifying_media', progressPercent:null,
        progress:null, goals:[],
      },
      history:{ assessments:[], findings:[], cases:[], commits:[] },
    });
    renderCollection();
    fireEvent.click(await screen.findByRole('button', {
      name:/查看 The Shawshank Redemption 详情/,
    }));
    expect(await screen.findByText('正在验证媒体')).toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).getByText('维护中')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.queryByText('当前发现')).not.toBeInTheDocument();
  });

  it('shows unhealthy attention as text without a duplicate detail lamp', async () => {
    vi.spyOn(helixAdminApi, 'listCollection').mockResolvedValue({ items:[entry] });
    vi.spyOn(helixAdminApi, 'listPerceptionRecords').mockResolvedValue({
      items:[], nextCursor:null, currentRating:null,
    });
    vi.spyOn(helixAdminApi, 'getCare').mockResolvedValue({
      shelfEntryId:entry.shelfEntryId,
      health:{
        state:'attention_required',
        dimensions:{
          presentation:{ state:'attention_required', findings:[{ findingId:'f1', findingKind:'presentation:nfo_missing', severity:'warning', repairability:'auto_repair', state:'open', createdAtMs:1 }] },
        },
      },
      basis:{ inventoryRevision:1, standardRevision:1, placementRevision:1, careBasisDigest:'d' },
      activeCaseProgress:null,
      history:{ assessments:[], findings:[], cases:[{ aftercareCaseId:'old', state:'unresolved', careBasisDigest:'d', terminalAtMs:2, terminalReasonCode:'reassessment_not_healthy' }], commits:[] },
    });
    renderCollection();
    fireEvent.click(await screen.findByRole('button', {
      name:/查看 The Shawshank Redemption 详情/,
    }));
    const dialog = await screen.findByRole('dialog', { name:'The Shawshank Redemption' });
    expect(within(dialog).getByText('不健康')).toBeInTheDocument();
    expect(within(dialog).queryByText('需要处理')).not.toBeInTheDocument();
    expect(within(dialog).queryByText('presentation:nfo_missing')).not.toBeInTheDocument();
    expect(within(dialog).queryByText('entry-1')).not.toBeInTheDocument();
    expect(within(dialog).queryByText('最近一次自动修复未完成')).not.toBeInTheDocument();
  });

  it('keeps the Owner image-supplement prohibition across the Collection retry transition', async () => {
    const season={...entry,shelfEntryId:'series-collection-prohibited',structureKind:'season' as const,series:{seasonNumber:1,episodeCount:0,physicalFileCount:0,episodes:[]}},
      care={shelfEntryId:season.shelfEntryId,health:{state:'attention_required'},basis:{inventoryRevision:1,standardRevision:1,placementRevision:1,careBasisDigest:'d'},history:{assessments:[],findings:[],cases:[],commits:[]},sharedPresentation:{state:'attention_required',canRetry:true,canSupplyImages:false,reasonCode:'series_shared_preparation_failed'}};
    vi.spyOn(helixAdminApi,'listCollection').mockResolvedValue({items:[season]} as never);
    vi.spyOn(helixAdminApi,'getCare').mockResolvedValue(care as never);
    renderCollection();fireEvent.click(await screen.findByRole('button',{name:/查看 The Shawshank Redemption 详情/}));
    fireEvent.click(await screen.findByRole('button',{name:'重试任务',exact:true}));
    const retry=await screen.findByRole('dialog',{name:'重试任务'});
    expect(within(retry).queryByLabelText(/剧集海报/)).not.toBeInTheDocument();
    expect(within(retry).queryByLabelText(/剧集背景/)).not.toBeInTheDocument();
    expect(within(retry).getByRole('button',{name:'重试任务',exact:true})).toBeEnabled();
  });

  it('keeps image supplementation when the Owner allows it', async () => {
    const season={...entry,shelfEntryId:'series-collection-allowed',structureKind:'season' as const,series:{seasonNumber:1,episodeCount:0,physicalFileCount:0,episodes:[]}},
      care={shelfEntryId:season.shelfEntryId,health:{state:'attention_required'},basis:{inventoryRevision:1,standardRevision:1,placementRevision:1,careBasisDigest:'d'},history:{assessments:[],findings:[],cases:[],commits:[]},sharedPresentation:{state:'attention_required',canRetry:true,canSupplyImages:true,reasonCode:'series_shared_preparation_failed'}};
    vi.spyOn(helixAdminApi,'listCollection').mockResolvedValue({items:[season]} as never);
    vi.spyOn(helixAdminApi,'getCare').mockResolvedValue(care as never);
    renderCollection();fireEvent.click(await screen.findByRole('button',{name:/查看 The Shawshank Redemption 详情/}));
    fireEvent.click(await screen.findByRole('button',{name:'重试任务',exact:true}));
    const retry=await screen.findByRole('dialog',{name:'重试任务'});
    expect(within(retry).getByLabelText(/剧集海报/)).toBeEnabled();
    expect(within(retry).getByLabelText(/剧集背景/)).toBeEnabled();
  });
});
