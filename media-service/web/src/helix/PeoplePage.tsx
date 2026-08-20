import { FormEvent, useCallback, useEffect, useState } from 'react';
import { AdminApiError, helixAdminApi, type PeopleProjection } from './api';

type SessionState='checking'|'required'|'ready';

export default function PeoplePage(){
  const [session,setSession]=useState<SessionState>('checking'),[apiKey,setApiKey]=useState('');
  const [projection,setProjection]=useState<PeopleProjection|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState('');
  const load=useCallback(async()=>{setLoading(true);setError('');try{setProjection(await helixAdminApi.listPeople({limit:50}));setSession('ready');}catch(cause){if(cause instanceof AdminApiError&&cause.status===401)setSession('required');else setError(cause instanceof Error?cause.message:'人物登记簿读取失败。');}finally{setLoading(false);}},[]);
  useEffect(()=>{void load();},[load]);
  async function signIn(event:FormEvent){event.preventDefault();setLoading(true);setError('');try{await helixAdminApi.createSession(apiKey.trim());setApiKey('');await load();}catch(cause){setError(cause instanceof Error?cause.message:'管理凭据验证失败。');setLoading(false);}}
  if(session==='checking')return <div className="source-page-loading">正在读取人物登记簿…</div>;
  if(session==='required')return <section className="source-page auth-stage"><div className="auth-card"><p className="eyebrow">本机管理会话</p><h1>查看人物登记簿</h1><form onSubmit={signIn} className="auth-form"><label><span>管理凭据</span><input type="password" value={apiKey} onChange={(event)=>setApiKey(event.target.value)} required/></label><button disabled={loading||!apiKey.trim()}>进入管理台</button></form>{error&&<p className="form-error" role="alert">{error}</p>}</div></section>;
  const summary=projection?.summary;
  return <section className="source-page"><header className="source-hero"><div><p className="eyebrow">People Registry</p><h1>维护人物身份，而不是改写媒体演职员事实</h1><p>Person、Preference 与 Reference Image 由人物域独立维护；本页只展示正式登记事实和待确认候选。</p></div><button className="surface-action" type="button" onClick={()=>void load()} disabled={loading}>{loading?'刷新中…':'刷新'}</button></header>
    {error&&<p className="form-error" role="alert">{error}</p>}
    <div className="source-facts" aria-label="人物摘要"><div><span>已注册人物</span><strong>{summary?.activePersonCount??0}</strong><small>active Person</small></div><div><span>注册候选</span><strong>{summary?.openRegistrationCandidateCount??0}</strong><small>等待用户确认</small></div><div><span>合并候选</span><strong>{summary?.openMergeCandidateCount??0}</strong><small>保留来源历史</small></div></div>
    <section className="source-registry"><div className="source-registry-heading"><div><p className="eyebrow">人物登记簿</p><h2>当前人物</h2></div><span>当前显示 {projection?.items.length??0} 条</span></div>{projection?.items.length?<div className="formation-table-wrap"><table className="formation-table"><thead><tr><th>人物</th><th>状态</th><th>别名</th><th>外部身份</th></tr></thead><tbody>{projection.items.map((person)=><tr key={person.personId}><td><strong>{person.canonicalName}</strong></td><td>{person.status}</td><td>{person.aliases.join('、')||'—'}</td><td>{person.providerIdentities.map((identity)=>`${identity.provider}:${identity.providerKey}`).join('、')||'—'}</td></tr>)}</tbody></table></div>:<div className="source-empty"><strong>还没有已注册人物</strong><p>人物只有在正式注册事实建立后才会出现在这里。</p></div>}</section>
  </section>;
}

