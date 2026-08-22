import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { helixAdminApi, type FormationSubject } from '../src/helix/api';

const banned = [
  '你的收藏，正在被认真照料',
  '只看系统能否持续履职',
  '访问合同',
  '候选包已被收藏生产接收',
  '收藏运营台',
  '本地 Projection',
  'Closed Condition AST',
  '上架进度',
];

function completedSubject(): FormationSubject {
  return {
    formationViewId: 'subject-1',
    subjectId: 'subject-1',
    displayIdentity: '示例电影 (2024)',
    contentProfile: 'movie',
    structureKind: 'single',
    status: 'active',
    classification: 'completed',
    myRating: 4,
    myRatingSource: 'douban',
    myRatingRevision: 1,
    productIdentityIssue: null,
    executorIssue: null,
    primaryMaterialCount: 1,
    addedAtMs: 1,
    organizingRequirement: 'HEVC · 4k',
    organizingAction: '封装整理',
    organizingSteps: [{ key: 'remux', label: '封装整理', state: 'done', progress: null }],
    nextAction: { label: '已进入收藏架', state: 'completed', progress: null },
    routingState: 'resolved',
    routingPolicyMode: 'direct',
    routingPolicyRevision: 1,
    targetShelfId: 'shelf-1',
    targetShelfName: '电影收藏架',
    unresolvedReasonCode: null,
    routingDecisionRevision: 1,
    routingDecisionDigest: 'd',
    routingDecisionHeadRevision: 1,
    routingDecisionHeadDigest: 'h',
    acceptanceSpecId: 'spec',
    acceptanceSpecRevision: 1,
    acceptanceSpecDigest: 's',
    acceptanceSpecPublishedAtMs: 1,
    productionStage: null,
    currentRun: null,
    handoffB: null,
    completedAtMs: 2,
  };
}

