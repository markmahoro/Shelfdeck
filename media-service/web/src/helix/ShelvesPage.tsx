import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { AdminApiError, helixAdminApi, type MovieRuleBranch, type RuleTemplate, type Shelf, type ShelfPlacementPolicy } from './api';
import { Button, LoadingState, PageHeader } from './chrome';
import { isUnauthorized, useSession } from './session';

function newShelfId() {
  return `movie-shelf-${crypto.randomUUID()}`;
}
function branchLabel(branch: MovieRuleBranch) {
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
const DEFAULT_PLACEMENT: ShelfPlacementPolicy = {
  folderTemplate: '{title} ({year})',
  primaryTemplate: '{stem}{ext}',
  nfoTemplate: '{stem}.nfo',
  subtitleTemplate: '{stem}{language}{forced}{sdh}{ext}',
  posterTemplate: 'poster{ext}',
  fanartTemplate: 'fanart{ext}',
  collisionPolicy: 'reject',
};
function renderPreview(template: string, values: Record<string, string>) {
  return template.replace(/\{([^{}]+)\}/g, (_match, token) => values[token] || '');
}
function shelfStatusLabel(status: Shelf['status']) {
  if (status === 'active') return '可接收整理结果';
  if (status === 'deregistering') return '正在注销';
  return '已注销';
}

export default function ShelvesPage() {
  const { expire } = useSession();
  const [shelves, setShelves] = useState<Shelf[]>([]);
  const [templates, setTemplates] = useState<RuleTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
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

  async function createShelf(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || !targetRootLocation.trim() || !selectedTemplate) {
      setError('请填写收藏架名称、实际目标目录并选择可用规则模板。');
      return;
    }
    setLoading(true); setError('');
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
        const reasonCode = cause instanceof AdminApiError && typeof cause.details.reasonCode === 'string' ? cause.details.reasonCode : '';
        setError(cause instanceof Error ? `${cause.message}${reasonCode ? `（${reasonCode}）` : ''}` : '收藏架创建失败。');
      }
      setLoading(false);
    }
  }

  async function deregisterShelf() {
    if (!confirmShelf || enteredShelfName !== confirmShelf.name || !preserveFilesAcknowledged || !releaseControlAcknowledged) return;
    setLoading(true); setError('');
    try {
      await helixAdminApi.deregisterShelf(confirmShelf, enteredShelfName, preserveFilesAcknowledged, releaseControlAcknowledged);
      setConfirmShelf(null); setEnteredShelfName(''); setPreserveFilesAcknowledged(false); setReleaseControlAcknowledged(false);
      await load();
    } catch (cause) {
      if (isUnauthorized(cause)) expire();
      else setError(cause instanceof Error ? cause.message : '收藏架注销请求失败。');
      setLoading(false);
    }
  }

  if (!shelves.length && loading && !error) return <LoadingState>正在读取收藏架…</LoadingState>;

  return <section className="source-page shelf-page">
    <PageHeader title="收藏架配置" description="指定上架后的目录和命名规则。创建时不会写入媒体文件。" actions={<Button variant="primary" type="button" onClick={() => setShowCreate((value) => !value)}>{showCreate ? '收起' : '新建收藏架'}</Button>} />
    <div className="source-facts facts-3" aria-label="收藏架摘要">
      <div><span>活动收藏架</span><strong>{activeShelves.length}</strong><small>可接收整理结果</small></div>
      <div><span>可用规则模板</span><strong>{activeTemplates.length}</strong><small>系统推荐模板只读</small></div>
      <div><span>媒体类型</span><strong>电影</strong><small>其他类型暂不开放</small></div>
    </div>
    {showCreate && <form className="source-create" onSubmit={createShelf}>
      <div className="source-create-heading"><div><h2>创建电影收藏架</h2></div></div>
      <div className="source-form-grid">
        <label><span>收藏架名称</span><input value={name} onChange={(event) => setName(event.target.value)} required /></label>
        <label><span>规则模板</span><select value={templateId} onChange={(event) => setTemplateId(event.target.value)} required>{activeTemplates.map((item) => <option key={item.templateId} value={item.templateId}>{item.name}{item.ownerKind === 'system' ? ' · 系统只读' : ''}</option>)}</select></label>
        <label className="wide"><span>收藏最终目录</span><input value={targetRootLocation} onChange={(event) => setTargetRootLocation(event.target.value)} placeholder="例如 E:\Movies 或 /media/Film" required /></label>
        <label><span>目录命名</span><input value={placement.folderTemplate} onChange={(event) => setPlacement((value) => ({ ...value, folderTemplate: event.target.value }))} required /></label>
        <label><span>主视频命名</span><input value={placement.primaryTemplate} onChange={(event) => setPlacement((value) => ({ ...value, primaryTemplate: event.target.value }))} required /></label>
        <label><span>资料文件命名</span><input value={placement.nfoTemplate} onChange={(event) => setPlacement((value) => ({ ...value, nfoTemplate: event.target.value }))} required /></label>
        <label><span>字幕命名</span><input value={placement.subtitleTemplate} onChange={(event) => setPlacement((value) => ({ ...value, subtitleTemplate: event.target.value }))} required /></label>
        <label><span>海报命名</span><input value={placement.posterTemplate} onChange={(event) => setPlacement((value) => ({ ...value, posterTemplate: event.target.value }))} required /></label>
        <label><span>背景图命名</span><input value={placement.fanartTemplate} onChange={(event) => setPlacement((value) => ({ ...value, fanartTemplate: event.target.value }))} required /></label>
        <label><span>名称冲突</span><select value={placement.collisionPolicy} onChange={(event) => setPlacement((value) => ({ ...value, collisionPolicy: event.target.value as ShelfPlacementPolicy['collisionPolicy'] }))}><option value="reject">拒绝并等待处理</option><option value="suffix">添加确定性后缀</option></select></label>
      </div>
      <div className="template-preview" aria-label="最终命名保存前预览">
        <strong>保存前预览 · 示例电影 (2026)</strong>
        <span>{renderPreview(placement.folderTemplate, { title: '示例电影', year: '2026' })}</span>
        <small>{[
          renderPreview(placement.primaryTemplate, { stem: '示例电影 (2026)', ext: '.mkv' }),
          renderPreview(placement.nfoTemplate, { stem: '示例电影 (2026)', ext: '.nfo' }),
          renderPreview(placement.subtitleTemplate, { stem: '示例电影 (2026)', language: '.zh-CN', forced: '.forced', sdh: '.sdh', ext: '.srt' }),
          renderPreview(placement.posterTemplate, { ext: '.jpg' }),
          renderPreview(placement.fanartTemplate, { ext: '.jpg' }),
        ].join(' · ')}</small>
      </div>
      {selectedTemplate && <div className="template-preview">
        <strong>{selectedTemplate.name}</strong>
        <small>本页只使用电影规则。</small>
        <div className="movie-rule-grid">{movieRules(selectedTemplate.current.rules).map((branch) => <div key={`${branch.conditionKind}-${branch.rating || 0}`}><b>{branchLabel(branch)}</b><span>{mediaLabel(branch)}</span><small>{spaceLabel(branch)}</small></div>)}</div>
      </div>}
      <div className="source-create-footer"><p>保存时会检查目录是否可达、可写，并记下命名规则。</p><Button variant="primary" type="submit" disabled={loading || activeTemplates.length === 0}>{loading ? '正在验证并保存…' : '创建收藏架'}</Button></div>
    </form>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="source-registry">
      <div className="source-registry-heading"><div><h2>当前收藏架</h2></div><Button type="button" onClick={() => void load()} disabled={loading}>刷新</Button></div>
      {shelves.length === 0 ? <div className="source-empty"><strong>还没有收藏架</strong><p>先选择一个目标目录，并绑定系统推荐规则模板。</p></div> : shelves.map((shelf) => <article className="source-record shelf-record" key={shelf.shelfId}>
        <div className="source-record-main">
          <div className="source-record-title"><span className={`status-dot ${shelf.status}`} /><div><h3>{shelf.name}</h3><p>{shelf.target.rootLocation}</p><span className="source-state">{shelfStatusLabel(shelf.status)}</span></div></div>
          <dl>
            <div><dt>规则模板</dt><dd>{shelf.standard.ruleTemplateId === 'system-beta-recommended' ? '系统推荐' : shelf.standard.ruleTemplateId}</dd></div>
            <div><dt>目录布局</dt><dd>{shelf.placement.value.folderTemplate}</dd></div>
            <div><dt>收藏条目</dt><dd>{shelf.deregistrationSummary.entryCount}</dd></div>
            <div><dt>状态</dt><dd>{shelfStatusLabel(shelf.status)}</dd></div>
          </dl>
        </div>
        <div className="shelf-standard">
          <div><strong>电影整理标准</strong></div>
          <div className="movie-rule-grid">{movieRules(shelf.standard.value).map((branch) => <div key={`${branch.conditionKind}-${branch.rating || 0}`}><b>{branchLabel(branch)}</b><span>{mediaLabel(branch)}</span><small>{spaceLabel(branch)}</small></div>)}</div>
        </div>
        <details><summary>技术标识</summary><code>{shelf.shelfId}</code><code>{shelf.target.endpointId}</code><code>{shelf.target.mountScopeId}</code></details>
        {shelf.status === 'active' && <Button variant="danger" type="button" onClick={() => { setConfirmShelf(shelf); setEnteredShelfName(''); setPreserveFilesAcknowledged(false); setReleaseControlAcknowledged(false); }}>注销收藏架</Button>}
        {shelf.status === 'deregistering' && <div className="template-preview" aria-live="polite"><strong>正在安全注销</strong><small>{shelf.deregistrationSummary.process?.blockingReason || '文件和目标目录不会被修改。'}</small></div>}
        {shelf.status === 'deregistered' && <small>此收藏架只读保留。目标目录和文件保持原样。</small>}
      </article>)}
    </div>
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
