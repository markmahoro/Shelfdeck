import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { helixAdminApi, type OverviewProjection } from './api';
import { Button, LoadingState, PageHeader } from './chrome';
import { isUnauthorized, useSession } from './session';

export default function OverviewPage() {
  const { expire } = useSession();
  const [projection, setProjection] = useState<OverviewProjection | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setProjection(await helixAdminApi.getOverview());
    } catch (cause) {
      if (isUnauthorized(cause)) expire();
      else setError(cause instanceof Error ? cause.message : '概览读取失败。');
    } finally {
      setLoading(false);
    }
  }, [expire]);
  useEffect(() => { void load(); }, [load]);
  if (!projection && !error) return <LoadingState>正在读取概览…</LoadingState>;
  return <div className="source-page">
    <PageHeader title="概览" description="看系统是否就绪、有没有要你处理的事，以及最近上架了什么。" actions={<Button variant="secondary" type="button" onClick={() => void load()} disabled={loading}>{loading ? '刷新中…' : '刷新'}</Button>} />
    {error && <p className="form-error" role="alert">{error}</p>}
    {projection && <>
      <Link className="system-state" data-kind={projection.systemState.kind} to={projection.systemState.href}>
        <span>系统状态</span>
        <strong>{projection.systemState.label}</strong>
        <small>{projection.systemState.kind === 'unconfigured' ? '先配置文件来源和收藏架' : projection.systemState.kind === 'faulted' ? '服务当前不可用，需要处理故障' : '来源与收藏架已就绪，可以继续整理和上架'}</small>
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
