import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CollectionPage from '../src/helix/CollectionPage';
import { helixAdminApi, type CollectionEntry } from '../src/helix/api';
import { SessionProvider } from '../src/helix/session';

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

function renderCollection() {
  return render(<SessionProvider><CollectionPage /></SessionProvider>);
}

describe('Arca collection poster wall', () => {
  afterEach(() => vi.restoreAllMocks());

  it('explains the empty state before any collection exists', async () => {
    vi.spyOn(helixAdminApi, 'listCollection').mockResolvedValue({ items:[] });
    renderCollection();
    expect(await screen.findByText('还没有正式上架的电影')).toBeInTheDocument();
    expect(screen.getByText('只有收藏架验收并提交之后才会出现在这里。媒体整理工作区里的条目还不算上架。')).toBeInTheDocument();
    expect(screen.queryByText(/Handoff B/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Shelf Entry/)).not.toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: '收藏架' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '全部 0' })).toBeInTheDocument();
  });

  it('asks the collection query for the selected shelf instead of filtering the wall locally', async () => {
    const list = vi.spyOn(helixAdminApi, 'listCollection').mockResolvedValue({
      items:[entry],
      shelves:[{ shelfId:'shelf-1', name:'movie test', currentCount:1, historyCount:0 }],
      summary:{ currentCount:1, historyCount:0 },
    });
    renderCollection();
    expect(await screen.findByRole('button', { name: /movie test/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /movie test/ }));
    await waitFor(() => {
      expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ shelfId:'shelf-1', status:'current' }));
    });
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
    expect(screen.getByText('1 部')).toBeInTheDocument();
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
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });
});
