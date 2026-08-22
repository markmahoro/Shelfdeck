import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  AdminApiError,
  canonicalDigest,
  helixAdminApi,
  type MovieRuleBranch,
  type PlacementPreview,
  type RuleTemplate,
  type RuleTemplateDraft,
  type RuleTemplatePreview,
  type RuleTemplateRules,
  type Shelf,
  type ShelfPlacementPolicy,
} from './api';
import AutomaticOperationPanel from './AutomaticOperationPanel';
import { Button, LoadingState, PageHeader } from './chrome';
import { isUnauthorized, useSession } from './session';

const HIGH_QUALITY_AUDIO = ['dts_hd_ma', 'dts_x', 'eac3_atmos', 'truehd', 'truehd_atmos'];
const DEFAULT_PLACEMENT: ShelfPlacementPolicy = {
  folderTemplate: '{title} ({year})',
  primaryTemplate: '{stem}{ext}',
  nfoTemplate: '{stem}.nfo',
  subtitleTemplate: '{stem}{language}{forced}{sdh}{ext}',
  posterTemplate: 'poster{ext}',
  fanartTemplate: 'fanart{ext}',
  collisionPolicy: 'reject',
};

type MovieRuleEdit = {
  conditionKind: MovieRuleBranch['conditionKind'];
  rating?: number;
  hevc: boolean;
  fourK: boolean;
  highQualityAudio: boolean;
  maxSizeGiB: string;
};

function newShelfId() {
  return `movie-shelf-${crypto.randomUUID()}`;
}
function branchLabel(branch: { conditionKind: MovieRuleBranch['conditionKind']; rating?: number }) {
  return branch.conditionKind === 'no_rating' ? '未评分' : `${branch.rating}星`;
}
function mediaLabel(branch: MovieRuleBranch) {
  const media = branch.requirements.mandatoryMedia;
  const parts = ['可播放文件'];
  if (media.videoCodec === 'hevc') parts.push('HEVC');
  if (media.minimumRasterClass === '4k') parts.push('4K');
  if (media.acceptedPrimaryAudioClasses.length > 0) parts.push('高质量主音轨');
  return parts.join(' · ');
}
function spaceLabel(branch: MovieRuleBranch) {
  return branch.requirements.space.maxSizeGiB === null ? '不按评分限制空间' : `最多 ${branch.requirements.space.maxSizeGiB} GiB`;
}
function movieRules(value: { profileRuleSets: { contentProfile: string; decisionBranches: MovieRuleBranch[] }[] }) {
  return value.profileRuleSets.find((item) => item.contentProfile === 'movie')?.decisionBranches || [];
}
function renderPreview(template: string, values: Record<string, string>) {
  return template.replace(/\{([^{}]+)\}/g, (_match, token) => values[token] || '');
}
function shelfStatusLabel(status: Shelf['status']) {
  if (status === 'active') return '可接收整理结果';
  if (status === 'deregistering') return '正在注销';
  return '已注销';
}
function commandError(cause: unknown, fallback: string) {
  if (!(cause instanceof Error)) return fallback;
  const reasonCode = cause instanceof AdminApiError && typeof cause.details.reasonCode === 'string' ? cause.details.reasonCode : '';
  return `${cause.message}${reasonCode ? `（${reasonCode}）` : ''}`;
}
function editsFromBranches(branches: MovieRuleBranch[]): MovieRuleEdit[] {
  return branches.map((branch) => ({
    conditionKind: branch.conditionKind,
    rating: branch.rating,
    hevc: branch.requirements.mandatoryMedia.videoCodec === 'hevc',
    fourK: branch.requirements.mandatoryMedia.minimumRasterClass === '4k',
    highQualityAudio: branch.requirements.mandatoryMedia.acceptedPrimaryAudioClasses.length > 0,
    maxSizeGiB: branch.requirements.space.maxSizeGiB == null ? '' : String(branch.requirements.space.maxSizeGiB),
  }));
}
async function applyMovieEdits(rules: RuleTemplateRules, edits: MovieRuleEdit[]): Promise<RuleTemplateRules> {
  const next = structuredClone(rules);
  const movie = next.profileRuleSets.find((item) => item.contentProfile === 'movie');
  if (!movie) throw new Error('当前规则模板没有电影整理标准。');
  if (movie.decisionBranches.length !== edits.length) throw new Error('电影整理标准与当前草稿不一致，请刷新后重试。');
  movie.decisionBranches = movie.decisionBranches.map((branch, index) => {
    const edit = edits[index];
    const raw = edit.maxSizeGiB.trim();
    const maxSizeGiB = raw === '' ? null : Number(raw);
    if (maxSizeGiB !== null && (!Number.isFinite(maxSizeGiB) || maxSizeGiB <= 0)) {
      throw new Error(`${branchLabel(edit)} 的空间上限必须为空或不小于 1 GiB。`);
    }
    const space = maxSizeGiB === null
      ? { ...branch.requirements.space, maxSizeGiB: null, maxSizeBytes: null }
      : { ...branch.requirements.space, maxSizeGiB, maxSizeBytes: maxSizeGiB * 1073741824 };
    return {
      ...branch,
      requirements: {
        ...branch.requirements,
        mandatoryMedia: {
          ...branch.requirements.mandatoryMedia,
          videoCodec: edit.hevc ? 'hevc' : 'any',
          minimumRasterClass: edit.fourK ? '4k' : 'none',
          acceptedPrimaryAudioClasses: edit.highQualityAudio ? [...HIGH_QUALITY_AUDIO] : [],
        },
        space,
      },
    };
  });
  const noRating = movie.decisionBranches.find((item) => item.conditionKind === 'no_rating');
  if (noRating) movie.baseRequirements = structuredClone(noRating.requirements) as typeof movie.baseRequirements;
  const unsigned = Object.fromEntries(Object.entries(movie).filter(([key]) => key !== 'profileRuleSetDigest'));
  movie.profileRuleSetDigest = await canonicalDigest(unsigned as never);
  return next;
}
function reassessmentCopy(entryCount: number, extraShelves = 0) {
  const titles = entryCount === 0
    ? '当前没有已上架电影。发布后，以后上架的电影会按新规则验收。'
    : `本收藏架现有 ${entryCount} 部电影会按新规则重新评估，身份保持同一收藏项，不会重新入库。能直接修好的差异会进入收藏健康自动修复，其余会标为需要处理。`;
  return extraShelves > 0 ? `${titles} 另有 ${extraShelves} 座已使用同一规则模板的收藏架会同步跟随。` : titles;
}