describe('Helix primary copy and workbench structure', () => {
  afterEach(() => vi.restoreAllMocks());

  it('uses honest people and settings claims', async () => {
    vi.spyOn(helixAdminApi, 'listPeople').mockResolvedValue({
      items: [],
      nextCursor: null,
      summary: { activePersonCount: 0, mergedPersonCount: 0, openRegistrationCandidateCount: 0, openMergeCandidateCount: 0 },
    });
    vi.spyOn(helixAdminApi, 'listPeopleRegistrationCandidates').mockResolvedValue({ items: [] });
    render(<MemoryRouter initialEntries={['/people']}><App /></MemoryRouter>);
    expect(await screen.findByRole('heading', { level: 1, name: '人物' })).toBeInTheDocument();
    expect(screen.getByText(/名录是已经登记的人，不是某部电影的演员表/)).toBeInTheDocument();
    expect(screen.queryByText('维护人物身份，而不是改写媒体演职员事实')).not.toBeInTheDocument();
  });

  it('describes settings as connections plus rating log', async () => {
    vi.spyOn(helixAdminApi, 'getIntegration').mockResolvedValue({
      kind: 'douban', supported: true, configured: false, state: 'idle', configRevision: 0,
      endpoint: null, configDigest: null, capabilityCodes: [], lastTestSummary: null, landingBinding: null,
    });
    const ratings = vi.spyOn(helixAdminApi, 'listPerceptionRecords');
    render(<MemoryRouter initialEntries={['/settings']}><App /></MemoryRouter>);
    expect(await screen.findByRole('heading', { level: 1, name: '系统设置' })).toBeInTheDocument();
    expect(screen.getByText(/管理连接、自动运营与评分日志/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '豆瓣' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'TMDB' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'MoviePilot' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '自动运营' })).toBeInTheDocument();
    expect(document.querySelectorAll('.settings-card')).toHaveLength(3);
    expect(screen.queryByText('连接、空间、资源与安全')).not.toBeInTheDocument();
    expect(ratings).not.toHaveBeenCalled();
  });

  it('lets the librarian choose 全自动 or 关键步骤确认 and keeps Off-deck independently disabled', async () => {
    vi.spyOn(helixAdminApi, 'getIntegration').mockResolvedValue({
      kind: 'douban', supported: true, configured: false, state: 'idle', configRevision: 0,
      endpoint: null, configDigest: null, capabilityCodes: [], lastTestSummary: null, landingBinding: null,
    });
    vi.spyOn(helixAdminApi, 'getAutomaticOperation').mockResolvedValue({
      projectionVersion: 1,
      asOf: '2026-08-22T00:00:00.000Z',
      freshness: 'fresh',
      data: {
        productChoice: 'key_step_confirmation',
        fullAutoReady: false,
        productChoiceLabel: '关键步骤确认',
        fullAutoReadyLabel: '全自动尚未就绪',
        standingInputSettlement: null,
        offdeckDestruction: { independentlyDisabled: true, grantedByFullAuto: false, label: '退出收藏销毁保持独立关闭' },
        items: [{ key: 'standing_authorization', owner: 'arca', ready: false, label: '上架旧输入仍需每次确认', href: '/settings' }],
        consequences: [
          { owner: 'arca', topic: 'input_settlement', text: '其余自动化保持不变，但每次上架处理旧输入文件前都要确认当前冻结范围。' },
          { owner: 'arca_offdeck', topic: 'offdeck_destruction', text: '退出收藏的物理销毁保持独立关闭，与此选择无关。' },
        ],
      },
      availableActions: [{ actionCode: 'enable_full_automatic_operation', label: '启用全自动', expectedRevision: 0, requiresConfirmation: false }],
    });
    render(<MemoryRouter initialEntries={['/settings']}><App /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('tab', { name: '自动运营' }));
    expect(await screen.findByRole('heading', { level: 2, name: '自动运营' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /全自动（推荐）/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /关键步骤确认/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '启用全自动' })).toBeInTheDocument();
    expect(screen.getByText(/每次上架处理旧输入文件前都要确认/)).toBeInTheDocument();
    expect(screen.getByText('退出收藏销毁保持独立关闭')).toBeInTheDocument();
  });

  it('renders completed history as read-only organizing results', async () => {
    vi.spyOn(helixAdminApi, 'listFormation').mockImplementation(async (section) => {
      if (section === 'completed') {
        return {
          items: [completedSubject()],
          summary: { totalCount: 1, pendingCount: 0, inProgressCount: 0, attentionRequiredCount: 0, completedCount: 1 },
          nextCursor: null,
          projection: { status: 'ready', asOfMs: 1 },
        };
      }
      return {
        items: [],
        summary: { totalCount: 1, pendingCount: 0, inProgressCount: 0, attentionRequiredCount: 0, completedCount: 1 },
        nextCursor: null,
        projection: { status: 'ready', asOfMs: 1 },
      };
    });
    vi.spyOn(helixAdminApi, 'listShelves').mockResolvedValue({ items: [] });
    render(<MemoryRouter initialEntries={['/formation']}><App /></MemoryRouter>);
    expect(await screen.findByRole('heading', { level: 1, name: '媒体整理工作区' })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: '展开（1）' }));
    expect(await screen.findByText('封装整理')).toBeInTheDocument();
    expect(screen.queryByText('尚未形成整理动作')).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: '下一步' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: '分步进度' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: '用户操作' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: '加急' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '放弃本次整理' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '加快整理' })).not.toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '整理动作' })).toBeInTheDocument();
  });

  it('renders current media as stacked steps, progress, user actions, and expedite', async () => {
    const current: FormationSubject = {
      ...completedSubject(),
      classification: 'in_progress',
      organizingAction: 'GPU转码 · HEVC · 4k · 不超过 20 GiB',
      organizingSteps: [{
        key: 'transcode',
        label: 'GPU转码 · HEVC · 4k · 不超过 20 GiB',
        state: 'running',
        progress: { mode: 'determinate', currentValue: 40, totalValue: 100, unit: 'percent', rate: null, etaMs: null, bucket: 'transcode' },
      }],
      nextAction: { label: '继续整理媒体', state: 'running', progress: null },
      currentRun: {
        libraRunId: 'run-1', state: 'active', stateRevision: 1, stateDigest: 'd',
        priorityClass: 'normal', packageRevisionHead: 0, currentIdentityRevision: 1,
      },
      completedAtMs: null,
    };
    vi.spyOn(helixAdminApi, 'listFormation').mockResolvedValue({
      items: [current],
      summary: { totalCount: 1, pendingCount: 0, inProgressCount: 1, attentionRequiredCount: 0, completedCount: 0 },
      nextCursor: null,
      projection: { status: 'ready', asOfMs: 1 },
    });
    vi.spyOn(helixAdminApi, 'listShelves').mockResolvedValue({ items: [] });
    render(<MemoryRouter initialEntries={['/formation']}><App /></MemoryRouter>);
    expect(await screen.findByRole('columnheader', { name: '整理动作' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '分步进度' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '用户操作' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '加急' })).toBeInTheDocument();
    expect(screen.getByText('GPU转码 · HEVC · 4k · 不超过 20 GiB')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '加快整理' })).toBeInTheDocument();
    expect(screen.queryByText('尚未形成整理动作')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /全部当前/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /待整理/ })).toBeInTheDocument();
    expect(screen.getByLabelText('按片名筛选')).toBeInTheDocument();
    expect(screen.getByLabelText('按收藏架筛选')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /待整理/ }));
    await waitFor(() => {
      expect(helixAdminApi.listFormation).toHaveBeenLastCalledWith('active', undefined, expect.objectContaining({ classification: 'pending' }));
    });
  });

  it('does not keep banned slogans on the default chrome', () => {
    render(<MemoryRouter><App /></MemoryRouter>);
    for (const phrase of banned) {
      expect(screen.queryByText(phrase)).not.toBeInTheDocument();
    }
  });
});
