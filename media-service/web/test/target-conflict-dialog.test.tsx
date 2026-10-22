import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import TargetConflictDialog from '../src/helix/TargetConflictDialog';
import { helixAdminApi, type FormationSubject } from '../src/helix/api';

afterEach(() => vi.restoreAllMocks());

it('lists every conflict and requires confirmation before rechecking', async () => {
  const item = {
    displayIdentity: '冲突影片 (2024)',
    executorIssue: {
      phase: 'on_deck_execution', errorCode: 'CLEAN_ARCA_STAGE_TARGET_OCCUPIED', attemptCount: null,
      owner: 'arca', recoveryState: 'attention_required', recoveryGeneration: null, automaticRecoveryUsed: true,
      canRetry: false, canRecheck: true, offerId: 'offer-conflict',
      details: { conflicts: [{ target: '/media/Film/冲突影片 (2024)/冲突影片.mkv', name: '冲突影片.mkv' },
        { target: '/media/Film/冲突影片 (2024)/冲突影片.nfo', name: '冲突影片.nfo' }], conflictCount: 2 },
    },
  } as FormationSubject;
  const retry = vi.spyOn(helixAdminApi, 'retryAcceptance').mockResolvedValue({} as never);
  const complete = vi.fn().mockResolvedValue(undefined);
  const close = vi.fn();
  render(<TargetConflictDialog item={item} onClose={close} onComplete={complete} />);

  expect(screen.getByText('/media/Film/冲突影片 (2024)/冲突影片.mkv')).toBeInTheDocument();
  expect(screen.getByText('/media/Film/冲突影片 (2024)/冲突影片.nfo')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '重试任务' })).not.toBeInTheDocument();
  const recheck = screen.getByRole('button', { name: '重新检查' });
  expect(recheck).toBeDisabled();

  fireEvent.click(screen.getByRole('checkbox', { name: '我已处理上述目标位置' }));
  expect(recheck).toBeEnabled();
  fireEvent.click(recheck);
  await waitFor(() => expect(retry).toHaveBeenCalledWith(item));
  expect(complete).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalledOnce();
});