function MovieRuleEditor({ edits, onChange }: { edits: MovieRuleEdit[]; onChange: (value: MovieRuleEdit[]) => void }) {
  function replace(index: number, value: MovieRuleEdit) {
    onChange(edits.map((item, ordinal) => (ordinal === index ? value : item)));
  }
  return <div className="movie-rule-grid movie-rule-editor">{edits.map((edit, index) => <div key={`${edit.conditionKind}-${edit.rating || 0}`}>
    <b>{branchLabel(edit)}</b>
    <label><input type="checkbox" checked={edit.hevc} onChange={(event) => replace(index, { ...edit, hevc: event.target.checked })} /><span>HEVC</span></label>
    <label><input type="checkbox" checked={edit.fourK} onChange={(event) => replace(index, { ...edit, fourK: event.target.checked })} /><span>4K</span></label>
    <label><input type="checkbox" checked={edit.highQualityAudio} onChange={(event) => replace(index, { ...edit, highQualityAudio: event.target.checked })} /><span>高质量主音轨</span></label>
    <label><span>空间上限 GiB</span><input type="number" min={1} step={1} placeholder="不限制" value={edit.maxSizeGiB} onChange={(event) => replace(index, { ...edit, maxSizeGiB: event.target.value })} /></label>
  </div>)}</div>;
}

