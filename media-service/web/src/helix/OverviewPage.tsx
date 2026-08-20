import { FormEvent, useCallback, useEffect, useState } from 'react';
import { AdminApiError, helixAdminApi, type OverviewProjection } from './api';

type SessionState = 'checking' | 'required' | 'ready';

export default function OverviewPage() {
  const [session,setSession]=useState<SessionState>('checking');
  const [apiKey,setApiKey]=useState('');
  const [projection,setProjection]=useState<OverviewProjection|null>(null);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const load=useCallback(async()=>{
    setLoading(true);setError('');
    try{setProjection(await helixAdminApi.getOverview());setSession('ready');}
    catch(cause){if(cause instanceof AdminApiError&&cause.status===401)setSession('required');else setError(cause instanceof Error?cause.message:'概览读取失败。');}
    finally{setLoading(false);}
  },[]);
  useEffect(()=>{void load();},[load]);
  async function signIn(event:FormEvent){event.preventDefault();setLoading(true);setError('');try{await helixAdminApi.createSession(apiKey.trim());setApiKey('');await load();}catch(cause){setError(cause instanceof Error?cause.message:'管理凭据验证失败。');setLoading(false);}}
  if(session==='checking')return <div className="source-page-loading">正在读取真实收藏概览…</div>;
  if(session==='required')return <section className="source-page auth-stage"><div className="auth-card"><p className="eyebrow">本机管理会话</p><h1>查看收藏概览</h1><form onSubmit={signIn} className="auth-form"><label><span>管理凭据</span><input type="password" value={apiKey} onChange={(event)=>setApiKey(event.target.value)} required/></label><button disabled={loading||!apiKey.trim()}>进入管理台</button></form>{error&&<p className="form-error" role="alert">{error}</p>}</div></section>;
  return <div className="surface-page">
    <header className="surface-header"><div><p className="eyebrow">收藏维护账本</p><h1>你的收藏，正在被认真照料</h1><p className="lede">只看系统能否持续履职，以及 ShelfDeck 最近为收藏创造了什么价值。</p></div><button className="surface-action" type="button" onClick={()=>void load()} disabled={loading}>{loading?'刷新中…':'刷新'}</button></header>
    {error&&<p className="form-error" role="alert">{error}</p>}
    {projection&&<>
      <section className="metric-strip" aria-label="概览摘要">{projection.metrics.map((metric)=><article key={metric.key}><span>{metric.label}</span><strong>{metric.value.toLocaleString()}</strong><small>{metric.note}</small></article>)}</section>
      <section className="ledger-panel" aria-labelledby="overview-ledger"><div className="ledger-heading"><div><p className="eyebrow">业务履历</p><h2 id="overview-ledger">当前可证明的进展</h2></div><span className="freshness">Fresh · {new Date(projection.generatedAt).toLocaleTimeString()}</span></div><ol>{projection.ledger.map((item,index)=><li key={item.key}><span>{String(index+1).padStart(2,'0')}</span><p>{item.label}</p><em>{item.value.toLocaleString()}</em></li>)}</ol></section>
      <aside className="attention-note"><strong>当前配置</strong><p>{projection.setup.activeMaterialFieldCount} 个活动文件来源 · {projection.setup.activeShelfCount} 个活动收藏架。危险操作只会在 fresh Projection 提供精确 Scope 后出现。</p></aside>
    </>}
  </div>;
}

