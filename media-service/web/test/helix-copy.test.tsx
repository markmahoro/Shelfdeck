import { fireEvent, render, screen } from '@testing-library/react';
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
    render(<MemoryRouter initialEntries={['/people']}><App /></MemoryRouter>);
    expect(await screen.findByRole('heading', { level: 1, name: '人物名录' })).toBeInTheDocument();
    expect(screen.getByText(/只读查看已登记人物/)).toBeInTheDocument();
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
    expect(screen.getByText(/管理豆瓣、TMDB 与 MoviePilot 连接，并查阅评分日志/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '豆瓣' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'TMDB' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'MoviePilot' })).toBeInTheDocument();
    expect(document.querySelectorAll('.settings-card')).toHaveLength(3);
    expect(screen.queryByText('连接、空间、资源与安全')).not.toBeInTheDocument();
    expect(ratings).not.toHaveBeenCalled();
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
    expect(screen.queryByRole('button', { name: '放弃本次整理' })).not.toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '整理动作' })).toBeInTheDocument();
  });

  it('does not keep banned slogans on the default chrome', () => {
    render(<MemoryRouter><App /></MemoryRouter>);
    for (const phrase of banned) {
      expect(screen.queryByText(phrase)).not.toBeInTheDocument();
    }
  });
});
