import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OffdeckPage from '../src/helix/OffdeckPage';
import { helixAdminApi, type OffdeckCase, type OffdeckPolicy } from '../src/helix/api';
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

describe('Off-deck progress', () => {
  afterEach(() => vi.restoreAllMocks());

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
});
