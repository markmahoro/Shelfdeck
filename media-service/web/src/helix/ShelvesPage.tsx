import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { AdminApiError, helixAdminApi, type MovieRuleBranch, type RuleTemplate, type Shelf } from './api';

type SessionState = 'checking' | 'required' | 'ready';

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
  return branch.requirements.space.maxSizeGiB === null
    ? '不按评分限制空间'
    : `最多 ${branch.requirements.space.maxSizeGiB} GiB`;
}

function movieRules(value: { profileRuleSets: { contentProfile: string; decisionBranches: MovieRuleBranch[] }[] }) {
  return value.profileRuleSets.find((item) => item.contentProfile === 'movie')?.decisionBranches || [];
}

export default function ShelvesPage() {
  const [session, setSession] = useState<SessionState>('checking');
  const [apiKey, setApiKey] = useState('');
  const [shelves, setShelves] = useState<Shelf[]>([]);
  const [templates, setTemplates] = useState<RuleTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [shelfId, setShelfId] = useState(newShelfId);
  const [name, setName] = useState('电影收藏架');
  const [targetRootLocation, setTargetRootLocation] = useState('');
  const [templateId, setTemplateId] = useState('system-beta-recommended');
  const [folderTemplate, setFolderTemplate] = useState('{title} ({year})');
  const [collisionPolicy, setCollisionPolicy] = useState('reject');
  const [confirmShelf,setConfirmShelf]=useState<Shelf|null>(null);
  const [enteredShelfName,setEnteredShelfName]=useState('');
  const [preserveFilesAcknowledged,setPreserveFilesAcknowledged]=useState(false);
  const [releaseControlAcknowledged,setReleaseControlAcknowledged]=useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [shelfResult, templateResult] = await Promise.all([
        helixAdminApi.listShelves(),
        helixAdminApi.listRuleTemplates(),
      ]);
      setShelves(shelfResult.items);
      setTemplates(templateResult.items);
      const recommended = templateResult.items.find((item) =>
        item.templateId === 'system-beta-recommended' && item.status === 'active');
      if (recommended) setTemplateId(recommended.templateId);
      setSession('ready');
      if (shelfResult.items.length === 0) setShowCreate(true);
    } catch (cause) {
      if (cause instanceof AdminApiError && cause.status === 401) setSession('required');
      else setError(cause instanceof Error ? cause.message : '收藏架读取失败。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const activeTemplates = useMemo(
    () => templates.filter((item) => item.status === 'active'),
    [templates],
  );
  const selectedTemplate = activeTemplates.find((item) => item.templateId === templateId);
  const activeShelves = shelves.filter((item) => item.status === 'active');

  async function signIn(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      await helixAdminApi.createSession(apiKey.trim());
      setApiKey('');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '管理凭据验证失败。');
      setLoading(false);
    }
  }

  async function createShelf(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || !targetRootLocation.trim() || !selectedTemplate) {
      setError('请填写收藏架名称、实际目标目录并选择可用规则模板。');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await helixAdminApi.createShelf({
        idempotencyKey: `shelf:${shelfId}:create:v1`,
        shelfId,
        name: name.trim(),
        targetRootLocation: targetRootLocation.trim(),
        ruleTemplateId: selectedTemplate.templateId,
        expectedTemplateRevision: selectedTemplate.currentRevision,
        placementPolicy: { folderTemplate: folderTemplate.trim(), collisionPolicy },
      });
      setShelfId(newShelfId());
      setName('电影收藏架');
      setTargetRootLocation('');
      setFolderTemplate('{title} ({year})');
      setCollisionPolicy('reject');
      setShowCreate(false);
      await load();
    } catch (cause) {
      const reasonCode = cause instanceof AdminApiError && typeof cause.details.reasonCode === 'string'
        ? cause.details.reasonCode
        : '';
      setError(cause instanceof Error
        ? `${cause.message}${reasonCode ? `（${reasonCode}）` : ''}`
        : '收藏架创建失败。');
      setLoading(false);
    }
  }

  async function deregisterShelf(){if(!confirmShelf||enteredShelfName!==confirmShelf.name||!preserveFilesAcknowledged||!releaseControlAcknowledged)return;setLoading(true);setError('');try{await helixAdminApi.deregisterShelf(confirmShelf,enteredShelfName,preserveFilesAcknowledged,releaseControlAcknowledged);setConfirmShelf(null);setEnteredShelfName('');setPreserveFilesAcknowledged(false);setReleaseControlAcknowledged(false);await load();}catch(cause){setError(cause instanceof Error?cause.message:'收藏架注销请求失败。');setLoading(false);}}

  if (session === 'checking') {
    return <section className="source-page source-page-loading" aria-live="polite">正在读取收藏架…</section>;
  }

  if (session === 'required') {
    return <section className="source-page auth-stage"><div className="auth-card">
      <p className="eyebrow">本机管理会话</p>
      <h1>打开你的收藏运营台</h1>
      <p>输入 clean initialization 生成的管理凭据。凭据只用于换取本机 HttpOnly 会话，不会保存在浏览器中。</p>
      <form onSubmit={signIn} className="auth-form">
        <label><span>管理凭据</span><input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} autoComplete="current-password" required /></label>
        <button type="submit" disabled={loading || !apiKey.trim()}>{loading ? '正在验证…' : '进入管理台'}</button>
      </form>
      {error && <p className="form-error" role="alert">{error}</p>}
    </div></section>;
  }

  return <section className="source-page shelf-page">
    <header className="source-hero"><div>
      <p className="eyebrow">收藏架 · Arca</p>
      <h1>先确定电影收藏最终应该成为什么样子</h1>
      <p>收藏架同时固定最终位置、规则模板和布局。创建不会建立正式收藏，也不会移动、改名或写入任何媒体文件。</p>
    </div><button className="surface-action" type="button" onClick={() => setShowCreate((value) => !value)}>{showCreate ? '收起' : '新建收藏架'}</button></header>

    <div className="source-facts" aria-label="收藏架摘要">
      <div><span>活动收藏架</span><strong>{activeShelves.length}</strong><small>可成为Libra Routing目标</small></div>
      <div><span>可用规则模板</span><strong>{activeTemplates.length}</strong><small>系统推荐模板保持只读</small></div>
      <div><span>当前里程碑</span><strong>Movie</strong><small>其他Profile规则保留但尚未开放</small></div>
    </div>

    {showCreate && <form className="source-create" onSubmit={createShelf}>
      <div className="source-create-heading"><div><p className="eyebrow">建立收藏意图</p><h2>创建第一座电影收藏架</h2></div><span>Target probe · Template binding</span></div>
      <div className="source-form-grid">
        <label><span>收藏架名称</span><input value={name} onChange={(event) => setName(event.target.value)} required /></label>
        <label><span>规则模板</span><select value={templateId} onChange={(event) => setTemplateId(event.target.value)} required>{activeTemplates.map((item) => <option key={item.templateId} value={item.templateId}>{item.name}{item.ownerKind === 'system' ? ' · 系统只读' : ''}</option>)}</select></label>
        <label className="wide"><span>收藏最终目录</span><input value={targetRootLocation} onChange={(event) => setTargetRootLocation(event.target.value)} placeholder="例如 E:\Movies 或 /media/Film" required /></label>
        <label><span>目录命名模板</span><input value={folderTemplate} onChange={(event) => setFolderTemplate(event.target.value)} required /></label>
        <label><span>名称冲突</span><select value={collisionPolicy} onChange={(event) => setCollisionPolicy(event.target.value)}><option value="reject">拒绝并等待处理</option><option value="suffix">添加确定性后缀</option></select></label>
      </div>
      {selectedTemplate && <div className="template-preview">
        <strong>{selectedTemplate.name}</strong><span>revision {selectedTemplate.currentRevision}</span><small>同一模板含Movie、Series、JAV、Western Adult四组规则；本里程碑只使用Movie。</small>
        <div className="movie-rule-grid">{movieRules(selectedTemplate.current.rules).map((branch) => <div key={`${branch.conditionKind}-${branch.rating || 0}`}><b>{branchLabel(branch)}</b><span>{mediaLabel(branch)}</span><small>{spaceLabel(branch)}</small></div>)}</div>
      </div>}
      <div className="source-create-footer"><p>保存时会验证目录可达、可写和安全提交能力，并原子生成Shelf Standard与Placement revision 1。</p><button type="submit" disabled={loading || activeTemplates.length === 0}>{loading ? '正在验证并保存…' : '创建收藏架'}</button></div>
    </form>}

    {error && <p className="form-error" role="alert">{error}</p>}

    <div className="source-registry">
      <div className="source-registry-heading"><div><p className="eyebrow">收藏架登记簿</p><h2>当前收藏架</h2></div><button type="button" onClick={() => void load()} disabled={loading}>刷新</button></div>
      {shelves.length === 0 ? <div className="source-empty"><strong>还没有收藏架</strong><p>先选择一个空的或既有目标目录，并绑定系统推荐规则模板。</p></div> : shelves.map((shelf) => <article className="source-record shelf-record" key={shelf.shelfId}>
        <div className="source-record-main">
          <div className="source-record-title"><span className={`status-dot ${shelf.status}`} /><div><h3>{shelf.name}</h3><p>{shelf.target.rootLocation}</p><span className="source-state">{shelf.status === 'active' ? '可供Routing读取' : shelf.status==='deregistering'?'正在安全注销':'已注销'}</span></div></div>
          <dl>
            <div><dt>规则模板</dt><dd>{shelf.standard.ruleTemplateId}</dd></div>
            <div><dt>收藏标准</dt><dd>revision {shelf.currentStandardRevision}</dd></div>
            <div><dt>布局</dt><dd>{shelf.placement.value.folderTemplate}</dd></div>
            <div><dt>Routing投影</dt><dd>revision {shelf.routingProjection.revision}</dd></div>
          </dl>
        </div>
        <div className="shelf-standard">
          <div><strong>Movie收藏标准</strong><span>Template revision {shelf.standard.ruleTemplateRevision}</span></div>
          <div className="movie-rule-grid">{movieRules(shelf.standard.value).map((branch) => <div key={`${branch.conditionKind}-${branch.rating || 0}`}><b>{branchLabel(branch)}</b><span>{mediaLabel(branch)}</span><small>{spaceLabel(branch)}</small></div>)}</div>
        </div>
        <details><summary>技术标识</summary><code>{shelf.shelfId}</code><code>{shelf.target.endpointId}</code><code>{shelf.target.mountScopeId}</code><code>{shelf.routingProjection.digest}</code></details>
        {shelf.status==='active'&&<button className="source-danger" type="button" onClick={()=>{setConfirmShelf(shelf);setEnteredShelfName('');setPreserveFilesAcknowledged(false);setReleaseControlAcknowledged(false);}}>注销收藏架</button>}
        {shelf.status==='deregistering'&&<div className="template-preview" aria-live="polite"><strong>注销阶段：{shelf.deregistrationSummary.process?.phase||'waiting_responsibility'}</strong><span>Manifest {shelf.deregistrationSummary.process?.manifestRevision||'尚未冻结'} · {shelf.deregistrationSummary.process?.pageCount||0} 页 · {shelf.deregistrationSummary.process?.memberCount||0} 项</span><small>{shelf.deregistrationSummary.process?.blockingReason||'文件与Target Folder不会被修改。'}</small></div>}
        {shelf.status==='deregistered'&&<small>此收藏架只读保留；历史Shelf Entry、Inventory与Deck Fact仍可查询，Target Folder及文件保持原样。</small>}
      </article>)}
    </div>
    {confirmShelf&&<div className="source-confirm" role="dialog" aria-modal="true" aria-labelledby="shelf-deregister-title"><div><h2 id="shelf-deregister-title">永久注销“{confirmShelf.name}”</h2><p>当前包含 {confirmShelf.deregistrationSummary.entryCount} 个收藏条目、{confirmShelf.deregistrationSummary.primaryCount} 个Primary、{confirmShelf.deregistrationSummary.controlledMaterialCount} 个受控材料。</p><p>在途责任：On-deck {confirmShelf.deregistrationSummary.responsibilityCounts.onDeck}、Off-deck {confirmShelf.deregistrationSummary.responsibilityCounts.offdeck}、Aftercare {confirmShelf.deregistrationSummary.responsibilityCounts.aftercare}、未授权Reservation {confirmShelf.deregistrationSummary.responsibilityCounts.reservations}。不可逆责任会先安全收口。</p><p>所有文件和Target Folder都会原样保留；系统将终结收藏事实并释放精确Material Control，收藏架不可恢复。</p><label><span>输入完整收藏架名称确认</span><input autoFocus value={enteredShelfName} onChange={event=>setEnteredShelfName(event.target.value)}/></label><label><input type="checkbox" checked={preserveFilesAcknowledged} onChange={event=>setPreserveFilesAcknowledged(event.target.checked)}/><span>我理解 Target Folder 和其中全部文件将原样保留。</span></label><label><input type="checkbox" checked={releaseControlAcknowledged} onChange={event=>setReleaseControlAcknowledged(event.target.checked)}/><span>我确认释放此 Shelf 当前拥有的精确 Material Control。</span></label><div><button type="button" onClick={()=>setConfirmShelf(null)}>返回</button><button className="source-danger" type="button" disabled={loading||enteredShelfName!==confirmShelf.name||!preserveFilesAcknowledged||!releaseControlAcknowledged} onClick={()=>void deregisterShelf()}>永久注销收藏架</button></div></div></div>}
  </section>;
}
