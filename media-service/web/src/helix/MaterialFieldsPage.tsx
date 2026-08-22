import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { helixAdminApi, materialFieldRegistration, type MaterialField, type ProcurementJourneyResult, type Shelf } from './api';
import { Button, LoadingState, PageHeader } from './chrome';
import { observationScanLabels } from './labels';
import RoutingPolicyPanel from './RoutingPolicyPanel';
import { isUnauthorized, useSession } from './session';

function newFieldId() {
  return `movie-field-${crypto.randomUUID()}`;
}
function directorySet(value: string) {
  return [...new Set(value.split(/[\n,]/).map((item) => item.trim().replace(/\\/g, '/')).filter(Boolean))].sort();
}
function scanOf(field: MaterialField) {
  return field.procurementStatus.observationScan || { state: 'waiting' as const, pageCount: 0, observationRevision: null, inProgress: false };
}
function scanLabel(field: MaterialField) {
  return observationScanLabels[scanOf(field).state] || '等待扫描';
}
function scanProgress(field: MaterialField) {
  const scan = scanOf(field);
  if (scan.state === 'scanning') {
    return scan.pageCount > 0 ? `正在查看目录 · 已扫描 ${scan.pageCount} 页` : '正在查看目录';
  }
  if (scan.state === 'completed') {
    return scan.pageCount > 0 ? `上次扫描 ${scan.pageCount} 页` : '目录已经扫描完成';
  }
  if (scan.state === 'failed') {
    return scan.failureMessage || '电影目录不存在或当前不可读取。';
  }
  return '系统会自动扫描这个目录，也可以立即扫描新文件。';
}

