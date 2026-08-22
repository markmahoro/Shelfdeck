import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { helixAdminApi, type RuleTemplate, type Shelf } from '../src/helix/api';
import ShelvesPage from '../src/helix/ShelvesPage';
import { SessionProvider } from '../src/helix/session';

const movieRules = {
  profileRuleSets: [{
    contentProfile: 'movie',
    decisionInputKinds: ['rating'],
    decisionBranches: [
      { conditionKind: 'no_rating' as const, requirements: { mandatoryMedia: { mediaForm: 'stream_file', videoCodec: 'any', minimumRasterClass: 'none', acceptedPrimaryAudioClasses: [] }, space: { maxSizeGiB: null, maxSizeBytes: null } } },
      { conditionKind: 'rating_equals' as const, rating: 1, requirements: { mandatoryMedia: { mediaForm: 'stream_file', videoCodec: 'hevc', minimumRasterClass: 'none', acceptedPrimaryAudioClasses: [] }, space: { maxSizeGiB: 2, maxSizeBytes: 2147483648 } } },
    ],
    profileRuleSetDigest: 'a'.repeat(64),
  }],
};

const template: RuleTemplate = {
  templateId: 'system-beta-recommended',
  name: 'Beta Recommended',
  ownerKind: 'system',
  status: 'active',
  currentRevision: 1,
  current: { revision: 1, rulesDigest: 'b'.repeat(64), rules: movieRules },
};

const shelf: Shelf = {
  shelfId: 'shelf-1',
  name: '电影收藏架',
  status: 'active',
  target: { endpointId: 'ep-1', rootLocation: 'E:\\Movies', mountScopeId: 'ms-1', mountScopeRevision: 1 },
  currentStandardRevision: 1,
  currentPlacementRevision: 1,
  routingProjection: { revision: 1, digest: 'c'.repeat(64) },
  standard: { ruleTemplateId: template.templateId, ruleTemplateRevision: 1, digest: 'd'.repeat(64), value: movieRules },
  placement: {
    revision: 1,
    digest: 'e'.repeat(64),
    value: {
      folderTemplate: '{title} ({year})',
      primaryTemplate: '{stem}{ext}',
      nfoTemplate: '{stem}.nfo',
      subtitleTemplate: '{stem}{language}{forced}{sdh}{ext}',
      posterTemplate: 'poster{ext}',
      fanartTemplate: 'fanart{ext}',
      collisionPolicy: 'reject',
    },
  },
  createdAtMs: 1,
  updatedAtMs: 1,
  deregistrationSummary: {
    entryCount: 3,
    primaryCount: 3,
    controlledMaterialCount: 3,
    responsibilityCounts: { onDeck: 3, offdeck: 0, aftercare: 0, reservations: 0 },
    process: null,
  },
};

function renderShelves() {
  return render(<SessionProvider><ShelvesPage /></SessionProvider>);
}

