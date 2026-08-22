import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { helixAdminApi } from '../src/helix/api';

describe('Helix Overview product semantics', () => {
  afterEach(() => vi.restoreAllMocks());

  it('opens with a task-oriented collection status heading', async () => {
    vi.spyOn(helixAdminApi, 'getOverview').mockResolvedValue({
      generatedAt: new Date().toISOString(),
      systemState: { kind: 'unconfigured', label: '尚未配置', href: '/material-fields' },
      metrics: [
        { key: 'active_collection', label: '正式收藏', value: 0, note: '当前在收藏架上', href: '/collection' },
        { key: 'new_this_month', label: '本月新上架', value: 0, note: '本月完成上架', href: '/collection' },
        { key: 'healthy_collection', label: '健康收藏', value: 0, note: '检查结果为健康', href: '/collection' },
      ],
      todos: [{ key: 'fields', label: '还没有文件来源', count: 1, href: '/material-fields' }],
      inProgress: null,
      setup: { activeMaterialFieldCount: 0, activeShelfCount: 0 },
      ledger: [],
    });
    render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>);
    expect(await screen.findByRole('heading', { level: 1, name: '概览' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /尚未配置/ })).toBeInTheDocument();
    expect(document.querySelector('.rail-status')).toHaveTextContent('尚未配置');
    expect(screen.getByText('正式收藏')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /还没有文件来源/ })).toBeInTheDocument();
    expect(screen.queryByText('已发现的电影')).not.toBeInTheDocument();
    expect(screen.queryByText('已检查健康')).not.toBeInTheDocument();
    expect(screen.queryByText('你的收藏，正在被认真照料')).not.toBeInTheDocument();
    expect(screen.queryByText(/持续履职/)).not.toBeInTheDocument();
    expect(screen.queryByText('任务中心')).not.toBeInTheDocument();
    expect(screen.queryByText('收藏运营台')).not.toBeInTheDocument();
    expect(screen.queryByText('本地 Projection')).not.toBeInTheDocument();
  });

  it('shows Field access failure as 需要你处理 and a material-fields todo, not 正常运行', async () => {
    vi.spyOn(helixAdminApi, 'getOverview').mockResolvedValue({
      generatedAt: new Date().toISOString(),
      systemState: { kind: 'running', label: '正常运行', href: '/material-fields' },
      metrics: [
        { key: 'active_collection', label: '正式收藏', value: 0, note: '当前在收藏架上', href: '/collection' },
        { key: 'new_this_month', label: '本月新上架', value: 0, note: '本月完成上架', href: '/collection' },
        { key: 'healthy_collection', label: '健康收藏', value: 0, note: '检查结果为健康', href: '/collection' },
      ],
      todos: [{ key: 'field_access', label: '文件来源目录不可用', count: 1, href: '/material-fields' }],
      inProgress: { count: 23, label: '待整理', href: '/formation' },
      setup: { activeMaterialFieldCount: 2, activeShelfCount: 1 },
      ledger: [],
    });
    render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>);
    expect(await screen.findByRole('heading', { level: 1, name: '概览' })).toBeInTheDocument();
    expect(document.querySelector('.rail-status')).toHaveAttribute('data-kind', 'attention');
    expect(document.querySelector('.rail-status')).toHaveTextContent('需要你处理');
    expect(document.querySelector('.system-state')).toHaveAttribute('data-kind', 'attention');
    expect(document.querySelector('.system-state')).toHaveAttribute('href', '/material-fields');
    expect(screen.getAllByText('需要你处理').length).toBeGreaterThan(0);
    expect(screen.getByText('文件来源目录不可用').closest('a')).toHaveAttribute('href', '/material-fields');
    expect(screen.getByText('有文件来源目录不可用，先到来源配置处理')).toBeInTheDocument();
    expect(screen.queryByText('现在没有需要你处理的事项')).not.toBeInTheDocument();
    expect(screen.queryByText('正常运行')).not.toBeInTheDocument();
    expect(screen.getByText(/待整理/).closest('a')).toHaveAttribute('href', '/formation');
  });

  it('presents offdeck as a titled workbench instead of a JSON AST editor', async () => {
    vi.spyOn(helixAdminApi, 'getOffdeckPolicy').mockResolvedValue({
      policyId: 'policy-1', revision: 1, status: 'disabled', duplicateScheduleEnabled: false, entryRules: [], policyDigest: 'd',
    });
    vi.spyOn(helixAdminApi, 'listOffdeckCandidates').mockResolvedValue({ candidates: [], duplicateGroups: [], suppressions: [], whitelists: [] });
    vi.spyOn(helixAdminApi, 'listOffdeckCases').mockResolvedValue({ items: [] });
    vi.spyOn(helixAdminApi, 'listCollection').mockResolvedValue({ items: [] });
    vi.spyOn(helixAdminApi, 'listShelves').mockResolvedValue({ items: [] });
    render(<MemoryRouter initialEntries={['/offdeck']}><App /></MemoryRouter>);
    expect(await screen.findByRole('heading', { level: 1, name: '退出收藏' })).toBeInTheDocument();
    expect(screen.getByText('先审阅建议，确认后再授权删除。没有授权不会删除文件。')).toBeInTheDocument();
    expect(screen.queryByText(/Closed Condition AST/)).not.toBeInTheDocument();
    expect(screen.queryByText(/建议可以自动生成，销毁必须由你授权/)).not.toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
  });
});
