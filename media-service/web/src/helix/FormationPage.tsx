import { FormEvent, useCallback, useEffect, useState } from 'react';
import { AdminApiError, helixAdminApi, type FormationSubject, type FormationSummary, type Shelf } from './api';
import RatingControl from './RatingControl';

type SessionState = 'checking' | 'required' | 'ready';

function formatAcceptedAt(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export default function FormationPage() {
  const [session, setSession] = useState<SessionState>('checking');
  const [apiKey, setApiKey] = useState('');
  const [items, setItems] = useState<FormationSubject[]>([]);
  const [summary, setSummary] = useState<FormationSummary>({ subjectCount: 0, preparingCount: 0, unresolvedCount: 0, resolvedCount: 0 });
  const [shelves, setShelves] = useState<Shelf[]>([]);
  const [manualTargets, setManualTargets] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [result, shelfResult] = await Promise.all([helixAdminApi.listFormation(), helixAdminApi.listShelves()]);
      setItems(result.items);
      setSummary(result.summary);
      setShelves(shelfResult.items.filter((item) => item.status === 'active'));
      setSession('ready');
    } catch (cause) {
      if (cause instanceof AdminApiError && cause.status === 401) setSession('required');
      else setError(cause instanceof Error ? cause.message : '上架进度读取失败。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

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

  async function chooseShelf(item: FormationSubject) {
    const target = manualTargets[item.subjectId] || shelves[0]?.shelfId;
    if (!target) { setError('没有可用的活动收藏架。'); return; }
    setLoading(true); setError('');
    try { await helixAdminApi.chooseShelf(item, target); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '一次性收藏架选择失败。'); setLoading(false); }
  }

  async function setExpedited(item: FormationSubject, expedited: boolean) {
    setLoading(true); setError('');
    try { await helixAdminApi.setRunExpedited(item, expedited); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '上架优先级修改失败。'); setLoading(false); }
  }

  if (session === 'checking') {
    return <section className="source-page source-page-loading" aria-live="polite">正在读取上架进度…</section>;
  }

  if (session === 'required') {
    return <section className="source-page auth-stage"><div className="auth-card">
      <p className="eyebrow">本机管理会话</p>
      <h1>查看上架进度</h1>
      <p>输入 clean initialization 生成的管理凭据。凭据只用于换取本机 HttpOnly 会话。</p>
      <form onSubmit={signIn} className="auth-form">
        <label><span>管理凭据</span><input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} autoComplete="current-password" required /></label>
        <button type="submit" disabled={loading || !apiKey.trim()}>{loading ? '正在验证…' : '进入管理台'}</button>
      </form>
      {error && <p className="form-error" role="alert">{error}</p>}
    </div></section>;
  }

  return <section className="source-page formation-page">
    <header className="source-hero"><div>
      <p className="eyebrow">上架进度 · Libra</p>
      <h1>每一行，都是已经接收的一份收藏主体</h1>
      <p>这里从 Libra Intake Accepted 开始记录。Candidate 仍属于 Procurement；只有通过完整性、现实一致性与责任交接验证后，才会成为这里的一行 Subject。</p>
    </div><button className="surface-action" type="button" onClick={() => void load()} disabled={loading}>{loading ? '刷新中…' : '刷新'}</button></header>

    <div className="source-facts" aria-label="上架进度摘要">
      <div><span>已接收 Subject</span><strong>{summary.subjectCount}</strong><small>一 Subject 一行</small></div>
      <div><span>已确定目的地</span><strong>{summary.resolvedCount}</strong><small>immutable Routing Decision</small></div>
      <div><span>待处理 / 未解决</span><strong>{summary.preparingCount} / {summary.unresolvedCount}</strong><small>不会误入 catch-all</small></div>
    </div>

    {error && <p className="form-error" role="alert">{error}</p>}

    <section className="formation-ledger" aria-labelledby="formation-title">
      <div className="source-registry-heading"><div><p className="eyebrow">Activity Ledger</p><h2 id="formation-title">收藏主体</h2></div><span>{items.length} 条</span></div>
      {items.length === 0 ? <div className="source-empty"><strong>还没有被 Libra 接收的 Candidate</strong><p>Procurement Offer 会由后台 Intake Work 验证；正式接收后才会出现在这里。</p></div> :
        <div className="formation-table-wrap"><table className="formation-table">
          <thead><tr><th scope="col">Subject</th><th scope="col">Routing</th><th scope="col">我的评分</th><th scope="col">输入</th><th scope="col">Decision / Spec</th><th scope="col">最近接收</th></tr></thead>
          <tbody>{items.map((item) => <tr key={item.subjectId}>
            <td><strong>{item.displayIdentity}</strong><code>{item.subjectId}</code><small>{item.contentProfile} · {item.structureKind}</small></td>
            <td><span className={`formation-stage ${item.routingState}`}>{item.stageLabel}</span>
              {item.targetShelfId && <small>{shelves.find((shelf) => shelf.shelfId === item.targetShelfId)?.name || item.targetShelfId}</small>}
              {item.unresolvedReasonCode && <small>{item.unresolvedReasonCode}</small>}
              {item.routingState === 'unresolved' && <div className="manual-shelf"><select aria-label={`${item.displayIdentity}的一次性收藏架`} value={manualTargets[item.subjectId] || shelves[0]?.shelfId || ''}
                onChange={(event) => setManualTargets((current) => ({ ...current, [item.subjectId]: event.target.value }))}>{shelves.map((shelf) => <option key={shelf.shelfId} value={shelf.shelfId}>{shelf.name}</option>)}</select>
                <button type="button" onClick={() => void chooseShelf(item)} disabled={loading}>选择收藏架</button></div>}
            </td>
            <td><RatingControl targetType="subject" targetId={item.subjectId} label={item.displayIdentity}/></td>
            <td><b>{item.primaryMaterialCount}</b> Primary<small>{item.relatedMaterialCount} Related</small></td>
            <td>{item.routingDecisionRevision ? `Routing r${item.routingDecisionRevision}` : '准备中'}<small>{item.routingPolicyMode || '—'} {item.routingPolicyRevision ? `· policy r${item.routingPolicyRevision}` : ''}</small>
              <small>{item.acceptanceSpecRevision ? `Acceptance Spec r${item.acceptanceSpecRevision}` : item.routingState==='resolved'?'正在准备 Acceptance Spec':'—'}</small>
              {item.currentRun && <small>Libra Run · {item.productionStage} · {item.currentRun.priorityClass === 'expedited' ? '加急' : '普通'}</small>}
              {item.handoffB && <small>Handoff B Offer · open</small>}
              {item.currentRun?.state === 'active' && !item.handoffB && <button className="surface-action" type="button"
                onClick={() => void setExpedited(item, item.currentRun?.priorityClass !== 'expedited')} disabled={loading}>
                {item.currentRun.priorityClass === 'expedited' ? '取消加快' : '加快上架'}
              </button>}</td>
            <td>{formatAcceptedAt(item.lastAcceptedAtMs)}</td>
          </tr>)}</tbody>
        </table></div>}
    </section>
  </section>;
}
