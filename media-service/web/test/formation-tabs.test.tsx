import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import App from '../src/App';
import {mockRunningRuntime} from './fixtures/runtime';
import { helixAdminApi } from '../src/helix/api';

afterEach(() => vi.restoreAllMocks());

it('keeps the status counts mounted while switching back to all is still loading', async () => {
  mockRunningRuntime();
  const summary = { totalCount: 0, inProgressCount: 0, attentionRequiredCount: 0, completedCount: 0, endedCount: 0 };
  const projection = { status: 'ready' as const, asOfMs: 100 };
  const emptyPage = { items: [], summary, nextCursor: null, projection };
  let hold = false;
  const pending = <T,>() => new Promise<T>(() => {});
  vi.spyOn(helixAdminApi, 'listFormation').mockImplementation(() => hold ? pending() : Promise.resolve(emptyPage));
  vi.spyOn(helixAdminApi, 'listFormationHistory').mockImplementation(() => hold ? pending() : Promise.resolve(emptyPage));
  vi.spyOn(helixAdminApi, 'listShelves').mockResolvedValue({ items: [] });
  vi.spyOn(helixAdminApi, 'getPerceptionSyncState').mockRejectedValue(new Error('not configured'));
  vi.spyOn(helixAdminApi, 'listCareWork').mockImplementation(() => hold ? pending() : Promise.resolve({ items: [], counts: {}, nextCursor: null }));
  vi.spyOn(helixAdminApi, 'listJavCorrectionWork').mockImplementation(() => hold ? pending() : Promise.resolve({ items: [], counts: {}, nextCursor: null }));

  render(<MemoryRouter initialEntries={['/formation']}><App /></MemoryRouter>);
  await screen.findByRole('group', { name: '媒体整理状态' });

  fireEvent.click(screen.getByRole('button', { name: '已结束 0' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '已结束 0' })).toHaveAttribute('aria-pressed', 'true'));

  hold = true;
  fireEvent.click(screen.getByRole('button', { name: '全部 0' }));
  await new Promise((resolve) => setTimeout(resolve, 150));
  expect(screen.queryByText('正在读取媒体整理工作区…')).not.toBeInTheDocument();
  expect(screen.getByRole('group', { name: '媒体整理状态' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '全部 0' })).toHaveAttribute('aria-pressed', 'true');
});
