import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import InputSettlementAuthorization from '../src/helix/InputSettlementAuthorization';
import { helixAdminApi, type SetupReadinessProjection } from '../src/helix/api';
const mocks = vi.hoisted(() => ({ expire: vi.fn() }));
vi.mock('../src/helix/session', () => ({ useSession: () => mocks, isUnauthorized: () => false }));
const state = (enabled: boolean, revision: number, related = true) => ({ data: { standingInputSettlement:
  { enabled, revision, authorizationId: 'standing', authorizationScopeKind: related ? 'old_primary_and_exclusive_related' : 'old_primary_input', coversExclusiveRelatedInput: related } } }) as SetupReadinessProjection;
afterEach(() => vi.restoreAllMocks());
describe('UAT-172 standing Input Settlement authorization', () => {
  it('shows the real grant and revokes its current revision', async () => {
    vi.spyOn(helixAdminApi, 'getSetupReadiness').mockResolvedValueOnce(state(true, 12)).mockResolvedValue(state(false, 13));
    const command = vi.spyOn(helixAdminApi, 'setInputSettlementAuthorization').mockResolvedValue({});
    render(<InputSettlementAuthorization />);
    fireEvent.click(await screen.findByRole('button', { name: '撤销持续授权' }));
    await waitFor(() => expect(command).toHaveBeenCalledWith(false, 12));
    expect(await screen.findByText('旧输入自动清理 · 未授权')).toBeTruthy();
    expect(screen.queryByText(/全自动|关键步骤确认/)).toBeNull();
  });
  it('requires an explicit action to grant the described old input and exclusive Related scope', async () => {
    vi.spyOn(helixAdminApi, 'getSetupReadiness').mockResolvedValueOnce(state(false, 0)).mockResolvedValue(state(true, 1));
    const command = vi.spyOn(helixAdminApi, 'setInputSettlementAuthorization').mockResolvedValue({});
    render(<InputSettlementAuthorization />);
    const button = await screen.findByRole('button', { name: '授权安全旧输入自动清理' });
    expect(command).not.toHaveBeenCalled();
    fireEvent.click(button);
    await waitFor(() => expect(command).toHaveBeenCalledWith(true, 0));
    expect(await screen.findByRole('button', { name: '撤销持续授权' })).toBeTruthy();
  });
  it('does not claim exclusive Related coverage for a narrow grant', async () => {
    vi.spyOn(helixAdminApi, 'getSetupReadiness').mockResolvedValue(state(true, 4, false));
    render(<InputSettlementAuthorization />);
    expect(await screen.findByText('当前授权仅包含原片和结构文件，独占关联文件仍会保留。')).toBeTruthy();
    expect(screen.getByRole('button', { name: '授权安全旧输入自动清理' })).toBeTruthy();
  });
  it('does not present a read failure as missing authorization or permit a guessed revision', async () => {
    vi.spyOn(helixAdminApi, 'getSetupReadiness').mockRejectedValue(new Error('offline'));
    const command = vi.spyOn(helixAdminApi, 'setInputSettlementAuthorization');
    render(<InputSettlementAuthorization />);
    expect(await screen.findByRole('alert')).toHaveTextContent('无法读取');
    expect(screen.queryByRole('button', { name: '授权安全旧输入自动清理' })).toBeNull();
    expect(command).not.toHaveBeenCalled();
  });
  it('retains the last observed state and offers refresh when a command fails', async () => {
    vi.spyOn(helixAdminApi, 'getSetupReadiness').mockResolvedValue(state(true, 4));
    vi.spyOn(helixAdminApi, 'setInputSettlementAuthorization').mockRejectedValue(new Error('授权已变化，请刷新后重试。'));
    render(<InputSettlementAuthorization />);
    fireEvent.click(await screen.findByRole('button', { name: '撤销持续授权' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('授权已变化');
    expect(screen.getByText('旧输入自动清理 · 已授权')).toBeTruthy();
    expect(screen.getByRole('button', { name: '刷新授权状态' })).toBeTruthy();
  });
});