describe('Shelf Standard and Placement publish', () => {
  afterEach(() => vi.restoreAllMocks());

  function mockCatalog() {
    vi.spyOn(helixAdminApi, 'listShelves').mockResolvedValue({ items: [shelf] });
    vi.spyOn(helixAdminApi, 'listRuleTemplates').mockResolvedValue({ items: [template] });
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
        items: [],
        consequences: [],
      },
      availableActions: [],
    });
  }

  it('lets an existing Movie shelf preview and publish Placement', async () => {
    mockCatalog();
    const preview = vi.spyOn(helixAdminApi, 'previewPlacement').mockResolvedValue({
      previewId: 'preview-1',
      previewDigest: 'f'.repeat(64),
      shelfId: shelf.shelfId,
      expectedPlacementRevision: 1,
      currentTargetDigest: 'g'.repeat(64),
      proposedTarget: shelf.target,
      proposedTargetDigest: 'h'.repeat(64),
      currentPlacementDigest: shelf.placement.digest,
      proposedPlacementDigest: 'i'.repeat(64),
      affectedActiveEntryCount: 3,
      physicalEffect: 'none',
    });
    const publish = vi.spyOn(helixAdminApi, 'publishPlacement').mockResolvedValue({ shelf, replayed: false });
    renderShelves();
    fireEvent.click(await screen.findByRole('button', { name: '调整目录布局' }));
    expect(screen.getByText(/同一收藏项保持不变/)).toBeInTheDocument();
    expect(screen.queryByText(/Placement revision/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '预览影响' }));
    expect(await screen.findByText('将影响 3 部已上架电影')).toBeInTheDocument();
    expect(screen.getByText(/身份保持同一收藏项，不会重新入库/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '发布目录布局' }));
    await waitFor(() => {
      expect(preview).toHaveBeenCalledWith(expect.objectContaining({ shelfId: 'shelf-1' }), expect.objectContaining({ folderTemplate: '{title} ({year})' }), 'E:\\Movies');
      expect(publish).toHaveBeenCalled();
    });
  });

  it('shows the system Movie template as a Chinese read-only option on create-shelf', async () => {
    mockCatalog();
    renderShelves();
    fireEvent.click(await screen.findByRole('button', { name: '新建收藏架' }));
    expect(await screen.findByRole('option', { name: '系统推荐电影标准 · 系统只读' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Beta Recommended/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '复制模板' })).toBeInTheDocument();
  });

  it('copies the read-only system Movie template from create-shelf, publishes a user revision, and selects it', async () => {
    const catalog = { shelves: [] as Shelf[], templates: [template] };
    vi.spyOn(helixAdminApi, 'listShelves').mockImplementation(async () => ({ items: catalog.shelves }));
    vi.spyOn(helixAdminApi, 'listRuleTemplates').mockImplementation(async () => ({ items: catalog.templates }));
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
        items: [],
        consequences: [],
      },
      availableActions: [],
    });
    const copied: RuleTemplate = { ...template, templateId: 'movie-rule-user', name: '电影收藏架 整理标准', ownerKind: 'user', currentRevision: 1 };
    const copy = vi.spyOn(helixAdminApi, 'copyRuleTemplate').mockResolvedValue({
      template: copied,
      draft: { templateId: copied.templateId, draftRevision: 1, basePublishedRevision: 1, rulesDigest: template.current.rulesDigest },
      replayed: false,
    });
    vi.spyOn(helixAdminApi, 'getRuleTemplateDraft').mockResolvedValue({
      templateId: copied.templateId,
      writable: true,
      reasonCode: null,
      draft: {
        templateId: copied.templateId,
        draftRevision: 1,
        basePublishedRevision: 1,
        rulesSchemaRef: 'helix://contracts/policies/ArcaRuleTemplateRules/v1',
        rules: movieRules,
        rulesDigest: template.current.rulesDigest,
        updatedAtMs: 1,
      },
    });
    const revise = vi.spyOn(helixAdminApi, 'reviseRuleTemplateDraft').mockResolvedValue({
      templateId: copied.templateId,
      draftRevision: 2,
      basePublishedRevision: 1,
      rulesSchemaRef: 'helix://contracts/policies/ArcaRuleTemplateRules/v1',
      rules: movieRules,
      rulesDigest: 'j'.repeat(64),
      updatedAtMs: 2,
    });
    const preview = vi.spyOn(helixAdminApi, 'previewRuleTemplate').mockResolvedValue({
      previewId: 'tpl-preview-create',
      previewDigest: 'k'.repeat(64),
      templateId: copied.templateId,
      expectedCurrentRevision: 1,
      expectedDraftRevision: 2,
      expectedDraftDigest: 'j'.repeat(64),
      affectedShelfCount: 0,
      currentEntryPotentialGapCount: 0,
    });
    const bind = vi.spyOn(helixAdminApi, 'bindShelfTemplate');
    const publish = vi.spyOn(helixAdminApi, 'publishRuleTemplate').mockImplementation(async () => {
      const published = { ...copied, currentRevision: 2 };
      catalog.templates = [template, published];
      return { template: published, affectedShelfCount: 0, replayed: false };
    });
    renderShelves();
    fireEvent.click(await screen.findByRole('button', { name: '复制模板' }));
    fireEvent.click(screen.getByRole('button', { name: '预览影响' }));
    expect(await screen.findByText(/将影响 0 部已上架电影/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '发布电影整理标准' }));
    await waitFor(() => {
      expect(copy).toHaveBeenCalled();
      expect(revise).toHaveBeenCalled();
      expect(preview).toHaveBeenCalled();
      expect(publish).toHaveBeenCalled();
      expect(bind).not.toHaveBeenCalled();
    });
    expect(await screen.findByRole('option', { name: '电影收藏架 整理标准', selected: true })).toBeInTheDocument();
  });

  it('copies a system Movie Rule Template, previews affected titles, then publishes and binds', async () => {
    mockCatalog();
    const copied: RuleTemplate = { ...template, templateId: 'movie-rule-user', name: '电影收藏架 整理标准', ownerKind: 'user', currentRevision: 1 };
    const copy = vi.spyOn(helixAdminApi, 'copyRuleTemplate').mockResolvedValue({
      template: copied,
      draft: { templateId: copied.templateId, draftRevision: 1, basePublishedRevision: 1, rulesDigest: template.current.rulesDigest },
      replayed: false,
    });
    vi.spyOn(helixAdminApi, 'getRuleTemplateDraft').mockResolvedValue({
      templateId: copied.templateId,
      writable: true,
      reasonCode: null,
      draft: {
        templateId: copied.templateId,
        draftRevision: 1,
        basePublishedRevision: 1,
        rulesSchemaRef: 'helix://contracts/policies/ArcaRuleTemplateRules/v1',
        rules: movieRules,
        rulesDigest: template.current.rulesDigest,
        updatedAtMs: 1,
      },
    });
    const revise = vi.spyOn(helixAdminApi, 'reviseRuleTemplateDraft').mockResolvedValue({
      templateId: copied.templateId,
      draftRevision: 2,
      basePublishedRevision: 1,
      rulesSchemaRef: 'helix://contracts/policies/ArcaRuleTemplateRules/v1',
      rules: movieRules,
      rulesDigest: 'j'.repeat(64),
      updatedAtMs: 2,
    });
    const preview = vi.spyOn(helixAdminApi, 'previewRuleTemplate').mockResolvedValue({
      previewId: 'tpl-preview-1',
      previewDigest: 'k'.repeat(64),
      templateId: copied.templateId,
      expectedCurrentRevision: 1,
      expectedDraftRevision: 2,
      expectedDraftDigest: 'j'.repeat(64),
      affectedShelfCount: 0,
      currentEntryPotentialGapCount: 0,
    });
    const publish = vi.spyOn(helixAdminApi, 'publishRuleTemplate').mockResolvedValue({
      template: { ...copied, currentRevision: 2 },
      affectedShelfCount: 0,
      replayed: false,
    });
    const bind = vi.spyOn(helixAdminApi, 'bindShelfTemplate').mockResolvedValue({
      binding: { shelfId: shelf.shelfId, standard: { ruleTemplateId: copied.templateId } },
      replayed: false,
    });
    renderShelves();
    fireEvent.click(await screen.findByRole('button', { name: '复制并修改电影整理标准' }));
    fireEvent.click(screen.getByRole('button', { name: '预览影响' }));
    expect(await screen.findByText(/将影响 3 部已上架电影/)).toBeInTheDocument();
    expect(screen.getByText(/本收藏架现有 3 部电影会按新规则重新评估/)).toBeInTheDocument();
    expect(screen.getByText(/收藏健康自动修复/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '发布电影整理标准' }));
    await waitFor(() => {
      expect(copy).toHaveBeenCalled();
      expect(revise).toHaveBeenCalled();
      expect(preview).toHaveBeenCalled();
      expect(publish).toHaveBeenCalled();
      expect(bind).toHaveBeenCalledWith(expect.objectContaining({ shelfId: 'shelf-1' }), expect.objectContaining({ templateId: 'movie-rule-user', currentRevision: 2 }));
    });
  });

  it('binds an already published Movie Rule Template to an existing shelf', async () => {
    mockCatalog();
    const bind = vi.spyOn(helixAdminApi, 'bindShelfTemplate').mockResolvedValue({
      binding: { shelfId: shelf.shelfId, standard: { ruleTemplateId: template.templateId } },
      replayed: false,
    });
    renderShelves();
    fireEvent.click(await screen.findByRole('button', { name: '更换规则模板' }));
    expect(screen.getByText(/身份保持同一收藏项，不会重新入库/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '应用到此收藏架' }));
    await waitFor(() => {
      expect(bind).toHaveBeenCalledWith(expect.objectContaining({ shelfId: 'shelf-1' }), expect.objectContaining({ templateId: 'system-beta-recommended' }));
    });
  });
});
