import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { helixAdminApi, materialFieldRegistration, type FieldIntakeAdmission, type MaterialField, type Shelf } from './api';
import { newOpaqueId } from './id';
import { Button, LoadingState, PageHeader } from './chrome';
import { observationScanLabels } from './labels';
import RoutingPolicyPanel from './RoutingPolicyPanel';
import { isUnauthorized, useSession } from './session';

function newFieldId() {
  return newOpaqueId('movie-field-');
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
  const [intakeAdmission, setIntakeAdmission] = useState<Record<string, FieldIntakeAdmission>>({});
  const [seatDrafts, setSeatDrafts] = useState<Record<string, string>>({});
  const [savingSeatsFieldId, setSavingSeatsFieldId] = useState('');
  const [editingSeatsFieldId, setEditingSeatsFieldId] = useState('');

  const loadFields = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      const [result, shelfResult] = await Promise.all([helixAdminApi.listMaterialFields(), helixAdminApi.listShelves()]);
      setFields(result.items);
      setShelves(shelfResult.items);
      const active = result.items.filter((field) => field.status === 'active');
      const admissions = await Promise.all(active.map(async (field) => {
        try {
          return [field.fieldId, await helixAdminApi.getFieldIntakeAdmission(field.fieldId)] as const;
        } catch {
          return [field.fieldId, null] as const;
        }
      }));
      const nextAdmission: Record<string, FieldIntakeAdmission> = {};
      const nextDrafts: Record<string, string> = {};
      for (const [fieldId, admission] of admissions) {
        if (!admission) continue;
        nextAdmission[fieldId] = admission;
        nextDrafts[fieldId] = String(admission.predeckPipelineSeats);
      }
      setIntakeAdmission(nextAdmission);
      setSeatDrafts(nextDrafts);
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
      await helixAdminApi.observeMaterialField(field);
      await loadFields(true);
    } catch (cause) {
      if (isUnauthorized(cause)) expire();
      else setError(cause instanceof Error ? cause.message : '文件来源扫描失败。');
    } finally {
      setObservingFieldId('');
    }
  }

  async function saveIntakeSeats(field: MaterialField) {
    const raw = seatDrafts[field.fieldId] ?? '3';
    const seats = Number(raw);
    if (!Number.isInteger(seats) || seats < 0 || seats > 8) {
      setError('整理门口席位必须是 0 到 8 的整数。');
      return;
    }
    setSavingSeatsFieldId(field.fieldId);
    setError('');
    try {
      const admission = await helixAdminApi.patchFieldIntakeAdmission(field.fieldId, { predeckPipelineSeats: seats });
      setIntakeAdmission((current) => ({ ...current, [field.fieldId]: admission }));
      setSeatDrafts((current) => ({ ...current, [field.fieldId]: String(admission.predeckPipelineSeats) }));
    } catch (cause) {
      if (isUnauthorized(cause)) expire();
      else setError(cause instanceof Error ? cause.message : '整理门口席位保存失败。');
    } finally {
      setSavingSeatsFieldId('');
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

  return <section className="source-page material-fields-page">
    <PageHeader title="文件来源" actions={<Button variant="primary" type="button" onClick={() => setShowCreate((value) => !value)}>{showCreate ? '收起' : '添加电影来源'}</Button>} />
    {showCreate && <form className="source-create" onSubmit={createField}>
      <div className="source-create-heading"><div><h2>添加电影文件来源</h2></div></div>
      <div className="source-form-grid">
        <label><span>来源名称</span><input value={name} onChange={(event) => setName(event.target.value)} required /></label>
        <label className="wide"><span>电影目录</span><input value={rootLocation} onChange={(event) => setRootLocation(event.target.value)} placeholder="例如 E:\\Movies 或 /media/Film" required /></label>
        <label><span>只包含这些子目录</span><textarea value={includedDirectories} onChange={(event) => setIncludedDirectories(event.target.value)} placeholder="留空表示整个来源；每行一个相对目录" /></label>
        <label><span>排除这些子目录</span><textarea value={excludedDirectories} onChange={(event) => setExcludedDirectories(event.target.value)} placeholder="例如 Extras 或临时下载" /></label>
      </div>
      <div className="source-create-footer"><Button variant="primary" type="submit" disabled={loading}>{loading ? '正在保存…' : '保存文件来源'}</Button></div>
    </form>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="source-registry">
      <div className="source-registry-heading"><Button type="button" onClick={() => void loadFields()} disabled={loading}>刷新</Button></div>
      {fields.length === 0 ? <div className="source-empty"><strong>还没有文件来源</strong></div> : fields.map((field) => {
        const scan = scanOf(field);
        const observing = observingFieldId === field.fieldId;
        const scanBusy = observing || scan.state === 'scanning';
        const admission = intakeAdmission[field.fieldId];
        const generated = field.procurementStatus.generatedPackageCount;
        const acceptedPercent = generated > 0 ? (field.procurementStatus.acceptedPackageCount / generated) * 100 : 0;
        const waitingPercent = generated > 0 ? (field.procurementStatus.waitingAcceptanceCount / generated) * 100 : 0;
        return <article className="source-record" key={field.fieldId}>
        <header className="source-record-head">
          <div className="source-record-title"><div><h3>{field.name}</h3><p>{field.access.rootLocation}</p><span className="source-state" data-state={field.status}>{field.status === 'active' ? '活动来源' : '已注销'}</span></div></div>
          <div className="source-record-action">
          {field.status === 'active' && confirmDeregisterFieldId !== field.fieldId && <>
            <Button variant="primary" type="button" disabled={observingFieldId.length > 0 || deregisteringFieldId.length > 0 || scanBusy} onClick={() => void observeField(field)}>{observing ? '正在扫描…' : '扫描新文件'}</Button>
            <Button type="button" disabled={observingFieldId.length > 0 || deregisteringFieldId.length > 0} onClick={() => setConfirmDeregisterFieldId(field.fieldId)}>注销文件来源</Button>
          </>}
          {field.status === 'active' && confirmDeregisterFieldId === field.fieldId && <div className="source-stop-confirm" role="alert">
            <strong>注销这个文件来源？</strong>
            <small>停止新的扫描；已发现的电影仍会继续整理。不会删除、移动或重命名任何媒体文件。</small>
            <div><Button type="button" onClick={() => setConfirmDeregisterFieldId('')}>取消</Button><Button variant="danger" type="button" disabled={deregisteringFieldId.length > 0} onClick={() => void deregisterField(field)}>{deregisteringFieldId === field.fieldId ? '正在注销…' : '确认注销'}</Button></div>
          </div>}
          </div>
        </header>
        <div className="source-flow-grid">
          <section className="source-flow-panel source-flow-procurement" aria-label={`${field.name} 材料准备进度`}>
            <div className="source-flow-heading"><span>材料准备</span><strong>待整理媒体包</strong></div>
            <div className="source-handoff-ledger">
              <div><span>已生成</span><strong>{generated}</strong></div>
              <div><span>已接收</span><strong>{field.procurementStatus.acceptedPackageCount}</strong></div>
              <div><span>等待接收</span><strong>{field.procurementStatus.waitingAcceptanceCount}</strong></div>
            </div>
            <div className="source-handoff-bar" aria-label={`已生成 ${generated}，已接收 ${field.procurementStatus.acceptedPackageCount}，等待接收 ${field.procurementStatus.waitingAcceptanceCount}`}>
              <span className="accepted" style={{ width: `${acceptedPercent}%` }} />
              <span className="waiting" style={{ width: `${waitingPercent}%` }} />
            </div>
            {field.procurementStatus.rejectedPackageCount > 0 && <p className="source-flow-exception ui-state">接收被拒 · {field.procurementStatus.rejectedPackageCount} 包</p>}
          </section>
          <section className="source-flow-panel source-flow-libra" aria-label={`${field.name} 同时整理数量`}>
            <div className="source-flow-heading"><span>媒体整理</span><strong>接收席位</strong></div>
            {field.status === 'active' && admission ? <>
              <div className="source-seat-number"><strong>{admission.pipelineTokensHeld}</strong><span>正在占用</span><em>/ {admission.predeckPipelineSeats} 个席位</em></div>
              <p className={admission.predeckPipelineSeats === 0 ? 'source-seat-zero' : ''}>{admission.predeckPipelineSeats === 0
                ? '暂停接收'
                : admission.pipelineSeatsFree > 0 ? `空闲 ${admission.pipelineSeatsFree} 个席位` : '席位已满'}</p>
              <Button type="button" onClick={() => setEditingSeatsFieldId((current) => current === field.fieldId ? '' : field.fieldId)}>{editingSeatsFieldId === field.fieldId ? '收起席位设置' : '调整席位'}</Button>
              {editingSeatsFieldId === field.fieldId && <div className="source-seat-editor">
                <label><span>固定席位数（0–8）</span><input type="number" min={0} max={8} value={seatDrafts[field.fieldId] ?? String(admission.predeckPipelineSeats)} onChange={(event) => setSeatDrafts((current) => ({ ...current, [field.fieldId]: event.target.value }))} /></label>
                <Button type="button" disabled={savingSeatsFieldId.length > 0} onClick={() => void saveIntakeSeats(field)}>{savingSeatsFieldId === field.fieldId ? '正在保存…' : '保存席位'}</Button>
              </div>}
            </> : field.status === 'active' ? <p className="ui-state">席位状态暂不可用</p> : null}
          </section>
        </div>
        {field.status === 'active' && <details className="source-operating-detail"><summary>扫描与来源详情 <span className="ui-state" data-state={scan.state}>{scanLabel(field)}</span></summary>
          {scan.state === 'failed' && <p className="form-error" role="alert">{scan.failureMessage || '电影目录不存在或当前不可读取。'}</p>}
          <dl>
            <div><dt>内容类型</dt><dd>{field.currentProfileHintSnapshot.contentProfileHint === 'movie' ? '电影' : field.currentProfileHintSnapshot.contentProfileHint}</dd></div>
            <div><dt>扫描页数</dt><dd>{scan.pageCount > 0 ? `${scan.pageCount} 页` : '尚未开始'}</dd></div>
            <div><dt>分拣批次</dt><dd>{field.procurementStatus.activeRunCount > 0 ? `${field.procurementStatus.activeRunCount} 个进行中` : '没有进行中批次'}</dd></div>
          </dl>
        </details>}
        {field.status === 'active' && <RoutingPolicyPanel field={field} shelves={shelves} />}
        <details><summary>技术标识</summary><code>{field.fieldId}</code><code>{field.access.endpointId}</code><code>{field.access.mountScopeId}</code></details>
      </article>;
      })}
    </div>
  </section>;
}