export default function MaterialFieldsPage() {
  const { expire } = useSession();
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

  const loadFields = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      const [result, shelfResult] = await Promise.all([helixAdminApi.listMaterialFields(), helixAdminApi.listShelves()]);
      setFields(result.items);
      setShelves(shelfResult.items);
      if (result.items.length === 0) setShowCreate(true);
    } catch (cause) {
      if (isUnauthorized(cause)) expire();
      else setError(cause instanceof Error ? cause.message : '文件来源读取失败。');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [expire]);

  useEffect(() => { void loadFields(); }, [loadFields]);

  const scanning = useMemo(
    () => fields.some((field) => field.status === 'active' && scanOf(field).state === 'scanning'),
    [fields],
  );
  useEffect(() => {
    if (!scanning) return undefined;
    const timer = window.setInterval(() => { void loadFields(true); }, 3000);
    return () => window.clearInterval(timer);
  }, [scanning, loadFields]);

  const activeFields = useMemo(() => fields.filter((field) => field.status === 'active'), [fields]);
  const observedFields = useMemo(
    () => activeFields.filter((field) => scanOf(field).state === 'completed').length,
    [activeFields],
  );

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
      if (isUnauthorized(cause)) expire();
      else setError(cause instanceof Error ? cause.message : '文件来源创建失败。');
      setLoading(false);
    }
  }

  async function observeField(field: MaterialField) {
    setObservingFieldId(field.fieldId);
    setError('');
    try {
      const result = await helixAdminApi.observeMaterialField(field);
      setOperations((current) => ({ ...current, [field.fieldId]: result }));
      await loadFields(true);
    } catch (cause) {
      if (isUnauthorized(cause)) expire();
      else setError(cause instanceof Error ? cause.message : '文件来源扫描失败。');
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
      if (isUnauthorized(cause)) expire();
      else setError(cause instanceof Error ? cause.message : '注销文件来源失败。');
    } finally {
      setDeregisteringFieldId('');
    }
  }

  if (!fields.length && loading && !error) return <LoadingState>正在读取文件来源…</LoadingState>;

  return <section className="source-page">
    <PageHeader title="文件来源配置" description="指定本机电影目录。登记不会移动、改名或删除任何文件。" actions={<Button variant="primary" type="button" onClick={() => setShowCreate((value) => !value)}>{showCreate ? '收起' : '添加电影来源'}</Button>} />
    <div className="source-facts facts-3" aria-label="文件来源摘要">
      <div><span>活动来源</span><strong>{activeFields.length}</strong><small>可扫描的电影目录</small></div>
      <div><span>已扫描</span><strong>{observedFields}</strong><small>已经看过目录内容</small></div>
      <div><span>媒体类型</span><strong>电影</strong><small>其他类型暂不开放</small></div>
    </div>
    {showCreate && <form className="source-create" onSubmit={createField}>
      <div className="source-create-heading"><div><h2>添加电影文件来源</h2></div><span>不会立即扫描</span></div>
      <div className="source-form-grid">
        <label><span>来源名称</span><input value={name} onChange={(event) => setName(event.target.value)} required /></label>
        <label className="wide"><span>电影目录</span><input value={rootLocation} onChange={(event) => setRootLocation(event.target.value)} placeholder="例如 E:\\Movies 或 /media/Film" required /></label>
        <label><span>只包含这些子目录</span><textarea value={includedDirectories} onChange={(event) => setIncludedDirectories(event.target.value)} placeholder="留空表示整个来源；每行一个相对目录" /></label>
        <label><span>排除这些子目录</span><textarea value={excludedDirectories} onChange={(event) => setExcludedDirectories(event.target.value)} placeholder="例如 Extras 或临时下载" /></label>
      </div>
      <div className="source-create-footer"><p>保存时会检查目录是否存在、可读，并且扫描范围不会超出该目录。</p><Button variant="primary" type="submit" disabled={loading}>{loading ? '正在保存…' : '保存文件来源'}</Button></div>
    </form>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="source-registry">
      <div className="source-registry-heading"><div><h2>当前文件来源</h2></div><Button type="button" onClick={() => void loadFields()} disabled={loading}>刷新</Button></div>
      {fields.length === 0 ? <div className="source-empty"><strong>还没有文件来源</strong><p>先登记一个本机可读取的电影目录。保存时会检查目录是否可达。</p></div> : fields.map((field) => {
        const scan = scanOf(field);
        const observing = observingFieldId === field.fieldId;
        const scanBusy = observing || scan.state === 'scanning';
        return <article className="source-record" key={field.fieldId}>
        <div className="source-record-main">
          <div className="source-record-title"><span className={`status-dot ${field.status}`} /><div><h3>{field.name}</h3><p>{field.access.rootLocation}</p><span className="source-state">{field.status === 'active' ? '活动来源' : '已注销'}</span></div></div>
          <dl>
            <div><dt>内容类型</dt><dd>{field.currentProfileHintSnapshot.contentProfileHint === 'movie' ? '电影' : field.currentProfileHintSnapshot.contentProfileHint}</dd></div>
            <div><dt>目录位置</dt><dd>已绑定</dd></div>
            <div><dt>扫描状态</dt><dd>{scanLabel(field)}</dd></div>
            <div><dt>扫描进度</dt><dd>{scan.pageCount > 0 ? `${scan.pageCount} 页` : '尚未开始'}</dd></div>
          </dl>
        </div>
        <div className="source-record-action">
          {field.status === 'active' && confirmDeregisterFieldId !== field.fieldId && <>
            <Button variant="primary" type="button" disabled={observingFieldId.length > 0 || deregisteringFieldId.length > 0 || scanBusy} onClick={() => void observeField(field)}>{observing ? '正在扫描…' : '扫描新文件'}</Button>
            <Button type="button" disabled={observingFieldId.length > 0 || deregisteringFieldId.length > 0} onClick={() => setConfirmDeregisterFieldId(field.fieldId)}>注销文件来源</Button>
            <small>扫描只读取目录，不会移动或删除文件。进行中时不能再点；完成后可随时扫描新文件。</small>
          </>}
          {field.status === 'active' && confirmDeregisterFieldId === field.fieldId && <div className="source-stop-confirm" role="alert">
            <strong>注销这个文件来源？</strong>
            <small>停止新的扫描；已发现的电影仍会继续整理。不会删除、移动或重命名任何媒体文件。</small>
            <div><Button type="button" onClick={() => setConfirmDeregisterFieldId('')}>取消</Button><Button variant="danger" type="button" disabled={deregisteringFieldId.length > 0} onClick={() => void deregisterField(field)}>{deregisteringFieldId === field.fieldId ? '正在注销…' : '确认注销'}</Button></div>
          </div>}
          {field.status === 'deregistered' && <small>不再扫描这个目录。历史记录保留，媒体文件不变。</small>}
        </div>
        {field.status === 'active' && <div className="source-journey" role="status">
          <strong>{operations[field.fieldId] && scan.state !== 'completed' ? '扫描已开始' : scanLabel(field)}</strong>
          <span>{scanProgress(field)}</span>
        </div>}
        {field.status === 'active' && <RoutingPolicyPanel field={field} shelves={shelves} />}
        <details><summary>技术标识</summary><code>{field.fieldId}</code><code>{field.access.endpointId}</code><code>{field.access.mountScopeId}</code></details>
      </article>;
      })}
    </div>
  </section>;
}
