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
type OrganizingStep = FormationSubject['organizingSteps'][number];
function stepsOf(item: FormationSubject): OrganizingStep[] {
  if (item.organizingSteps?.length) return item.organizingSteps;
  return [{ key: 'legacy', label: item.organizingAction || '正在评估整理方案', state: 'pending', progress: null }];
}
function stepPercent(step: OrganizingStep) {
  if (step.state === 'done') return 100;
  const value = step.progress;
  if (!value || value.mode !== 'determinate' || !value.totalValue) return null;
  return Math.min(100, Math.round(((value.currentValue || 0) / value.totalValue) * 100));
}
function canChooseShelf(item: FormationSubject) {
  return item.routingState === 'unresolved' && Number.isSafeInteger(item.routingDecisionHeadRevision) && Boolean(item.routingDecisionHeadDigest);
}
function canExpedite(item: FormationSubject) {
  return item.currentRun?.state === 'active' && !item.handoffB;
}
function userActionLabel(item: FormationSubject) {
  if (['attention_required', 'frozen', 'suspended', 'blocked'].includes(item.nextAction.state)) return item.nextAction.label;
  if (canChooseShelf(item)) return '等待选择目标收藏架';
  return null;
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

function OrganizingStepLabels({ item }: { item: FormationSubject }) {
  return <ol className="organizing-steps">{stepsOf(item).map((step) => <li key={step.key} data-state={step.state}><strong>{step.label}</strong></li>)}</ol>;
}

function OrganizingStepProgress({ item }: { item: FormationSubject }) {
  return <ol className="organizing-steps organizing-progress">{stepsOf(item).map((step) => {
    const percent = stepPercent(step);
    const label = `${item.displayIdentity} · ${step.label}`;
    return <li key={step.key} data-state={step.state}>
      {percent === null
        ? <progress aria-label={step.progress?.mode === 'indeterminate' || step.state === 'running' ? `${label}正在进行` : `${label}尚未开始`} />
        : <><progress max={100} value={percent} aria-label={`${label} ${percent}%`} /><small>{percent}%</small></>}
    </li>;
  })}</ol>;
}

function CurrentMediaTable({ items, shelves, loading, onChoose, onExpedite, onChooseIdentity, onDiscard, onRetryAcceptance }: TableProps) {
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [identityIds, setIdentityIds] = useState<Record<string, string>>({});
  return <div className="formation-table-wrap"><table className="formation-table formation-current-table"><thead><tr>
    <th>媒体名称</th><th>整理动作</th><th>分步进度</th><th>用户操作</th><th>加急</th>
  </tr></thead><tbody>{items.map((item) => {
    const reason = userActionLabel(item);
    const expedited = item.currentRun?.priorityClass === 'expedited';
    return <tr key={item.subjectId}>
      <td>
        <strong>{item.displayIdentity}</strong>
        <small>{classificationLabels[item.classification]} · {formatTime(item.addedAtMs)}</small>
        <small>{item.targetShelfId ? (item.targetShelfName || shelves.find((shelf) => shelf.shelfId === item.targetShelfId)?.name || '已选收藏架') : '尚未选定收藏架'}</small>
        <small>{item.organizingRequirement}</small>
        <RatingControl targetType="subject" targetId={item.subjectId} label={item.displayIdentity} initialRating={item.myRating} initialSource={item.myRatingSource} initialRevision={item.myRatingRevision} />
      </td>
      <td><OrganizingStepLabels item={item} /></td>
      <td><OrganizingStepProgress item={item} /></td>
      <td>
        {reason && <strong>{reason}</strong>}
        {canChooseShelf(item) && <div className="manual-shelf">
          <select aria-label={`${item.displayIdentity}的目标收藏架`} value={targets[item.subjectId] || shelves[0]?.shelfId || ''} onChange={(event) => setTargets((current) => ({ ...current, [item.subjectId]: event.target.value }))}>{shelves.map((shelf) => <option key={shelf.shelfId} value={shelf.shelfId}>{shelf.name}</option>)}</select>
          <Button type="button" disabled={loading || !shelves.length} onClick={() => onChoose(item, targets[item.subjectId] || shelves[0]?.shelfId)}>选择收藏架</Button>
        </div>}
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
      </td>
      <td>{canExpedite(item)
        ? <div className="expedite-cell"><small>{expedited ? '已加急' : '普通'}</small><Button type="button" disabled={loading} onClick={() => onExpedite(item, !expedited)}>{expedited ? '取消加快' : '加快整理'}</Button></div>
        : <small>—</small>}</td>
    </tr>;
  })}</tbody></table></div>;
}

function CompletedMediaTable({ items }: { items: FormationSubject[] }) {
  return <div className="formation-table-wrap"><table className="formation-table"><thead><tr>
    <th>媒体名称</th><th>目标收藏架</th><th>整理动作</th><th>完成时间</th>
  </tr></thead><tbody>{items.map((item) => <tr key={item.subjectId}>
    <td><strong>{item.displayIdentity}</strong><small>{item.organizingRequirement}</small></td>
    <td>{item.targetShelfName || '—'}</td>
    <td><OrganizingStepLabels item={item} /></td>
    <td>{formatTime(item.completedAtMs || 0)}</td>
  </tr>)}</tbody></table></div>;
}

type ActiveFilters = {
  classification?: 'pending' | 'in_progress' | 'attention_required';
  shelfId?: string;
  needsUserAction: boolean;
  expedited: boolean;
  q: string;
};
const emptyFilters: ActiveFilters = { needsUserAction: false, expedited: false, q: '' };

export default function FormationPage() {
  const { expire } = useSession();
  const [items, setItems] = useState<FormationSubject[]>([]);
  const [completed, setCompleted] = useState<FormationSubject[]>([]);
  const [ended, setEnded] = useState<FormationRunHistory[]>([]);
  const [summary, setSummary] = useState<FormationSummary>(emptySummary);
  const [shelves, setShelves] = useState<Shelf[]>([]);
  const [filters, setFilters] = useState<ActiveFilters>(emptyFilters);
  const [expanded, setExpanded] = useState(() => { try { return localStorage.getItem('formation-completed-expanded') === 'true'; } catch { return false; } });
  const [endedExpanded, setEndedExpanded] = useState(() => { try { return localStorage.getItem('formation-ended-expanded') === 'true'; } catch { return false; } });
  const [activeCursor, setActiveCursor] = useState<string | null>(null);
  const [completedCursor, setCompletedCursor] = useState<string | null>(null);
  const [endedCursor, setEndedCursor] = useState<string | null>(null);
  const [projection, setProjection] = useState<{ status: 'ready' | 'rebuilding' | 'stale'; asOfMs: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const queryFilters = {
    classification: filters.classification,
    shelfId: filters.shelfId,
    needsUserAction: filters.needsUserAction || undefined,
    expedited: filters.expedited || undefined,
    q: filters.q.trim() || undefined,
  };
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [active, shelfResult] = await Promise.all([helixAdminApi.listFormation('active', undefined, queryFilters), helixAdminApi.listShelves()]);
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
  }, [expire, expanded, endedExpanded, filters.classification, filters.shelfId, filters.needsUserAction, filters.expedited, filters.q]);
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
      <div className="formation-chips" role="group" aria-label="当前媒体状态">
        {([
          { id: undefined, label: `全部当前 ${summary.pendingCount + summary.inProgressCount + summary.attentionRequiredCount}` },
          { id: 'pending' as const, label: `待整理 ${summary.pendingCount}` },
          { id: 'in_progress' as const, label: `整理中 ${summary.inProgressCount}` },
          { id: 'attention_required' as const, label: `需要处理 ${summary.attentionRequiredCount}` },
        ]).map((chip) => <Button key={chip.label} type="button" aria-pressed={filters.classification === chip.id} onClick={() => setFilters((current) => ({ ...current, classification: chip.id }))}>{chip.label}</Button>)}
      </div>
      <div className="formation-secondary">
        <label>目标收藏架
          <select aria-label="按收藏架筛选" value={filters.shelfId || ''} onChange={(event) => setFilters((current) => ({ ...current, shelfId: event.target.value || undefined }))}>
            <option value="">全部收藏架</option>
            <option value="unset">尚未选定</option>
            {shelves.map((shelf) => <option key={shelf.shelfId} value={shelf.shelfId}>{shelf.name}</option>)}
          </select>
        </label>
        <label className="formation-check"><input type="checkbox" checked={filters.needsUserAction} onChange={(event) => setFilters((current) => ({ ...current, needsUserAction: event.target.checked }))} />需要我处理</label>
        <label className="formation-check"><input type="checkbox" checked={filters.expedited} onChange={(event) => setFilters((current) => ({ ...current, expedited: event.target.checked }))} />已加急</label>
        <label>片名
          <input type="search" aria-label="按片名筛选" value={filters.q} placeholder="搜索片名" onChange={(event) => setFilters((current) => ({ ...current, q: event.target.value }))} />
        </label>
      </div>
      {items.length ? <>
        <CurrentMediaTable items={items} {...tableProps} />
        {activeCursor && <Button type="button" onClick={() => void (async () => { if (!activeCursor) return; setLoading(true); try { const result = await helixAdminApi.listFormation('active', activeCursor, queryFilters); setItems((current) => [...current, ...result.items]); setActiveCursor(result.nextCursor); setProjection(result.projection); } finally { setLoading(false); } })()} disabled={loading}>加载更多当前媒体</Button>}
      </> : <div className="source-empty"><strong>{filters.classification || filters.shelfId || filters.needsUserAction || filters.expedited || filters.q.trim() ? '当前没有符合筛选的媒体' : '当前没有未完成媒体'}</strong></div>}
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
