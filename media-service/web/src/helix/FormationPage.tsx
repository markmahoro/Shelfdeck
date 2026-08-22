import { useCallback, useEffect, useState } from 'react';
import { helixAdminApi, type FormationRunHistory, type FormationSubject, type FormationSummary, type Shelf } from './api';
import { Button, LoadingState, PageHeader } from './chrome';
import RatingControl from './RatingControl';
import { isUnauthorized, useSession } from './session';

const emptySummary: FormationSummary = { totalCount: 0, pendingCount: 0, inProgressCount: 0, attentionRequiredCount: 0, completedCount: 0 };
const classificationLabels: Record<FormationSubject['classification'], string> = {
  pending: '待整理', in_progress: '整理中', attention_required: '需要处理', completed: '已完成整理',
};
function formatTime(value: number) {
  return value > 0 ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';
}
function progress(item: FormationSubject) {
  const value = item.nextAction.progress;
  if (!value || value.mode !== 'determinate' || !value.totalValue) return null;
  return Math.min(100, Math.round(((value.currentValue || 0) / value.totalValue) * 100));
}
function canChooseShelf(item: FormationSubject) {
  return item.routingState === 'unresolved' && Number.isSafeInteger(item.routingDecisionHeadRevision) && Boolean(item.routingDecisionHeadDigest);
}

type TableProps = {
  items: FormationSubject[];
  shelves: Shelf[];
  loading: boolean;
  onChoose: (item: FormationSubject, shelfId: string) => void;
  onExpedite: (item: FormationSubject, value: boolean) => void;
  onChooseIdentity: (item: FormationSubject, tmdbMovieId: string) => void;
  onDiscard: (item: FormationSubject) => void;
  onRetryAcceptance: (item: FormationSubject) => void;
};

function CurrentMediaTable({ items, shelves, loading, onChoose, onExpedite, onChooseIdentity, onDiscard, onRetryAcceptance }: TableProps) {
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [identityIds, setIdentityIds] = useState<Record<string, string>>({});
  return <div className="formation-table-wrap"><table className="formation-table"><thead><tr>
    <th>媒体名称</th><th>当前状态</th><th>我的评分</th><th>目标收藏架</th><th>整理要求</th><th>整理动作</th><th>下一步</th>
  </tr></thead><tbody>{items.map((item) => {
    const percent = progress(item);
    return <tr key={item.subjectId}>
      <td><strong>{item.displayIdentity}</strong><small>{formatTime(item.addedAtMs)}</small></td>
      <td>{classificationLabels[item.classification]}</td>
      <td><RatingControl targetType="subject" targetId={item.subjectId} label={item.displayIdentity} initialRating={item.myRating} initialSource={item.myRatingSource} initialRevision={item.myRatingRevision} /></td>
      <td>{item.targetShelfId ? (item.targetShelfName || shelves.find((shelf) => shelf.shelfId === item.targetShelfId)?.name || '已选收藏架') : canChooseShelf(item) ? <div className="manual-shelf">
        <select aria-label={`${item.displayIdentity}的目标收藏架`} value={targets[item.subjectId] || shelves[0]?.shelfId || ''} onChange={(event) => setTargets((current) => ({ ...current, [item.subjectId]: event.target.value }))}>{shelves.map((shelf) => <option key={shelf.shelfId} value={shelf.shelfId}>{shelf.name}</option>)}</select>
        <Button type="button" disabled={loading || !shelves.length} onClick={() => onChoose(item, targets[item.subjectId] || shelves[0]?.shelfId)}>选择</Button>
      </div> : <small>{item.routingState === 'preparing' ? '等待发布分拣策略' : '等待分拣结果'}</small>}</td>
      <td>{item.organizingRequirement}</td>
      <td>{item.organizingAction}</td>
      <td>
        <strong>{item.nextAction.label}</strong>
        {percent === null ? <>{item.nextAction.progress?.mode === 'indeterminate' && <progress aria-label={`${item.displayIdentity}正在整理`} />}</> : <><progress max={100} value={percent} aria-label={`${item.displayIdentity}整理进度 ${percent}%`} /><small>{percent}%</small></>}
        {item.executorIssue && <div className="executor-issue" role="status">
          <small>整理出错，可以重试</small>
          <details><summary>详细信息</summary><small>阶段：{item.executorIssue.phase}</small><small>错误：{item.executorIssue.errorCode}</small></details>
          <Button variant="primary" type="button" disabled={loading || !item.executorIssue.canRetry} onClick={() => onRetryAcceptance(item)}>重试</Button>
        </div>}
        {item.productIdentityIssue && item.currentRun && !['frozen', 'discarded'].includes(item.currentRun.state) && <div className="manual-shelf">
          <label><span className="sr-only">TMDB 编号</span><input aria-label={`${item.displayIdentity}的 TMDB 编号`} inputMode="numeric" placeholder="TMDB 编号" value={identityIds[item.subjectId] || ''} onChange={(event) => setIdentityIds((current) => ({ ...current, [item.subjectId]: event.target.value.replace(/\D/g, '') }))} /></label>
          <Button type="button" disabled={loading || !/^\d+$/.test(identityIds[item.subjectId] || '')} onClick={() => onChooseIdentity(item, identityIds[item.subjectId])}>验证此身份</Button>
          {item.productIdentityIssue.candidates.map((candidate) => <Button type="button" key={candidate.providerKey} disabled={loading} onClick={() => onChooseIdentity(item, candidate.providerKey)}>{candidate.displayTitle}{candidate.releaseYear ? ` (${candidate.releaseYear})` : ''}</Button>)}
        </div>}
        {item.currentRun?.state === 'frozen' && <Button type="button" disabled={loading} onClick={() => onDiscard(item)}>放弃本次整理</Button>}
        {item.currentRun?.state === 'active' && !item.handoffB && <Button type="button" disabled={loading} onClick={() => onExpedite(item, item.currentRun?.priorityClass !== 'expedited')}>{item.currentRun.priorityClass === 'expedited' ? '取消加快' : '加快整理'}</Button>}
      </td>
    </tr>;
  })}</tbody></table></div>;
}

