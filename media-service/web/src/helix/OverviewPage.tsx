import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { helixAdminApi } from './api';
import { Button, LoadingState, PageHeader } from './chrome';
import { isUnauthorized, useSession } from './session';

export default function OverviewPage() {
  const { expire } = useSession();
  const { data: projection, error, isFetching, refetch } = useQuery({
    queryKey: ['overview'],
    queryFn: () => helixAdminApi.getOverview(),
    refetchInterval: 30_000,
  });
  const unauthorized = Boolean(error && isUnauthorized(error));
  useEffect(() => {
    if (unauthorized) expire();
  }, [expire, unauthorized]);
  if (unauthorized) return <LoadingState>正在读取概览…</LoadingState>;
  const load = () => { void refetch(); };
  const loading = isFetching;
  const fieldAccessAttention = projection?.systemState.kind !== 'faulted' && Boolean(projection?.todos.some((item) => item.key === 'field_access'));
  const stateKind = !projection ? 'running' : projection.systemState.kind === 'faulted' ? 'faulted' : fieldAccessAttention ? 'attention' : projection.systemState.kind;
  const stateNote = !projection ? '' : projection.systemState.kind === 'unconfigured' ? '先配置文件来源和收藏架'
    : projection.systemState.kind === 'faulted' ? '服务当前不可用，需要处理故障'
    : fieldAccessAttention ? '有文件来源目录不可用，先到来源配置处理'
    : projection.todos.length ? '有事项需要你处理，先从下面进入对应页面'
    : '来源与收藏架已就绪，可以继续整理和上架';
  const background = projection?.backgroundOperations;
  const backgroundLabels = { waiting_first_check:'等待首次检查', waiting_business_time:'等待业务时间', running:'检查中', normal:'正常', attention:'需要留意', stopped:'已停止' } as const;
  const domainLabels:Record<string,string> = { procurement:'文件来源', libra:'媒体整理', arca:'收藏管理', people:'人物', perception:'信息更新' };
  const checklistLabels:Record<string,string> = { 'active-material-fields':'文件观察', 'periodic-douban-acquisitions':'豆瓣评分',
    'ondeck-person-evidence':'人物信息', 'completed-workspace-reclamation':'整理空间回收',
    'active-workspace-cleanup-scopes':'整理空间清理', 'due-aftercare-shelf-entries':'收藏维护',
    'aftercare-workspace-lifecycle':'维护空间回收' };
  const resultLabels = { failed:'检查失败', not_due:'尚未到期', no_pending:'没有待处理项', processed:'已处理' } as const;
  const checkedAt = background?.lastCompletedAtMs ? new Date(background.lastCompletedAtMs).toLocaleString('zh-CN') : '尚未完成首次检查';
  const firstProblem = background?.registrations.find((item) => item.state === 'attention');
  if (!projection && !error) return <LoadingState>正在读取概览…</LoadingState>;
  return <div className="source-page">
    <PageHeader title="概览" description="看系统是否就绪、有没有要你处理的事，以及最近上架了什么。" actions={<Button variant="secondary" type="button" onClick={() => void load()} disabled={loading}>{loading ? '刷新中…' : '刷新'}</Button>} />
    {error && <p className="form-error" role="alert">{error instanceof Error ? error.message : '概览读取失败。'}</p>}
    {projection && <>
      <Link className="system-state" data-kind={stateKind} to={projection.systemState.href}>
        <span>系统状态</span>
        <strong>{fieldAccessAttention ? '需要你处理' : projection.systemState.label}</strong>
        <small>{stateNote}</small>
      </Link>
      {background && <details className="background-status" data-kind={background.state}>
        <summary>
          <span><small>后台检查</small><strong>{backgroundLabels[background.state]}</strong></span>
          <span><small>最近检查</small><strong>{checkedAt}</strong></span>
          <span><small>待处理</small><strong>{background.pendingCount}</strong></span>
        </summary>
        {firstProblem && <p role="status">{domainLabels[firstProblem.ownerDomain] || firstProblem.ownerDomain}检查遇到问题，系统会自动重试。</p>}
        <div className="background-status-detail">{background.registrations.map((item) => <div key={`${item.ownerDomain}:${item.reconcilerKey}`}>
          <span>{checklistLabels[item.reconcilerKey] || domainLabels[item.ownerDomain] || item.ownerDomain}</span>
          <em>{backgroundLabels[item.state]}</em>
          <small>{item.lastCompletedAtMs ? new Date(item.lastCompletedAtMs).toLocaleString('zh-CN') : '尚未检查'}</small>
          <small>{item.lastResultKind ? `${resultLabels[item.lastResultKind]}${item.lastResultKind === 'processed' ? ` ${item.processed} 项` : ''}` : '等待结果'}</small>
        </div>)}</div>
      </details>}
      <section className="metric-strip" aria-label="收藏成果">{projection.metrics.map((metric) => <Link key={metric.key} to={metric.href || '/collection'}><article><span>{metric.label}</span><strong>{metric.value.toLocaleString()}</strong><small>{metric.note}</small></article></Link>)}</section>
      <section className="ledger-panel" aria-labelledby="overview-todos">
        <div className="ledger-heading"><h2 id="overview-todos">需要你处理</h2></div>
        {projection.todos.length
          ? <div className="todo-list">{projection.todos.map((item) => <Link key={item.key} to={item.href}><span>{item.label}</span><em>{item.count}</em></Link>)}</div>
          : <div className="source-empty"><strong>现在没有需要你处理的事项</strong></div>}
      </section>
      {projection.inProgress && <p className="page-footnote"><Link to={projection.inProgress.href}>{projection.inProgress.label} {projection.inProgress.count} 部</Link></p>}
      <section className="ledger-panel" aria-labelledby="overview-ledger">
        <div className="ledger-heading"><h2 id="overview-ledger">最近进展</h2></div>
        {projection.ledger.length
          ? <ol>{projection.ledger.map((item, index) => <li key={item.key}><span>{String(index + 1).padStart(2, '0')}</span>{item.href ? <Link to={item.href}>{item.label}</Link> : <p>{item.label}</p>}</li>)}</ol>
          : <div className="source-empty"><strong>还没有可展示的最近进展</strong></div>}
      </section>
    </>}
  </div>;
}
