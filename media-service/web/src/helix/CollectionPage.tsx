import { FormEvent, useCallback, useEffect, useState } from 'react';
import { AdminApiError, helixAdminApi, type CollectionEntry } from './api';
import RatingControl from './RatingControl';

export default function CollectionPage(){
  const [session,setSession]=useState<'checking'|'required'|'ready'>('checking'),[apiKey,setApiKey]=useState(''),[items,setItems]=useState<CollectionEntry[]>([]);
  const [loading,setLoading]=useState(false),[error,setError]=useState('');
  const load=useCallback(async()=>{setLoading(true);setError('');try{const result=await helixAdminApi.listCollection();setItems(result.items);setSession('ready');}
    catch(cause){if(cause instanceof AdminApiError&&cause.status===401)setSession('required');else setError(cause instanceof Error?cause.message:'收藏读取失败。');}finally{setLoading(false);}},[]);
  useEffect(()=>{void load();},[load]);
  async function signIn(event:FormEvent){event.preventDefault();setLoading(true);try{await helixAdminApi.createSession(apiKey.trim());setApiKey('');await load();}catch(cause){setError(cause instanceof Error?cause.message:'管理凭据验证失败。');setLoading(false);}}
  if(session==='checking')return <section className="source-page source-page-loading" aria-live="polite">正在读取我的收藏…</section>;
  if(session==='required')return <section className="source-page auth-stage"><div className="auth-card"><p className="eyebrow">本机管理会话</p><h1>查看我的收藏</h1>
    <form onSubmit={signIn} className="auth-form"><label><span>管理凭据</span><input type="password" value={apiKey} onChange={(event)=>setApiKey(event.target.value)} required/></label><button disabled={loading||!apiKey.trim()}>进入管理台</button></form>{error&&<p className="form-error" role="alert">{error}</p>}</div></section>;
  return <section className="source-page collection-page"><header className="source-hero"><div><p className="eyebrow">我的收藏 · Arca</p><h1>已经正式上架的 Shelf Entry</h1>
    <p>评分属于你的感知记录，不改变 Arca 对收藏事实的所有权。</p></div><button className="surface-action" onClick={()=>void load()} disabled={loading}>{loading?'刷新中…':'刷新'}</button></header>
    {error&&<p className="form-error" role="alert">{error}</p>}
    <section className="formation-ledger"><div className="source-registry-heading"><div><p className="eyebrow">Collection Ledger</p><h2>收藏条目</h2></div><span>{items.length} 条</span></div>
      {items.length===0?<div className="source-empty"><strong>还没有 Shelf Entry</strong><p>当前实施停在 Acceptance Spec，尚未创建 Libra Run、Handoff B 或 Arca On-deck 事实。</p></div>:
        <div className="formation-table-wrap"><table className="formation-table"><thead><tr><th>条目</th><th>收藏架</th><th>状态</th><th>评分</th><th>Inventory</th></tr></thead><tbody>{items.map((item)=><tr key={item.shelfEntryId}>
          <td><strong>{item.displayIdentity}</strong><small>{item.provider} · {item.identityKind}</small></td><td>{item.shelfName}</td><td>{item.status}</td>
          <td><RatingControl targetType="shelf_entry" targetId={item.shelfEntryId} label={item.displayIdentity}/></td><td>r{item.currentInventoryRevision}<small>Deck r{item.currentDeckFactRevision}</small></td>
        </tr>)}</tbody></table></div>}
    </section></section>;
}
