import { FormEvent, useCallback, useEffect, useState } from 'react';
import { helixAdminApi, type PeopleProjection } from './api';
import { Button, LoadingState, PageHeader } from './chrome';
import { isUnauthorized, useSession } from './session';

type RegistrationCandidate = {
  candidateId: string;
  currentState: string;
  currentRevision: number;
  proposedName: string;
};

export default function PeoplePage() {
  const { expire } = useSession();
  const [projection, setProjection] = useState<PeopleProjection | null>(null);
  const [candidates, setCandidates] = useState<RegistrationCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [canonicalName, setCanonicalName] = useState('');
  const [aliases, setAliases] = useState('');
  const [providerKey, setProviderKey] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [people, registration] = await Promise.all([
        helixAdminApi.listPeople({ limit: 50 }),
        helixAdminApi.listPeopleRegistrationCandidates(),
      ]);
      setProjection(people);
      setCandidates((registration.items || []).filter((item) => item.currentState === 'open'));
    } catch (cause) {
      if (isUnauthorized(cause)) expire();
      else setError(cause instanceof Error ? cause.message : '人物名录读取失败。');
    } finally { setLoading(false); }
  }, [expire]);

  useEffect(() => { void load(); }, [load]);

  async function register(event: FormEvent) {
    event.preventDefault();
    if (!canonicalName.trim()) { setError('请填写姓名。'); return; }
    setLoading(true); setError(''); setNotice('');
    try {
      await helixAdminApi.registerPerson({
        canonicalName: canonicalName.trim(),
        aliases: aliases.split(/[,\n]/).map((item) => item.trim()).filter(Boolean),
        providerIdentities: providerKey.trim() ? [{ provider: 'tmdb', providerKey: providerKey.trim() }] : [],
      });
      setCanonicalName(''); setAliases(''); setProviderKey('');
      setNotice('已登记这个人。收藏详情里的演职员不会被改写。');
      await load();
    } catch (cause) {
      if (isUnauthorized(cause)) expire();
      else setError(cause instanceof Error ? cause.message : '登记失败。');
      setLoading(false);
    }
  }

  async function accept(candidateId: string) {
    setLoading(true); setError('');
    try { await helixAdminApi.acceptPeopleCandidate(candidateId); setNotice('已接受登记。'); await load(); }
    catch (cause) { if (isUnauthorized(cause)) expire(); else setError(cause instanceof Error ? cause.message : '接受失败。'); setLoading(false); }
  }

  async function dismiss(candidateId: string) {
    setLoading(true); setError('');
    try { await helixAdminApi.dismissPeopleCandidate(candidateId); setNotice('已忽略这条待确认登记。'); await load(); }
    catch (cause) { if (isUnauthorized(cause)) expire(); else setError(cause instanceof Error ? cause.message : '忽略失败。'); setLoading(false); }
  }

  if (!projection && !error) return <LoadingState>正在读取人物名录…</LoadingState>;
  const summary = projection?.summary;
  return <section className="source-page">
    <PageHeader title="人物" description="名录是已经登记的人，不是某部电影的演员表。演员表仍在收藏详情里。" actions={<Button type="button" onClick={() => void load()} disabled={loading}>{loading ? '刷新中…' : '刷新'}</Button>} />
    {error && <p className="form-error" role="alert">{error}</p>}
    {notice && <p className="form-notice" role="status">{notice}</p>}
    <div className="source-facts facts-3" aria-label="人物摘要">
      <div><span>已登记</span><strong>{summary?.activePersonCount ?? 0}</strong><small>正式名录</small></div>
      <div><span>待确认</span><strong>{candidates.length}</strong><small>可接受或忽略</small></div>
      <div><span>待确认合并</span><strong>{summary?.openMergeCandidateCount ?? 0}</strong><small>本页暂不处理合并</small></div>
    </div>
    <form className="source-create" onSubmit={register}>
      <div className="source-create-heading"><div><h2>登记一个人</h2></div><span>参考图不是前置条件</span></div>
      <div className="source-form-grid">
        <label><span>姓名</span><input value={canonicalName} onChange={(event) => setCanonicalName(event.target.value)} required /></label>
        <label><span>别名</span><input value={aliases} onChange={(event) => setAliases(event.target.value)} placeholder="可选，逗号分隔" /></label>
        <label><span>外部编号</span><input value={providerKey} onChange={(event) => setProviderKey(event.target.value)} placeholder="可选，例如 TMDB Person ID" /></label>
      </div>
      <div className="source-create-footer"><p>登记只写入人物名录，不会改任何收藏的演职员。</p><Button variant="primary" type="submit" disabled={loading}>{loading ? '正在登记…' : '登记'}</Button></div>
    </form>
    <section className="source-registry">
      <div className="source-registry-heading"><div><h2>待确认登记</h2></div></div>
      {candidates.length ? <div className="formation-table-wrap"><table className="formation-table"><thead><tr><th>姓名</th><th>操作</th></tr></thead><tbody>{candidates.map((item) => <tr key={item.candidateId}><td><strong>{item.proposedName}</strong></td><td><div className="settings-card-actions"><Button variant="primary" type="button" disabled={loading} onClick={() => void accept(item.candidateId)}>接受</Button><Button type="button" disabled={loading} onClick={() => void dismiss(item.candidateId)}>忽略</Button></div></td></tr>)}</tbody></table></div> : <div className="source-empty"><strong>没有待确认的人</strong><p>上架后带稳定人物编号的资料会自动进入名录；只有姓名的会先出现在这里。</p></div>}
    </section>
    <section className="source-registry">
      <div className="source-registry-heading"><div><h2>已登记人物</h2></div><span>当前显示 {projection?.items.length ?? 0} 条</span></div>
      {projection?.items.length ? <div className="formation-table-wrap"><table className="formation-table"><thead><tr><th>人物</th><th>状态</th><th>别名</th><th>外部编号</th></tr></thead><tbody>{projection.items.map((person) => <tr key={person.personId}><td><strong>{person.canonicalName}</strong></td><td>{person.status === 'active' ? '已登记' : '已合并'}</td><td>{person.aliases.join('、') || '—'}</td><td>{person.providerIdentities.map((identity) => `${identity.provider} ${identity.providerKey}`).join('、') || '—'}</td></tr>)}</tbody></table></div> : <div className="source-empty"><strong>还没有已登记人物</strong><p>可以直接登记，或等待上架资料带来的待确认项。</p></div>}
    </section>
  </section>;
}
