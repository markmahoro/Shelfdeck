import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { AdminApiError, helixAdminApi, materialFieldRegistration, type MaterialField, type ProcurementJourneyResult, type Shelf } from './api';
import RoutingPolicyPanel from './RoutingPolicyPanel';

type SessionState = 'checking' | 'required' | 'ready';

function newFieldId() {
  return `movie-field-${crypto.randomUUID()}`;
}

function directorySet(value: string) {
  return [...new Set(value.split(/[\n,]/).map((item) => item.trim().replace(/\\/g, '/')).filter(Boolean))].sort();
}

function journeyLabel(stage: string | undefined) {
  if (stage === 'handoff_a_ready') return '候选包已准备好';
  if (stage === 'handoff_a_accepted') return '候选包已被收藏生产接收';
  if (stage === 'handoff_a_rejected') return '候选包未被接收';
  if (stage === 'triage_not_ready') return 'Triage尚未形成候选包';
  if (stage === 'procurement_run_active') return 'Procurement Run正在准备';
  if (stage === 'not_started') return '等待观察';
  return '后台处理中';
}

export default function MaterialFieldsPage() {
  const [session, setSession] = useState<SessionState>('checking');
  const [apiKey, setApiKey] = useState('');
  const [fields, setFields] = useState<MaterialField[]>([]);
  const [shelves, setShelves] = useState<Shelf[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [fieldId, setFieldId] = useState(newFieldId);
  const [name, setName] = useState('电影文件来源');
  const [rootLocation, setRootLocation] = useState('');
  const [includedDirectories, setIncludedDirectories] = useState('');
  const [excludedDirectories, setExcludedDirectories] = useState('');
  const [observingFieldId, setObservingFieldId] = useState('');
  const [deregisteringFieldId, setDeregisteringFieldId] = useState('');
  const [confirmDeregisterFieldId, setConfirmDeregisterFieldId] = useState('');
  const [operations, setOperations] = useState<Record<string, ProcurementJourneyResult>>({});

  const loadFields = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [result, shelfResult] = await Promise.all([helixAdminApi.listMaterialFields(), helixAdminApi.listShelves()]);
      setFields(result.items);
      setShelves(shelfResult.items);
      setSession('ready');
      if (result.items.length === 0) setShowCreate(true);
    } catch (cause) {
      if (cause instanceof AdminApiError && cause.status === 401) setSession('required');
      else setError(cause instanceof Error ? cause.message : '文件来源读取失败。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadFields(); }, [loadFields]);

  useEffect(() => {
    if (Object.keys(operations).length === 0) return undefined;
    const timer = window.setInterval(() => { void loadFields(); }, 1000);
    return () => window.clearInterval(timer);
  }, [loadFields, operations]);

  useEffect(() => {
    setOperations((current) => Object.fromEntries(Object.entries(current).filter(([id]) => {
      const field = fields.find((item) => item.fieldId === id);
      return !field || field.currentObservationRevision === undefined;
    })));
  }, [fields]);

  const activeFields = useMemo(() => fields.filter((field) => field.status === 'active'), [fields]);
  const observedFields = useMemo(
    () => activeFields.filter((field) => field.currentObservationRevision !== undefined).length,
    [activeFields],
  );

  async function signIn(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      await helixAdminApi.createSession(apiKey.trim());
      setApiKey('');
      await loadFields();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '管理凭据验证失败。');
      setLoading(false);
    }
  }

  async function createField(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || !rootLocation.trim()) {
      setError('请填写来源名称和本机可访问的电影目录。');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const body = await materialFieldRegistration({
        fieldId,
        name: name.trim(),
        rootLocation: rootLocation.trim(),
        includedDirectories: directorySet(includedDirectories),
        excludedDirectories: directorySet(excludedDirectories),
      });
      await helixAdminApi.registerMaterialField(body);
      setFieldId(newFieldId());
      setName('电影文件来源');
      setRootLocation('');
      setIncludedDirectories('');
      setExcludedDirectories('');
      setShowCreate(false);
      await loadFields();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '文件来源创建失败。');
      setLoading(false);
    }
  }

  async function observeField(field: MaterialField) {
    setObservingFieldId(field.fieldId);
    setError('');
    try {
      const result = await helixAdminApi.observeMaterialField(field);
      setOperations((current) => ({ ...current, [field.fieldId]: result }));
      await loadFields();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '文件来源观察失败。');
    } finally {
      setObservingFieldId('');
    }
  }

  async function deregisterField(field: MaterialField) {
    setDeregisteringFieldId(field.fieldId);
    setError('');
    try {
      await helixAdminApi.deregisterMaterialField(field);
      setConfirmDeregisterFieldId('');
      await loadFields();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '注销文件来源失败。');
    } finally {
      setDeregisteringFieldId('');
    }
  }

  if (session === 'checking') {
    return <section className="source-page source-page-loading" aria-live="polite">正在读取文件来源…</section>;
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

  return <section className="source-page">
    <header className="source-hero"><div>
      <p className="eyebrow">文件来源 · Movie</p>
      <h1>先确认从哪里发现电影</h1>
      <p>文件来源只建立只读观察范围。它不是收藏架，也不会因为登记而移动、改名或删除任何媒体文件。</p>
    </div><button className="surface-action" type="button" onClick={() => setShowCreate((value) => !value)}>{showCreate ? '收起' : '添加电影来源'}</button></header>

    <div className="source-facts" aria-label="文件来源摘要">
      <div><span>活动来源</span><strong>{activeFields.length}</strong><small>Procurement 可观察范围</small></div>
      <div><span>已有观察</span><strong>{observedFields}</strong><small>具有持久 Observation revision</small></div>
      <div><span>当前里程碑</span><strong>Movie</strong><small>其他媒体类型暂不开放</small></div>
    </div>

    {showCreate && <form className="source-create" onSubmit={createField}>
      <div className="source-create-heading"><div><p className="eyebrow">登记只读范围</p><h2>添加电影文件来源</h2></div><span>不会立即扫描</span></div>
      <div className="source-form-grid">
        <label><span>来源名称</span><input value={name} onChange={(event) => setName(event.target.value)} required /></label>
        <label className="wide"><span>电影目录</span><input value={rootLocation} onChange={(event) => setRootLocation(event.target.value)} placeholder="例如 E:\\Movies 或 /media/Film" required /></label>
        <label><span>只包含这些子目录</span><textarea value={includedDirectories} onChange={(event) => setIncludedDirectories(event.target.value)} placeholder="留空表示整个来源；每行一个相对目录" /></label>
        <label><span>排除这些子目录</span><textarea value={excludedDirectories} onChange={(event) => setExcludedDirectories(event.target.value)} placeholder="例如 Extras 或临时下载" /></label>
      </div>
      <div className="source-create-footer"><p>保存后只建立 Material Field、Access revision 和 Extraction Policy revision。</p><button type="submit" disabled={loading}>{loading ? '正在保存…' : '保存文件来源'}</button></div>
    </form>}

    {error && <p className="form-error" role="alert">{error}</p>}

    <div className="source-registry">
      <div className="source-registry-heading"><div><p className="eyebrow">来源登记簿</p><h2>当前文件来源</h2></div><button type="button" onClick={() => void loadFields()} disabled={loading}>刷新</button></div>
      {fields.length === 0 ? <div className="source-empty"><strong>还没有文件来源</strong><p>先登记一个本机可读取的电影目录。登记本身不会访问目录内容。</p></div> : fields.map((field) => <article className="source-record" key={field.fieldId}>
        <div className="source-record-main">
          <div className="source-record-title"><span className={`status-dot ${field.status}`} /><div><h3>{field.name}</h3><p>{field.access.rootLocation}</p><span className="source-state">{field.status === 'active' ? '活动来源' : '已注销'}</span></div></div>
          <dl>
            <div><dt>内容类型</dt><dd>{field.currentProfileHintSnapshot.contentProfileHint === 'movie' ? '电影' : field.currentProfileHintSnapshot.contentProfileHint}</dd></div>
            <div><dt>访问合同</dt><dd>revision {field.currentAccessRevision}</dd></div>
            <div><dt>开采规则</dt><dd>revision {field.extractionPolicyRevision}</dd></div>
            <div><dt>观察事实</dt><dd>{field.currentObservationRevision === undefined ? '尚未观察' : `revision ${field.currentObservationRevision}`}</dd></div>
          </dl>
        </div>
        <div className="source-record-action"><span>{field.status === 'active' ? 'Procurement' : 'Administrative record'}</span>
          {field.status === 'active' && confirmDeregisterFieldId !== field.fieldId && <>
            <button type="button" disabled={observingFieldId.length > 0 || deregisteringFieldId.length > 0 || ['handoff_a_ready', 'handoff_a_accepted'].includes(field.procurementStatus.stage)} onClick={() => void observeField(field)}>{observingFieldId === field.fieldId ? '正在只读观察…' : field.procurementStatus.stage === 'handoff_a_ready' ? '候选包已准备' : field.procurementStatus.stage === 'handoff_a_accepted' ? '已交付收藏生产' : '观察并准备候选'}</button>
            <button className="source-stop" type="button" disabled={observingFieldId.length > 0 || deregisteringFieldId.length > 0} onClick={() => setConfirmDeregisterFieldId(field.fieldId)}>注销文件来源</button>
            <small>观察严格停在 Candidate Package / Handoff A 待交付</small>
          </>}
          {field.status === 'active' && confirmDeregisterFieldId === field.fieldId && <div className="source-stop-confirm" role="alert">
            <strong>注销这个文件来源？</strong>
            <small>停止新的Observation和开采资格；已建立的Procurement责任继续收口。保留历史审计，不会删除、移动或重命名任何媒体文件。</small>
            <div><button className="source-cancel" type="button" onClick={() => setConfirmDeregisterFieldId('')}>取消</button><button className="source-danger" type="button" disabled={deregisteringFieldId.length > 0} onClick={() => void deregisterField(field)}>{deregisteringFieldId === field.fieldId ? '正在注销…' : '确认注销文件来源'}</button></div>
          </div>}
          {field.status === 'deregistered' && <small>不再产生新的Observation或开采资格；历史责任与审计事实保留，媒体文件不变。</small>}
        </div>
        {(operations[field.fieldId] || field.procurementStatus.stage !== 'not_started') && <div className="source-journey" role="status">
          <strong>{operations[field.fieldId] ? 'Observation已进入后台队列' : journeyLabel(field.procurementStatus.stage)}</strong>
          <span>Run {field.procurementStatus.runCount} 个（活动 {field.procurementStatus.activeRunCount}）；Candidate {field.procurementStatus.candidateCount} 个；待交付 Offer {field.procurementStatus.openOfferCount} 个</span>
          {operations[field.fieldId] && <code>{operations[field.fieldId].observation.operationRef.operationId}</code>}
          {field.procurementStatus.candidatePackage?.candidatePackageId && <code>{field.procurementStatus.candidatePackage.candidatePackageId}</code>}
          {field.procurementStatus.candidatePackage?.displayIdentity && <span>{field.procurementStatus.candidatePackage.displayIdentity}</span>}
        </div>}
        {field.status === 'active' && <RoutingPolicyPanel field={field} shelves={shelves} />}
        <details><summary>技术标识</summary><code>{field.fieldId}</code><code>{field.access.endpointId}</code><code>{field.access.mountScopeId}</code></details>
      </article>)}
    </div>
  </section>;
}