function PlacementFields({ placement, onChange }: { placement: ShelfPlacementPolicy; onChange: (value: ShelfPlacementPolicy) => void }) {
  return <>
    <label><span>目录命名</span><input value={placement.folderTemplate} onChange={(event) => onChange({ ...placement, folderTemplate: event.target.value })} required /></label>
    <label><span>主视频命名</span><input value={placement.primaryTemplate} onChange={(event) => onChange({ ...placement, primaryTemplate: event.target.value })} required /></label>
    <label><span>资料文件命名</span><input value={placement.nfoTemplate} onChange={(event) => onChange({ ...placement, nfoTemplate: event.target.value })} required /></label>
    <label><span>字幕命名</span><input value={placement.subtitleTemplate} onChange={(event) => onChange({ ...placement, subtitleTemplate: event.target.value })} required /></label>
    <label><span>海报命名</span><input value={placement.posterTemplate} onChange={(event) => onChange({ ...placement, posterTemplate: event.target.value })} required /></label>
    <label><span>背景图命名</span><input value={placement.fanartTemplate} onChange={(event) => onChange({ ...placement, fanartTemplate: event.target.value })} required /></label>
    <label><span>名称冲突</span><select value={placement.collisionPolicy} onChange={(event) => onChange({ ...placement, collisionPolicy: event.target.value as ShelfPlacementPolicy['collisionPolicy'] })}><option value="reject">拒绝并等待处理</option><option value="suffix">添加确定性后缀</option></select></label>
  </>;
}

function namingPreview(placement: ShelfPlacementPolicy) {
  return <>
    <strong>保存前预览 · 示例电影 (2026)</strong>
    <span>{renderPreview(placement.folderTemplate, { title: '示例电影', year: '2026' })}</span>
    <small>{[
      renderPreview(placement.primaryTemplate, { stem: '示例电影 (2026)', ext: '.mkv' }),
      renderPreview(placement.nfoTemplate, { stem: '示例电影 (2026)', ext: '.nfo' }),
      renderPreview(placement.subtitleTemplate, { stem: '示例电影 (2026)', language: '.zh-CN', forced: '.forced', sdh: '.sdh', ext: '.srt' }),
      renderPreview(placement.posterTemplate, { ext: '.jpg' }),
      renderPreview(placement.fanartTemplate, { ext: '.jpg' }),
    ].join(' · ')}</small>
  </>;
}

