import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import MaintenanceSettings from '../src/helix/MaintenanceSettings';
import { helixAdminApi, type MaintenanceConfiguration } from '../src/helix/api';
import { SessionProvider } from '../src/helix/session';

const current: MaintenanceConfiguration = { revision: 2, settings: { weekday: 6, startTime: '03:00', endTime: '09:00', timeZone: 'Asia/Shanghai' }, pendingSettings: null };
afterEach(() => vi.restoreAllMocks());

it('saves the next window without changing the current schedule', async () => {
  vi.spyOn(helixAdminApi, 'getMaintenanceConfiguration').mockResolvedValue(current);
  const settings = { ...current.settings, weekday: 1, startTime: '02:00', endTime: '08:00' };
  const save = vi.spyOn(helixAdminApi, 'patchMaintenanceConfiguration').mockResolvedValue({ ...current, revision: 3, pendingSettings: { settings, effectiveAtMs: 1 } });
  render(<SessionProvider><MaintenanceSettings /></SessionProvider>);
  const weekday = await screen.findByLabelText('维护星期');
  expect(weekday).toHaveValue('6'); expect(screen.getByLabelText('开始时间')).toHaveValue('03:00');
  expect(screen.getByRole('button', { name: '保存维护窗口' })).toBeDisabled();
  fireEvent.change(weekday, { target: { value: '1' } });
  fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '02:00' } });
  fireEvent.change(screen.getByLabelText('结束时间'), { target: { value: '08:00' } });
  fireEvent.click(screen.getByRole('button', { name: '保存维护窗口' }));
  await waitFor(() => expect(save).toHaveBeenCalledWith(2, expect.any(String), settings));
  expect(await screen.findByText('维护窗口已保存，下次维护生效。')).toBeVisible();
  expect(screen.getByText('当前：每周六 03:00–09:00')).toBeVisible();
  expect(screen.getByRole('button', { name: '保存维护窗口' })).toBeDisabled();
  expect(screen.queryByText(/维护结果|维护历史|完成数量/)).not.toBeInTheDocument();
});

it('rejects an empty window and permits an overnight draft with actionable save failure', async () => {
  vi.spyOn(helixAdminApi, 'getMaintenanceConfiguration').mockResolvedValue(current);
  const save = vi.spyOn(helixAdminApi, 'patchMaintenanceConfiguration').mockRejectedValue(new Error('维护配置已变化，请刷新后重试。'));
  render(<SessionProvider><MaintenanceSettings /></SessionProvider>);
  await screen.findByLabelText('维护星期');
  fireEvent.change(screen.getByLabelText('结束时间'), { target: { value: '03:00' } });
  expect(screen.getByLabelText('结束时间')).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByRole('button', { name: '保存维护窗口' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('开始时间'), { target: { value: '23:00' } });
  fireEvent.change(screen.getByLabelText('结束时间'), { target: { value: '05:00' } });
  fireEvent.click(screen.getByRole('button', { name: '保存维护窗口' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('维护配置已变化，请刷新后重试。');
  expect(save).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('维护窗口已保存，下次维护生效。')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '重新读取' })).toBeEnabled();
});
