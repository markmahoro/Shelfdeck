import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import InputSettlementAuthorization from '../src/helix/InputSettlementAuthorization';
import { helixAdminApi, type SetupReadinessProjection } from '../src/helix/api';
const mocks = vi.hoisted(() => ({ expire: vi.fn() }));
vi.mock('../src/helix/session', () => ({ useSession: () => mocks, isUnauthorized: () => false }));
const state = (enabled: boolean, revision: number, related = true) => ({ data: { standingInputSettlement:
  { enabled, revision, authorizationId: 'standing', authorizationScopeKind: related ? 'old_primary_and_exclusive_related' : 'old_primary_input', coversExclusiveRelatedInput: related } } }) as SetupReadinessProjection;
afterEach(() => vi.restoreAllMocks());
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
async function openAuthorization(status: string) {
  const button = await screen.findByRole('button', { name: `自动清理残留文件 ${status}` });
  fireEvent.click(button);
  expect(await screen.findByRole('dialog', { name: '自动清理残留文件' })).toBeVisible();
  return button;
}
describe('UAT-172 / UAT-258 standing Input Settlement authorization', () => {
  it('shows the real grant and revokes its current revision', async () => {
    vi.spyOn(helixAdminApi, 'getSetupReadiness').mockResolvedValueOnce(state(true, 12)).mockResolvedValue(state(false, 13));
    const command = vi.spyOn(helixAdminApi, 'setInputSettlementAuthorization').mockResolvedValue({});
    render(<InputSettlementAuthorization />);
    await openAuthorization('已授权');
    fireEvent.click(screen.getByRole('button', { name: '撤销授权' }));
    await waitFor(() => expect(command).toHaveBeenCalledWith(false, 12));
    expect(await screen.findByRole('button', { name: '自动清理残留文件 未授权' })).toBeVisible();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText(/全自动|关键步骤确认/)).toBeNull();
  });
  it('requires an explicit action to grant the described old input and exclusive Related scope', async () => {
    vi.spyOn(helixAdminApi, 'getSetupReadiness').mockResolvedValueOnce(state(false, 0)).mockResolvedValue(state(true, 1));
    const command = vi.spyOn(helixAdminApi, 'setInputSettlementAuthorization').mockResolvedValue({});
    render(<InputSettlementAuthorization />);
    await openAuthorization('未授权');
    expect(command).not.toHaveBeenCalled();
    expect(screen.getByText('共享、未知及范围外文件')).toBeVisible();
    expect(screen.getByText('此授权不包含退出收藏时销毁文件。')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '授权自动清理' }));
    await waitFor(() => expect(command).toHaveBeenCalledWith(true, 0));
    expect(await screen.findByRole('button', { name: '自动清理残留文件 已授权' })).toBeVisible();
  });
  it('does not claim exclusive Related coverage for a narrow grant', async () => {
    vi.spyOn(helixAdminApi, 'getSetupReadiness').mockResolvedValue(state(true, 4, false));
    render(<InputSettlementAuthorization />);
    await openAuthorization('部分授权');
    expect(screen.getByText('当前仅授权原片和结构文件，独占关联文件仍保留。')).toBeVisible();
    expect(screen.getByRole('button', { name: '授权全部清理范围' })).toBeVisible();
    expect(screen.getByRole('button', { name: '撤销授权' })).toBeVisible();
  });
  it('does not present a read failure as missing authorization or permit a guessed revision', async () => {
    vi.spyOn(helixAdminApi, 'getSetupReadiness').mockRejectedValue(new Error('offline'));
    const command = vi.spyOn(helixAdminApi, 'setInputSettlementAuthorization');
    render(<InputSettlementAuthorization />);
    await openAuthorization('读取失败');
    expect(screen.getByRole('alert')).toHaveTextContent('无法读取');
    expect(screen.queryByRole('button', { name: '授权自动清理' })).toBeNull();
    expect(screen.getByRole('button', { name: '重新读取授权' })).toBeVisible();
    expect(command).not.toHaveBeenCalled();
  });
  it('retains the last observed state and offers refresh when a command fails', async () => {
    vi.spyOn(helixAdminApi, 'getSetupReadiness').mockResolvedValue(state(true, 4));
    vi.spyOn(helixAdminApi, 'setInputSettlementAuthorization').mockRejectedValue(new Error('授权已变化，请刷新后重试。'));
    render(<InputSettlementAuthorization />);
    await openAuthorization('已授权');
    fireEvent.click(screen.getByRole('button', { name: '撤销授权' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('授权已变化');
    expect(screen.getByRole('button', { name: '自动清理残留文件 已授权' })).toBeVisible();
    expect(screen.getByRole('button', { name: '重新读取授权' })).toBeVisible();
  });
  it('cancels without changing authorization and restores focus to the entry button', async () => {
    vi.spyOn(helixAdminApi, 'getSetupReadiness').mockResolvedValue(state(false, 7));
    const command = vi.spyOn(helixAdminApi, 'setInputSettlementAuthorization');
    render(<InputSettlementAuthorization />);
    const button = await openAuthorization('未授权');
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(button).toHaveFocus();
    expect(command).not.toHaveBeenCalled();
  });
});
