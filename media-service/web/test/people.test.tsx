import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PeoplePage from '../src/helix/PeoplePage';
import { helixAdminApi, type PeopleProjection } from '../src/helix/api';
import { SessionProvider } from '../src/helix/session';

const projection: PeopleProjection = {
  items: [
    {
      personId: 'person-tmdb', status: 'active', currentRevision: 1, canonicalName: '周迅', aliases: ['周迅', 'Zhou Xun'],
      providerIdentities: [{ provider: 'tmdb', namespace: 'tmdb_person', providerKey: '1337' }],
      currentPreferenceRevision: null, currentReferenceRevision: null, createdAtMs: 1,
    },
    {
      personId: 'person-local', status: 'active', currentRevision: 1, canonicalName: 'Local Artist', aliases: [],
      providerIdentities: [], currentPreferenceRevision: null, currentReferenceRevision: null, createdAtMs: 2,
    },
  ],
  nextCursor: null,
  summary: { activePersonCount: 2, mergedPersonCount: 0, openRegistrationCandidateCount: 0, openMergeCandidateCount: 0 },
};

function renderPeople() {
  vi.spyOn(helixAdminApi, 'listPeople').mockResolvedValue(projection);
  vi.spyOn(helixAdminApi, 'listPeopleRegistrationCandidates').mockResolvedValue({ items: [] });
  return render(<SessionProvider><PeoplePage /></SessionProvider>);
}

describe('People contact sheet', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows registered people as accessible cards with Provider identities', async () => {
    renderPeople();
    expect(await screen.findByRole('article', { name: '周迅，已登记' })).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Local Artist，已登记' })).toBeInTheDocument();
    expect(screen.getByText('TMDB · 1337')).toBeInTheDocument();
    expect(screen.getByText('Zhou Xun')).toBeInTheDocument();
  });

  it('loads a protected TMDB avatar lazily and falls back to name initials on failure or missing identity', async () => {
    renderPeople();
    const image = await screen.findByRole('img', { name: '周迅头像' });
    expect(image).toHaveAttribute('src', '/v1/admin/people/person-tmdb/avatar');
    expect(image).toHaveAttribute('loading', 'lazy');
    expect(screen.getByText('LA')).toBeInTheDocument();
    fireEvent.load(image);
    expect(screen.getByText('人物头像已加载')).toBeInTheDocument();
    fireEvent.error(image);
    await waitFor(() => expect(screen.getAllByText('使用姓名首字头像')).toHaveLength(2));
    expect(screen.queryByRole('img', { name: '周迅头像' })).not.toBeInTheDocument();
  });
});
