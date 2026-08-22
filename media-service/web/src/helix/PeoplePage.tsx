import { useCallback, useEffect, useState } from 'react';
import { helixAdminApi, type PeopleProjection } from './api';
import { Button, LoadingState, PageHeader } from './chrome';
import { isUnauthorized, useSession } from './session';

export default function PeoplePage() {
  const { expire } = useSession();
  const [projection, setProjection] = useState<PeopleProjection | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setProjection(await helixAdminApi.listPeople({ limit: 50 })); }
    catch (cause) { if (isUnauthorized(cause)) expire(); else setError(cause instanceof Error ? cause.message : '人物名录读取失败。'); }
    finally { setLoading(false); }
  }, [expire]);
  useEffect(() => { void load(); }, [load]);
  if (!projection && !error) return <LoadingState>正在读取人物名录…</LoadingState>;
  const summary = projection?.summary;
  return <section className="source-page">
    <PageHeader title="人物名录" description="只读查看已登记人物。本页不能注册、合并或修改演职员事实。" actions={<Button type="button" onClick={() => void load()} disabled={loading}>{loading ? '刷新中…' : '刷新'}</Button>} />
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="source-facts facts-3" aria-label="人物摘要">
      <div><span>已登记人物</span><strong>{summary?.activePersonCount ?? 0}</strong><small>正式名录</small></div>
      <div><span>待确认登记</span><strong>{summary?.openRegistrationCandidateCount ?? 0}</strong><small>本页暂不能确认</small></div>
      <div><span>待确认合并</span><strong>{summary?.openMergeCandidateCount ?? 0}</strong><small>本页暂不能合并</small></div>
    </div>
    <section className="source-registry">
      <div className="source-registry-heading"><div><h2>当前人物</h2></div><span>当前显示 {projection?.items.length ?? 0} 条</span></div>
      {projection?.items.length ? <div className="formation-table-wrap"><table className="formation-table"><thead><tr><th>人物</th><th>状态</th><th>别名</th><th>外部编号</th></tr></thead><tbody>{projection.items.map((person) => <tr key={person.personId}><td><strong>{person.canonicalName}</strong></td><td>{person.status === 'active' ? '已登记' : '已合并'}</td><td>{person.aliases.join('、') || '—'}</td><td>{person.providerIdentities.map((identity) => `${identity.provider} ${identity.providerKey}`).join('、') || '—'}</td></tr>)}</tbody></table></div> : <div className="source-empty"><strong>还没有已登记人物</strong><p>人物只有在正式登记后才会出现在这里。</p></div>}
    </section>
  </section>;
}
