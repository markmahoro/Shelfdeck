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
      backgroundOperations: {state:'normal',cadenceMs:30000,lastStartedAtMs:1700000000000,lastCompletedAtMs:1700000000100,
        pendingCount:0,registrations:[{ownerDomain:'people',reconcilerKey:'ondeck-person-evidence',state:'normal',
          lastStartedAtMs:1700000000000,lastCompletedAtMs:1700000000100,processed:0,pendingCount:0,errorCode:null,
          lastResultKind:'no_pending',nextDueAtMs:null}]},
    });
    render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>);
    expect(await screen.findByRole('heading', { level: 1, name: '概览' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /尚未配置/ })).toBeInTheDocument();
    expect(document.querySelector('.system-state')).toHaveAttribute('data-kind', 'unconfigured');
    expect(document.querySelector('.rail-status')).toHaveTextContent('尚未配置');
    expect(screen.getByText('正式收藏')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /还没有文件来源/ })).toBeInTheDocument();
    expect(screen.queryByText('看系统是否就绪、有没有要你处理的事，以及最近上架了什么。')).not.toBeInTheDocument();
    expect(screen.queryByText('当前在收藏架上')).not.toBeInTheDocument();
    expect(screen.queryByText('已发现的电影')).not.toBeInTheDocument();
    expect(screen.queryByText('已检查健康')).not.toBeInTheDocument();
    expect(screen.queryByText('你的收藏，正在被认真照料')).not.toBeInTheDocument();
    expect(screen.queryByText(/持续履职/)).not.toBeInTheDocument();
    expect(screen.queryByText('任务中心')).not.toBeInTheDocument();
    expect(screen.queryByText('收藏运营台')).not.toBeInTheDocument();
    expect(screen.queryByText('本地 Projection')).not.toBeInTheDocument();
    expect(screen.getByText(/后台检查 · 正常/)).toBeInTheDocument();
    expect(screen.queryByText('待处理')).not.toBeInTheDocument();
    expect(screen.getByText('人物信息')).toBeInTheDocument();
    expect(screen.getByText('没有待处理项')).toBeInTheDocument();
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
      backgroundOperations: null,
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
    expect(document.querySelector('.overview-workbench')).not.toBeNull();
  });

  it('keeps running as a status word and puts organizing titles in the left column', async () => {
    vi.spyOn(helixAdminApi, 'getOverview').mockResolvedValue({
      generatedAt: new Date().toISOString(),
      systemState: { kind: 'running', label: '正常运行', href: '/collection' },
      metrics: [
        { key: 'active_collection', label: '正式收藏', value: 12, note: '当前在收藏架上', href: '/collection' },
        { key: 'new_this_month', label: '本月新上架', value: 1, note: '本月完成上架', href: '/collection' },
        { key: 'healthy_collection', label: '健康收藏', value: 11, note: '检查结果为健康', href: '/collection' },
      ],
      todos: [],
      inProgress: { count: 1, label: '正在整理', href: '/formation' },
      setup: { activeMaterialFieldCount: 1, activeShelfCount: 1 },
      ledger: [
        { key: 'ondeck:1', label: '新上架 · Skyfall', href: '/collection' },
        { key: 'progress:2', label: '正在整理 · Lisbon', href: '/formation' },
      ],
      backgroundOperations: {state:'attention',cadenceMs:30000,lastStartedAtMs:1700000000000,lastCompletedAtMs:1700000000100,
        pendingCount:5,registrations:[{ownerDomain:'libra',reconcilerKey:'completed-workspace-reclamation',state:'attention',
          lastStartedAtMs:1700000000000,lastCompletedAtMs:1700000000100,processed:0,pendingCount:5,errorCode:'P9_RUN_LIFECYCLE_TERMINAL',
          lastResultKind:'failed',nextDueAtMs:null}]},
    });
    render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>);
    expect(await screen.findByRole('heading', { level: 1, name: '概览' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '正常运行' })).toHaveClass('system-state-word');
    expect(document.querySelector('.system-state')).toBeNull();
    expect(screen.getByText(/后台检查 · 需要留意/)).toBeInTheDocument();
    expect(screen.queryByText('待处理')).not.toBeInTheDocument();
    expect(screen.queryByText('当前在收藏架上')).not.toBeInTheDocument();
    expect(screen.getByText('现在没有需要你处理的事项')).toBeInTheDocument();
    expect(document.querySelector('.source-empty')).toBeNull();
    expect(screen.getByRole('link', { name: /正在整理 1 部/ })).toHaveAttribute('href', '/formation');
    const actionColumn = screen.getByRole('heading', { name: '需要你处理' }).closest('section');
    expect(actionColumn).toHaveTextContent('Lisbon');
    expect(actionColumn).not.toHaveTextContent('新上架 · Skyfall');
    const ledgerColumn = screen.getByRole('heading', { name: '最近进展' }).closest('section');
    expect(ledgerColumn).toHaveTextContent('新上架 · Skyfall');
    expect(ledgerColumn).not.toHaveTextContent('Lisbon');
    expect(screen.queryByText('01')).not.toBeInTheDocument();
    expect(screen.queryByText('P9_RUN_LIFECYCLE_TERMINAL')).not.toBeInTheDocument();
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
    expect(screen.queryByText('先审阅建议，确认后再授权删除。没有授权不会删除文件。')).not.toBeInTheDocument();
    expect(screen.queryByText(/Closed Condition AST/)).not.toBeInTheDocument();
    expect(screen.queryByText(/建议可以自动生成，销毁必须由你授权/)).not.toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
  });
});