function CompletedMediaTable({ items }: { items: FormationSubject[] }) {
  return <div className="formation-table-wrap"><table className="formation-table"><thead><tr>
    <th>媒体名称</th><th>目标收藏架</th><th>整理要求</th><th>整理动作</th><th>完成时间</th>
  </tr></thead><tbody>{items.map((item) => <tr key={item.subjectId}>
    <td><strong>{item.displayIdentity}</strong></td>
    <td>{item.targetShelfName || '—'}</td>
    <td>{item.organizingRequirement}</td>
    <td>{item.organizingAction}</td>
    <td>{formatTime(item.completedAtMs || 0)}</td>
  </tr>)}</tbody></table></div>;
}

export default function FormationPage() {
  const { expire } = useSession();
  const [items, setItems] = useState<FormationSubject[]>([]);
  const [completed, setCompleted] = useState<FormationSubject[]>([]);
  const [ended, setEnded] = useState<FormationRunHistory[]>([]);
  const [summary, setSummary] = useState<FormationSummary>(emptySummary);
  const [shelves, setShelves] = useState<Shelf[]>([]);
  const [expanded, setExpanded] = useState(() => { try { return localStorage.getItem('formation-completed-expanded') === 'true'; } catch { return false; } });
  const [endedExpanded, setEndedExpanded] = useState(() => { try { return localStorage.getItem('formation-ended-expanded') === 'true'; } catch { return false; } });
  const [activeCursor, setActiveCursor] = useState<string | null>(null);
  const [completedCursor, setCompletedCursor] = useState<string | null>(null);
  const [endedCursor, setEndedCursor] = useState<string | null>(null);
  const [projection, setProjection] = useState<{ status: 'ready' | 'rebuilding' | 'stale'; asOfMs: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [active, shelfResult] = await Promise.all([helixAdminApi.listFormation('active'), helixAdminApi.listShelves()]);
      setItems(active.items); setActiveCursor(active.nextCursor); setSummary(active.summary); setProjection(active.projection);
      setShelves(shelfResult.items.filter((item) => item.status === 'active'));
      if (expanded) {
        const done = await helixAdminApi.listFormation('completed');
        setCompleted(done.items); setCompletedCursor(done.nextCursor);
      }
      if (endedExpanded) {
        const history = await helixAdminApi.listFormationHistory();
        setEnded(history.items); setEndedCursor(history.nextCursor);
      }
    } catch (cause) {
      if (isUnauthorized(cause)) expire();
      else setError(cause instanceof Error ? cause.message : '媒体整理工作区读取失败。');
    } finally { setLoading(false); }
  }, [expire, expanded, endedExpanded]);
  useEffect(() => { void load(); }, [load]);
  const tableProps = {
    shelves, loading,
    onChoose: async (item: FormationSubject, shelfId: string) => { if (!shelfId) return; setLoading(true); try { await helixAdminApi.chooseShelf(item, shelfId); await load(); } catch (cause) { if (isUnauthorized(cause)) expire(); else setError(cause instanceof Error ? cause.message : '收藏架选择失败。'); setLoading(false); } },
    onExpedite: async (item: FormationSubject, value: boolean) => { setLoading(true); try { await helixAdminApi.setRunExpedited(item, value); await load(); } catch (cause) { if (isUnauthorized(cause)) expire(); else setError(cause instanceof Error ? cause.message : '整理优先级修改失败。'); setLoading(false); } },
    onDiscard: async (item: FormationSubject) => { if (!window.confirm(`确认放弃“${item.displayIdentity}”的本次整理？原始媒体不会因此删除。`)) return; setLoading(true); try { await helixAdminApi.discardRun(item); await load(); } catch (cause) { if (isUnauthorized(cause)) expire(); else setError(cause instanceof Error ? cause.message : '放弃本次整理失败。'); setLoading(false); } },
    onChooseIdentity: async (item: FormationSubject, tmdbMovieId: string) => { setLoading(true); try { await helixAdminApi.chooseProductIdentity(item, tmdbMovieId); await load(); } catch (cause) { if (isUnauthorized(cause)) expire(); else setError(cause instanceof Error ? cause.message : '媒体身份确认失败。'); setLoading(false); } },
    onRetryAcceptance: async (item: FormationSubject) => { setLoading(true); try { await helixAdminApi.retryAcceptance(item); await load(); } catch (cause) { if (isUnauthorized(cause)) expire(); else setError(cause instanceof Error ? cause.message : '重试失败。'); setLoading(false); } },
  };
  if (!projection && !error && loading) return <LoadingState>正在读取媒体整理工作区…</LoadingState>;
  return <section className="source-page workbench formation-page">
    <PageHeader title="媒体整理工作区" description="查看待整理、整理中、需要处理和已经上架的媒体。" actions={<Button type="button" onClick={() => void load()} disabled={loading}>{loading ? '正在刷新…' : '刷新'}</Button>} />
    {projection && <p className="formation-projection-state">{projection.status === 'ready' ? '展示已更新' : projection.status === 'rebuilding' ? '正在更新展示' : '展示可能稍有滞后'} · {formatTime(projection.asOfMs)}</p>}
    <div className="source-facts" aria-label="整理状态摘要">
      <div><span>待整理</span><strong>{summary.pendingCount}</strong></div>
      <div><span>整理中</span><strong>{summary.inProgressCount}</strong></div>
      <div><span>需要处理</span><strong>{summary.attentionRequiredCount}</strong></div>
      <div><span>已完成整理</span><strong>{summary.completedCount}</strong></div>
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <section className="formation-ledger">
      <div className="source-registry-heading"><div><h2>当前媒体</h2></div><span>当前显示 {items.length} 条</span></div>
      {items.length ? <>
        <CurrentMediaTable items={items} {...tableProps} />
        {activeCursor && <Button type="button" onClick={() => void (async () => { if (!activeCursor) return; setLoading(true); try { const result = await helixAdminApi.listFormation('active', activeCursor); setItems((current) => [...current, ...result.items]); setActiveCursor(result.nextCursor); setProjection(result.projection); } finally { setLoading(false); } })()} disabled={loading}>加载更多当前媒体</Button>}
      </> : <div className="source-empty"><strong>当前没有未完成媒体</strong></div>}
    </section>
    <section className="formation-ledger">
      <div className="source-registry-heading"><div><h2>已完成整理</h2></div>
        <Button type="button" aria-expanded={expanded} onClick={() => { const value = !expanded; setExpanded(value); try { localStorage.setItem('formation-completed-expanded', String(value)); } catch { /* ignore */ } if (value) { setLoading(true); void helixAdminApi.listFormation('completed').then((result) => { setCompleted(result.items); setCompletedCursor(result.nextCursor); }).finally(() => setLoading(false)); } }}>{expanded ? '收起' : '展开'}（{summary.completedCount}）</Button>
      </div>
      {expanded && <>{completed.length ? <CompletedMediaTable items={completed} /> : <div className="source-empty"><strong>尚无完成条目</strong></div>}
        {completedCursor && <Button type="button" onClick={() => void (async () => { if (!completedCursor) return; setLoading(true); try { const result = await helixAdminApi.listFormation('completed', completedCursor); setCompleted((current) => [...current, ...result.items]); setCompletedCursor(result.nextCursor); } finally { setLoading(false); } })()} disabled={loading}>加载更多</Button>}</>}
    </section>
    <section className="formation-ledger">
      <div className="source-registry-heading"><div><h2>已结束</h2></div>
        <Button type="button" aria-expanded={endedExpanded} onClick={() => { const value = !endedExpanded; setEndedExpanded(value); try { localStorage.setItem('formation-ended-expanded', String(value)); } catch { /* ignore */ } if (value) { setLoading(true); void helixAdminApi.listFormationHistory().then((result) => { setEnded(result.items); setEndedCursor(result.nextCursor); }).finally(() => setLoading(false)); } }}>{endedExpanded ? '收起' : '展开'}</Button>
      </div>
      {endedExpanded && <>{ended.length ? <div className="formation-table-wrap"><table className="formation-table"><thead><tr><th>媒体名称</th><th>结果</th><th>结束时间</th></tr></thead><tbody>{ended.map((item) => <tr key={item.historyId}><td><strong>{item.displayIdentity}</strong></td><td>{item.label}</td><td>{formatTime(item.endedAtMs)}</td></tr>)}</tbody></table></div> : <div className="source-empty"><strong>尚无已结束记录</strong></div>}
        {endedCursor && <Button type="button" onClick={() => void (async () => { if (!endedCursor) return; setLoading(true); try { const result = await helixAdminApi.listFormationHistory(endedCursor); setEnded((current) => [...current, ...result.items]); setEndedCursor(result.nextCursor); } finally { setLoading(false); } })()} disabled={loading}>加载更多</Button>}</>}
    </section>
  </section>;
}
