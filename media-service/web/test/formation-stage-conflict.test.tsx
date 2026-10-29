import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import App from '../src/App';
import {mockRunningRuntime} from './fixtures/runtime';
import { helixAdminApi, type FormationSubject } from '../src/helix/api';

afterEach(() => vi.restoreAllMocks());

it('offers one direct retry for a deterministic stage collision', async () => {
  mockRunningRuntime();
  const summary = { totalCount: 1, inProgressCount: 0, attentionRequiredCount: 1, completedCount: 0, endedCount: 0 };
  const projection = { status: 'ready' as const, asOfMs: 100 };
  const item = {
    subjectId: 'subject-stage-conflict', displayIdentity: '冲突影片 (2024)', classification: 'attention_required',
    status: 'active', contentProfile: 'movie', addedAtMs: 1, currentRun: null,
    handoffB: { offerId: 'offer-conflict', state: 'published', onDeckPackageId: 'package', packageRevision: 1, packageDigest: 'a'.repeat(64) },
    productIdentityIssue: null, currentPlan: null, myRating: null, targetShelfId: null, targetShelfName: null,
    organizingRequirement: '', routingState: 'resolved', unresolvedReasonCode: null,
    nextAction: { label: '目标位置存在冲突，已停止上架', state: 'attention_required', progress: null },
    executorIssue: { phase: 'on_deck_execution', errorCode: 'CLEAN_ARCA_STAGE_TARGET_OCCUPIED', attemptCount: null, owner: 'arca',
      recoveryState: 'attention_required', recoveryGeneration: null, automaticRecoveryUsed: true, canRetry: false, canRecheck: true,
      offerId: 'offer-conflict', onDeckRunId: 'run-conflict',
      details: { conflicts: [{ target: '/media/Film/冲突影片 (2024)/冲突影片.mkv', name: '冲突影片.mkv' }], conflictCount: 1 } },
  } as unknown as FormationSubject;
  vi.spyOn(helixAdminApi, 'listFormation').mockImplementation((section) => Promise.resolve({
    items: section === 'active' ? [item] : [], summary, nextCursor: null, projection,
  }));
  vi.spyOn(helixAdminApi, 'listFormationHistory').mockResolvedValue({ items: [], summary, nextCursor: null, projection });
  vi.spyOn(helixAdminApi, 'listShelves').mockResolvedValue({ items: [] });
  vi.spyOn(helixAdminApi, 'getPerceptionSyncState').mockRejectedValue(new Error('not configured'));
  vi.spyOn(helixAdminApi, 'listCareWork').mockResolvedValue({ items: [], counts: {}, nextCursor: null });
  vi.spyOn(helixAdminApi, 'listJavCorrectionWork').mockResolvedValue({ items: [], counts: {}, nextCursor: null });

  render(<MemoryRouter initialEntries={['/formation']}><App /></MemoryRouter>);
  expect(await screen.findByText('冲突影片 (2024)')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '处理冲突' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '重试任务' })).not.toBeInTheDocument();
  const retry = vi.spyOn(helixAdminApi, 'retryAcceptance').mockResolvedValue({} as never);
  fireEvent.click(screen.getByRole('button', { name: '重试上架' }));
  await waitFor(() => expect(retry).toHaveBeenCalledWith(item));
  expect(screen.queryByRole('dialog', { name: '处理目标位置冲突' })).not.toBeInTheDocument();
});
