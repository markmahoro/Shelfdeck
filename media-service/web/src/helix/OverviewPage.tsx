import { useCallback, useEffect, useState } from 'react';
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
  if (!projection && !error) return <LoadingState>正在读取收藏现状…</LoadingState>;
  return <div className="source-page">
    <PageHeader title="收藏现状" description="当前正式收藏、本月新上架，以及需要你处理的事项。" actions={<Button variant="secondary" type="button" onClick={() => void load()} disabled={loading}>{loading ? '刷新中…' : '刷新'}</Button>} />
    {error && <p className="form-error" role="alert">{error}</p>}
    {projection && <>
      <section className="metric-strip" aria-label="概览摘要">{projection.metrics.map((metric) => <article key={metric.key}><span>{metric.label}</span><strong>{metric.value.toLocaleString()}</strong><small>{metric.note}</small></article>)}</section>
      <section className="ledger-panel" aria-labelledby="overview-ledger">
        <div className="ledger-heading"><h2 id="overview-ledger">最近进展</h2></div>
        <ol>{projection.ledger.map((item, index) => <li key={item.key}><span>{String(index + 1).padStart(2, '0')}</span><p>{item.label}</p><em>{item.value.toLocaleString()}</em></li>)}</ol>
      </section>
      <p className="page-footnote">{projection.setup.activeMaterialFieldCount} 个活动文件来源 · {projection.setup.activeShelfCount} 个活动收藏架</p>
    </>}
  </div>;
}
