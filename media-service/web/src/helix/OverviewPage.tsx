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
  });
  if (error && isUnauthorized(error)) expire();
  const load = () => { void refetch(); };
  const loading = isFetching;
  const fieldAccessAttention = projection?.systemState.kind !== 'faulted' && Boolean(projection?.todos.some((item) => item.key === 'field_access'));
  const stateKind = !projection ? 'running' : projection.systemState.kind === 'faulted' ? 'faulted' : fieldAccessAttention ? 'attention' : projection.systemState.kind;
  const stateNote = !projection ? '' : projection.systemState.kind === 'unconfigured' ? '先配置文件来源和收藏架'
    : projection.systemState.kind === 'faulted' ? '服务当前不可用，需要处理故障'
    : fieldAccessAttention ? '有文件来源目录不可用，先到来源配置处理'
    : projection.todos.length ? '有事项需要你处理，先从下面进入对应页面'
    : '来源与收藏架已就绪，可以继续整理和上架';
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
