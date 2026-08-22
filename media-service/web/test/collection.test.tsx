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
    expect(screen.getByText('整理完成后会显示在这里。')).toBeInTheDocument();
    expect(screen.queryByText(/Handoff B/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Shelf Entry/)).not.toBeInTheDocument();
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
    expect(screen.getByLabelText('The Shawshank Redemption评分')).toBeInTheDocument();
    fireEvent.keyDown(document, { key:'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
