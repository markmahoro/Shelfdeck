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
      metrics: [
        { key: 'active_collection', label: '正式收藏', value: 0, note: '已经上架的电影' },
        { key: 'new_this_month', label: '本月新上架', value: 0, note: '本月完成上架' },
        { key: 'healthy_collection', label: '健康收藏', value: 0, note: '检查结果为健康' },
        { key: 'attention', label: '需要处理', value: 0, note: '健康或退出需要处理' },
      ],
      setup: { activeMaterialFieldCount: 0, activeShelfCount: 0 },
      ledger: [
        { key: 'discovery', label: '已发现的电影', value: 0 },
        { key: 'formation', label: '正在整理', value: 0 },
        { key: 'ondeck', label: '已经上架', value: 0 },
        { key: 'health', label: '已检查健康', value: 0 },
      ],
    });
    render(<MemoryRouter initialEntries={['/']}><App /></MemoryRouter>);
    expect(await screen.findByRole('heading', { level: 1, name: '收藏现状' })).toBeInTheDocument();
    expect(screen.getByText('正式收藏')).toBeInTheDocument();
    expect(screen.queryByText('你的收藏，正在被认真照料')).not.toBeInTheDocument();
    expect(screen.queryByText(/持续履职/)).not.toBeInTheDocument();
    expect(screen.queryByText('任务中心')).not.toBeInTheDocument();
    expect(screen.queryByText('收藏运营台')).not.toBeInTheDocument();
    expect(screen.queryByText('本地 Projection')).not.toBeInTheDocument();
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
