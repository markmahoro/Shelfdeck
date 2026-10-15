import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import SecondaryWorkshopSettings from '../src/helix/SecondaryWorkshopSettings';
import { helixAdminApi } from '../src/helix/api';

const { expire } = vi.hoisted(() => ({ expire:vi.fn() }));
vi.mock('../src/helix/session', () => ({ useSession: () => ({ expire }), isUnauthorized: () => false }));
const policy = { secondarySeats:5, policyRevision:1, updatedAtMs:1, held:3, free:2 };

it('shows global occupancy and preserves held entries when capacity is saved as zero', async () => {
  vi.spyOn(helixAdminApi, 'getSecondaryWorkshop').mockResolvedValue(policy);
  const save = vi.spyOn(helixAdminApi, 'patchSecondaryWorkshop').mockResolvedValue({ ...policy, secondarySeats:0, free:0, policyRevision:2 });
  render(<SecondaryWorkshopSettings />);
  expect(await screen.findByText('已占用 3 / 5')).toBeVisible();
  const capacity = screen.getByLabelText('共享暂存容量（0–32）');
  fireEvent.change(capacity, { target:{ value:'0' } });
  expect(screen.getByText('已有 3 项继续保留')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name:'保存暂存容量' }));
  await waitFor(() => expect(save).toHaveBeenCalledWith(0));
  expect(await screen.findByText('停止新增转入')).toBeVisible();
  expect(screen.getByText('已占用 3 项')).toBeVisible();
  expect(screen.getByRole('button', { name:'保存暂存容量' })).toBeDisabled();
});

it('keeps invalid drafts and failed saves actionable without reporting success', async () => {
  vi.spyOn(helixAdminApi, 'getSecondaryWorkshop').mockResolvedValue(policy);
  const save = vi.spyOn(helixAdminApi, 'patchSecondaryWorkshop').mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue({ ...policy, secondarySeats:32, free:29, policyRevision:2 });
  render(<SecondaryWorkshopSettings />);
  const capacity = await screen.findByLabelText('共享暂存容量（0–32）');
  for (const value of ['', '-1', '33', '1.5']) {
    fireEvent.change(capacity, { target:{ value } });
    expect(capacity).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name:'保存暂存容量' })).toBeDisabled();
  }
  fireEvent.change(capacity, { target:{ value:'32' } });
  fireEvent.click(screen.getByRole('button', { name:'保存暂存容量' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('暂存容量保存失败，请重试。');
  expect(capacity).toHaveValue(32);
  expect(screen.getByRole('button', { name:'保存暂存容量' })).toBeEnabled();
  expect(screen.queryByText('暂存容量已保存')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name:'保存暂存容量' }));
  expect(await screen.findByRole('status')).toHaveTextContent('暂存容量已保存');
  expect(await screen.findByText('已占用 3 / 32')).toBeVisible();
});

it('retries a failed initial read from the same card', async () => {
  const read = vi.spyOn(helixAdminApi, 'getSecondaryWorkshop').mockRejectedValueOnce(new Error('offline')).mockResolvedValue(policy);
  render(<SecondaryWorkshopSettings />);
  expect(await screen.findByRole('alert')).toHaveTextContent('暂存容量读取失败');
  fireEvent.click(screen.getByRole('button', { name:'重新读取暂存容量' }));
  expect(await screen.findByLabelText('共享暂存容量（0–32）')).toHaveValue(5);
  expect(read).toHaveBeenCalledTimes(2);
});