export default function ShelvesPage() {
  const { expire } = useSession();
  const [shelves, setShelves] = useState<Shelf[]>([]);
  const [templates, setTemplates] = useState<RuleTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [shelfId, setShelfId] = useState(newShelfId);
  const [name, setName] = useState('电影收藏架');
  const [targetRootLocation, setTargetRootLocation] = useState('');
  const [templateId, setTemplateId] = useState('system-beta-recommended');
  const [placement, setPlacement] = useState<ShelfPlacementPolicy>({ ...DEFAULT_PLACEMENT });
  const [confirmShelf, setConfirmShelf] = useState<Shelf | null>(null);
  const [enteredShelfName, setEnteredShelfName] = useState('');
  const [preserveFilesAcknowledged, setPreserveFilesAcknowledged] = useState(false);
  const [releaseControlAcknowledged, setReleaseControlAcknowledged] = useState(false);
  const [placementShelf, setPlacementShelf] = useState<Shelf | null>(null);
  const [placementDraft, setPlacementDraft] = useState<ShelfPlacementPolicy>({ ...DEFAULT_PLACEMENT });
  const [placementTarget, setPlacementTarget] = useState('');
  const [placementPreview, setPlacementPreview] = useState<PlacementPreview | null>(null);
  const [bindShelf, setBindShelf] = useState<Shelf | null>(null);
  const [bindTemplateId, setBindTemplateId] = useState('');
  const [standardShelf, setStandardShelf] = useState<Shelf | null>(null);
  const [copyName, setCopyName] = useState('');
  const [movieEdits, setMovieEdits] = useState<MovieRuleEdit[]>([]);
  const [standardPreview, setStandardPreview] = useState<RuleTemplatePreview | null>(null);
  const [preparedDraft, setPreparedDraft] = useState<{ template: RuleTemplate; draft: RuleTemplateDraft } | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [shelfResult, templateResult] = await Promise.all([helixAdminApi.listShelves(), helixAdminApi.listRuleTemplates()]);
      setShelves(shelfResult.items);
      setTemplates(templateResult.items);
      const recommended = templateResult.items.find((item) => item.templateId === 'system-beta-recommended' && item.status === 'active');
      if (recommended) setTemplateId(recommended.templateId);
      if (shelfResult.items.length === 0) setShowCreate(true);
    } catch (cause) {
      if (isUnauthorized(cause)) expire();
      else setError(cause instanceof Error ? cause.message : '收藏架读取失败。');
    } finally { setLoading(false); }
  }, [expire]);
  useEffect(() => { void load(); }, [load]);

  const activeTemplates = useMemo(() => templates.filter((item) => item.status === 'active'), [templates]);
  const selectedTemplate = activeTemplates.find((item) => item.templateId === templateId);
  const activeShelves = shelves.filter((item) => item.status === 'active');
  function templateLabel(id: string) {
    if (id === 'system-beta-recommended') return '系统推荐';
    return templates.find((item) => item.templateId === id)?.name || id;
  }

  async function createShelf(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || !targetRootLocation.trim() || !selectedTemplate) {
      setError('请填写收藏架名称、实际目标目录并选择可用规则模板。');
      return;
    }
    setLoading(true); setError(''); setNotice('');
    try {
      await helixAdminApi.createShelf({
        idempotencyKey: `shelf:${shelfId}:create:v1`,
        shelfId,
        name: name.trim(),
        targetRootLocation: targetRootLocation.trim(),
        ruleTemplateId: selectedTemplate.templateId,
        expectedTemplateRevision: selectedTemplate.currentRevision,
        placementPolicy: Object.fromEntries(Object.entries(placement).map(([key, value]) => [key, value.trim()])),
      });
      setShelfId(newShelfId());
      setName('电影收藏架');
      setTargetRootLocation('');
      setPlacement({ ...DEFAULT_PLACEMENT });
      setShowCreate(false);
      await load();
    } catch (cause) {
      if (isUnauthorized(cause)) expire();
      else {
        setError(commandError(cause, '收藏架创建失败。'));
        setLoading(false);
      }
    }
  }

  async function deregisterShelf() {
    if (!confirmShelf || enteredShelfName !== confirmShelf.name || !preserveFilesAcknowledged || !releaseControlAcknowledged) return;
    setLoading(true); setError(''); setNotice('');
    try {
      await helixAdminApi.deregisterShelf(confirmShelf, enteredShelfName, preserveFilesAcknowledged, releaseControlAcknowledged);
      setConfirmShelf(null); setEnteredShelfName(''); setPreserveFilesAcknowledged(false); setReleaseControlAcknowledged(false);
      await load();
    } catch (cause) {
      if (isUnauthorized(cause)) expire();
      else { setError(cause instanceof Error ? cause.message : '收藏架注销请求失败。'); setLoading(false); }
    }
  }

  function openPlacement(shelf: Shelf) {
    setPlacementShelf(shelf);
    setPlacementDraft({ ...shelf.placement.value });
    setPlacementTarget(shelf.target.rootLocation);
    setPlacementPreview(null);
    setError(''); setNotice('');
  }
  function openBind(shelf: Shelf) {
    setBindShelf(shelf);
    setBindTemplateId(shelf.standard.ruleTemplateId);
    setError(''); setNotice('');
  }
  function openStandard(shelf: Shelf) {
    const source = templates.find((item) => item.templateId === shelf.standard.ruleTemplateId);
    setStandardShelf(shelf);
    setCopyName(`${shelf.name} 整理标准`);
    setMovieEdits(editsFromBranches(movieRules(source?.current.rules || shelf.standard.value)));
    setStandardPreview(null);
    setPreparedDraft(null);
    setError(''); setNotice('');
  }

  async function previewPlacement() {
    if (!placementShelf) return;
    setLoading(true); setError('');
    try {
      setPlacementPreview(await helixAdminApi.previewPlacement(placementShelf, placementDraft, placementTarget));
    } catch (cause) {
      if (isUnauthorized(cause)) expire();
      else setError(commandError(cause, '目录布局预览失败。'));
    } finally { setLoading(false); }
  }
  async function publishPlacement() {
    if (!placementShelf || !placementPreview) return;
    setLoading(true); setError('');
    try {
      await helixAdminApi.publishPlacement(placementShelf, placementDraft, placementPreview, placementTarget);
      setPlacementShelf(null); setPlacementPreview(null);
      setNotice('目录布局已发布。已上架电影会按新命名重新评估，身份保持同一收藏项。');
      await load();
    } catch (cause) {
      if (isUnauthorized(cause)) expire();
      else { setError(commandError(cause, '目录布局发布失败。')); setLoading(false); }
    }
  }
  async function bindTemplate() {
    if (!bindShelf) return;
    const template = activeTemplates.find((item) => item.templateId === bindTemplateId);
    if (!template) { setError('请选择已发布的规则模板。'); return; }
    setLoading(true); setError('');
    try {
      await helixAdminApi.bindShelfTemplate(bindShelf, template);
      setBindShelf(null);
      setNotice('电影整理标准已更换。已上架电影会按新标准重新评估，身份保持同一收藏项。');
      await load();
    } catch (cause) {
      if (isUnauthorized(cause)) expire();
      else { setError(commandError(cause, '规则模板绑定失败。')); setLoading(false); }
    }
  }
  async function prepareStandardDraft(shelf: Shelf) {
    const source = preparedDraft?.template
      || templates.find((item) => item.templateId === shelf.standard.ruleTemplateId);
    if (!source) throw new Error('找不到当前规则模板，请刷新后重试。');
    let working = preparedDraft;
    if (!working && source.ownerKind === 'user') {
      const current = await helixAdminApi.getRuleTemplateDraft(source.templateId);
      if (!current.writable || !current.draft) throw new Error('系统推荐模板不可改写，请复制后再发布。');
      working = { template: source, draft: current.draft };
      setPreparedDraft(working);
    }
    if (!working) {
      if (!copyName.trim()) throw new Error('请填写自己的规则模板名称。');
      const copied = await helixAdminApi.copyRuleTemplate(source, copyName.trim());
      const current = await helixAdminApi.getRuleTemplateDraft(copied.template.templateId);
      if (!current.draft) throw new Error('复制后的规则模板没有可编辑草稿。');
      working = { template: copied.template, draft: current.draft };
      setPreparedDraft(working);
    }
    const rules = await applyMovieEdits(working.draft.rules, movieEdits);
    const revised = await helixAdminApi.reviseRuleTemplateDraft(working.draft, rules);
    const draft: RuleTemplateDraft = { ...working.draft, ...revised, rules };
    const prepared = { template: working.template, draft };
    setPreparedDraft(prepared);
    return prepared;
  }
  async function previewStandard() {
    if (!standardShelf) return;
    setLoading(true); setError('');
    try {
      const prepared = await prepareStandardDraft(standardShelf);
      setStandardPreview(await helixAdminApi.previewRuleTemplate(prepared.template, prepared.draft));
    } catch (cause) {
      if (isUnauthorized(cause)) expire();
      else setError(commandError(cause, '电影整理标准预览失败。'));
    } finally { setLoading(false); }
  }
  async function publishStandard() {
    if (!standardShelf) return;
    setLoading(true); setError('');
    try {
      const prepared = preparedDraft || await prepareStandardDraft(standardShelf);
      const preview = standardPreview || await helixAdminApi.previewRuleTemplate(prepared.template, prepared.draft);
      const published = await helixAdminApi.publishRuleTemplate(preview);
      if (standardShelf.standard.ruleTemplateId !== published.template.templateId) {
        await helixAdminApi.bindShelfTemplate(standardShelf, published.template);
      }
      setStandardShelf(null); setStandardPreview(null); setPreparedDraft(null);
      setNotice('电影整理标准已发布。已上架电影会按新标准重新评估，身份保持同一收藏项。');
      await load();
    } catch (cause) {
      if (isUnauthorized(cause)) expire();
      else { setError(commandError(cause, '电影整理标准发布失败。')); setLoading(false); }
    }
  }

  if (!shelves.length && loading && !error) return <LoadingState>正在读取收藏架…</LoadingState>;

  return <section className="source-page shelf-page">
    <PageHeader title="收藏架配置" description="指定上架后的目录和命名规则。创建后仍可更换电影整理标准和目录布局；已上架电影会按新规则重新评估，不会重新入库。" actions={<Button variant="primary" type="button" onClick={() => setShowCreate((value) => !value)}>{showCreate ? '收起' : '新建收藏架'}</Button>} />
    <div className="source-facts facts-3" aria-label="收藏架摘要">
      <div><span>活动收藏架</span><strong>{activeShelves.length}</strong><small>可接收整理结果</small></div>
      <div><span>可用规则模板</span><strong>{activeTemplates.length}</strong><small>系统推荐模板只读</small></div>
      <div><span>媒体类型</span><strong>电影</strong><small>其他类型暂不开放</small></div>
    </div>
    <AutomaticOperationPanel heading="全自动或关键步骤确认" />
    {showCreate && <form className="source-create" onSubmit={createShelf}>
      <div className="source-create-heading"><div><h2>创建电影收藏架</h2></div></div>
      <div className="source-form-grid">
        <label><span>收藏架名称</span><input value={name} onChange={(event) => setName(event.target.value)} required /></label>
        <label><span>规则模板</span><select value={templateId} onChange={(event) => setTemplateId(event.target.value)} required>{activeTemplates.map((item) => <option key={item.templateId} value={item.templateId}>{item.name}{item.ownerKind === 'system' ? ' · 系统只读' : ''}</option>)}</select></label>
        <label className="wide"><span>收藏最终目录</span><input value={targetRootLocation} onChange={(event) => setTargetRootLocation(event.target.value)} placeholder="例如 E:\Movies 或 /media/Film" required /></label>
        <PlacementFields placement={placement} onChange={setPlacement} />
      </div>
      <div className="template-preview" aria-label="最终命名保存前预览">{namingPreview(placement)}</div>
      {selectedTemplate && <div className="template-preview">
        <strong>{selectedTemplate.name}</strong>
        <small>本页只使用电影规则。</small>
        <div className="movie-rule-grid">{movieRules(selectedTemplate.current.rules).map((branch) => <div key={`${branch.conditionKind}-${branch.rating || 0}`}><b>{branchLabel(branch)}</b><span>{mediaLabel(branch)}</span><small>{spaceLabel(branch)}</small></div>)}</div>
      </div>}
      <div className="source-create-footer"><p>保存时会检查目录是否可达、可写，并记下命名规则。</p><Button variant="primary" type="submit" disabled={loading || activeTemplates.length === 0}>{loading ? '正在验证并保存…' : '创建收藏架'}</Button></div>
    </form>}
    {notice && <p className="form-notice" role="status">{notice}</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="source-registry">
      <div className="source-registry-heading"><div><h2>当前收藏架</h2></div><Button type="button" onClick={() => void load()} disabled={loading}>刷新</Button></div>
      {shelves.length === 0 ? <div className="source-empty"><strong>还没有收藏架</strong><p>先选择一个目标目录，并绑定系统推荐规则模板。</p></div> : shelves.map((shelf) => <article className="source-record shelf-record" key={shelf.shelfId}>
        <div className="source-record-main">
          <div className="source-record-title"><span className={`status-dot ${shelf.status}`} /><div><h3>{shelf.name}</h3><p>{shelf.target.rootLocation}</p><span className="source-state">{shelfStatusLabel(shelf.status)}</span></div></div>
          <dl>
            <div><dt>规则模板</dt><dd>{templateLabel(shelf.standard.ruleTemplateId)}</dd></div>
            <div><dt>目录布局</dt><dd>{shelf.placement.value.folderTemplate}</dd></div>
            <div><dt>收藏条目</dt><dd>{shelf.deregistrationSummary.entryCount}</dd></div>
            <div><dt>状态</dt><dd>{shelfStatusLabel(shelf.status)}</dd></div>
          </dl>
        </div>
        <div className="shelf-standard">
          <div className="shelf-standard-head"><div><strong>电影整理标准</strong><small>系统推荐模板只读。复制后才能发布自己的标准。</small></div></div>
          <div className="movie-rule-grid">{movieRules(shelf.standard.value).map((branch) => <div key={`${branch.conditionKind}-${branch.rating || 0}`}><b>{branchLabel(branch)}</b><span>{mediaLabel(branch)}</span><small>{spaceLabel(branch)}</small></div>)}</div>
        </div>
        {shelf.status === 'active' && <div className="shelf-card-actions">
          <Button type="button" onClick={() => openStandard(shelf)}>复制并修改电影整理标准</Button>
          <Button type="button" onClick={() => openBind(shelf)}>更换规则模板</Button>
          <Button type="button" onClick={() => openPlacement(shelf)}>调整目录布局</Button>
          <Button variant="danger" type="button" onClick={() => { setConfirmShelf(shelf); setEnteredShelfName(''); setPreserveFilesAcknowledged(false); setReleaseControlAcknowledged(false); }}>注销收藏架</Button>
        </div>}
        <details><summary>技术标识</summary><code>{shelf.shelfId}</code><code>{shelf.target.endpointId}</code><code>{shelf.target.mountScopeId}</code></details>
        {shelf.status === 'deregistering' && <div className="template-preview" aria-live="polite"><strong>正在安全注销</strong><small>{shelf.deregistrationSummary.process?.blockingReason || '文件和目标目录不会被修改。'}</small></div>}
        {shelf.status === 'deregistered' && <small>此收藏架只读保留。目标目录和文件保持原样。</small>}
      </article>)}
    </div>
    {placementShelf && <div className="dialog-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPlacementShelf(null); }}>
      <div className="dialog dialog-wide" role="dialog" aria-modal="true" aria-labelledby="shelf-placement-title">
        <div className="dialog-head"><h2 id="shelf-placement-title">调整“{placementShelf.name}”的目录布局</h2></div>
        <div className="dialog-body">
          <p>发布后同一收藏项保持不变。目录命名差异会进入收藏健康评估；能修好的会自动修复，其余标为需要处理。本次不会立刻移动或改名文件。</p>
          <div className="source-form-grid">
            <label className="wide"><span>收藏最终目录</span><input value={placementTarget} onChange={(event) => { setPlacementTarget(event.target.value); setPlacementPreview(null); }} required /></label>
            <PlacementFields placement={placementDraft} onChange={(value) => { setPlacementDraft(value); setPlacementPreview(null); }} />
          </div>
          <div className="template-preview" aria-label="最终命名保存前预览">{namingPreview(placementDraft)}</div>
          {placementPreview && <div className="template-preview" role="status">
            <strong>将影响 {placementPreview.affectedActiveEntryCount} 部已上架电影</strong>
            <small>{reassessmentCopy(placementPreview.affectedActiveEntryCount)}</small>
          </div>}
        </div>
        <div className="dialog-actions">
          <Button type="button" onClick={() => setPlacementShelf(null)}>返回</Button>
          <Button type="button" disabled={loading} onClick={() => void previewPlacement()}>{loading ? '正在预览…' : '预览影响'}</Button>
          <Button variant="primary" type="button" disabled={loading || !placementPreview} onClick={() => void publishPlacement()}>发布目录布局</Button>
        </div>
      </div>
    </div>}
    {bindShelf && <div className="dialog-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setBindShelf(null); }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="shelf-bind-title">
        <div className="dialog-head"><h2 id="shelf-bind-title">更换“{bindShelf.name}”的规则模板</h2></div>
        <div className="dialog-body">
          <p>{reassessmentCopy(bindShelf.deregistrationSummary.entryCount)}</p>
          <label><span>已发布的规则模板</span><select value={bindTemplateId} onChange={(event) => setBindTemplateId(event.target.value)}>{activeTemplates.map((item) => <option key={item.templateId} value={item.templateId}>{item.name}{item.ownerKind === 'system' ? ' · 系统只读' : ''}</option>)}</select></label>
        </div>
        <div className="dialog-actions">
          <Button type="button" onClick={() => setBindShelf(null)}>返回</Button>
          <Button variant="primary" type="button" disabled={loading || !bindTemplateId} onClick={() => void bindTemplate()}>{loading ? '正在应用…' : '应用到此收藏架'}</Button>
        </div>
      </div>
    </div>}
    {standardShelf && <div className="dialog-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setStandardShelf(null); }}>
      <div className="dialog dialog-wide" role="dialog" aria-modal="true" aria-labelledby="shelf-standard-title">
        <div className="dialog-head"><h2 id="shelf-standard-title">复制并发布“{standardShelf.name}”的电影整理标准</h2></div>
        <div className="dialog-body">
          <p>系统推荐模板不可改写。复制后发布自己的标准，再应用到此收藏架。已上架电影按新标准重新评估，不会重新入库。</p>
          {templates.find((item) => item.templateId === standardShelf.standard.ruleTemplateId)?.ownerKind !== 'user' && !preparedDraft && <label><span>自己的规则模板名称</span><input value={copyName} onChange={(event) => { setCopyName(event.target.value); setStandardPreview(null); }} required /></label>}
          <MovieRuleEditor edits={movieEdits} onChange={(value) => { setMovieEdits(value); setStandardPreview(null); }} />
          {standardPreview && <div className="template-preview" role="status">
            <strong>将影响 {standardPreview.currentEntryPotentialGapCount || standardShelf.deregistrationSummary.entryCount} 部已上架电影</strong>
            <small>{reassessmentCopy(standardPreview.currentEntryPotentialGapCount || standardShelf.deregistrationSummary.entryCount, Math.max(0, standardPreview.affectedShelfCount - (standardShelf.standard.ruleTemplateId === standardPreview.templateId ? 1 : 0)))}</small>
          </div>}
        </div>
        <div className="dialog-actions">
          <Button type="button" onClick={() => setStandardShelf(null)}>返回</Button>
          <Button type="button" disabled={loading} onClick={() => void previewStandard()}>{loading ? '正在预览…' : '预览影响'}</Button>
          <Button variant="primary" type="button" disabled={loading || !standardPreview} onClick={() => void publishStandard()}>发布电影整理标准</Button>
        </div>
      </div>
    </div>}
    {confirmShelf && <div className="dialog-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setConfirmShelf(null); }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="shelf-deregister-title">
        <div className="dialog-head"><h2 id="shelf-deregister-title">永久注销“{confirmShelf.name}”</h2></div>
        <div className="dialog-body">
          <p>当前包含 {confirmShelf.deregistrationSummary.entryCount} 个收藏条目。进行中的上架、退出和健康修复会先安全收口。</p>
          <p>所有文件和目标目录都会原样保留。收藏记录会结束，且不可恢复。</p>
          <label><span>输入完整收藏架名称确认</span><input autoFocus value={enteredShelfName} onChange={(event) => setEnteredShelfName(event.target.value)} /></label>
          <label><input type="checkbox" checked={preserveFilesAcknowledged} onChange={(event) => setPreserveFilesAcknowledged(event.target.checked)} /><span>我理解目标目录和其中全部文件将原样保留。</span></label>
          <label><input type="checkbox" checked={releaseControlAcknowledged} onChange={(event) => setReleaseControlAcknowledged(event.target.checked)} /><span>我确认结束此收藏架对已上架文件的管理。</span></label>
        </div>
        <div className="dialog-actions">
          <Button type="button" onClick={() => setConfirmShelf(null)}>返回</Button>
          <Button variant="danger" type="button" disabled={loading || enteredShelfName !== confirmShelf.name || !preserveFilesAcknowledged || !releaseControlAcknowledged} onClick={() => void deregisterShelf()}>永久注销收藏架</Button>
        </div>
      </div>
    </div>}
  </section>;
}
