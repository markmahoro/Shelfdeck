import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { AdminApiError, helixAdminApi, type CollectionEntry } from './api';
import RatingControl from './RatingControl';
import './collection.css';

export default function CollectionPage(){
  const [session,setSession]=useState<'checking'|'required'|'ready'>('checking'),[apiKey,setApiKey]=useState(''),[items,setItems]=useState<CollectionEntry[]>([]);
  const [loading,setLoading]=useState(false),[error,setError]=useState(''),[selected,setSelected]=useState<CollectionEntry|null>(null);
  const closeButton=useRef<HTMLButtonElement>(null);
  const load=useCallback(async()=>{setLoading(true);setError('');try{const result=await helixAdminApi.listCollection();setItems(result.items);setSession('ready');}
    catch(cause){if(cause instanceof AdminApiError&&cause.status===401)setSession('required');else setError(cause instanceof Error?cause.message:'收藏读取失败。');}finally{setLoading(false);}},[]);
  useEffect(()=>{void load();},[load]);
  useEffect(()=>{
    if(!selected)return;
    const previous=document.activeElement as HTMLElement|null;
    const close=()=>setSelected(null);
    const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape')close();};
    document.addEventListener('keydown',onKey);document.body.classList.add('modal-open');closeButton.current?.focus();
    return()=>{document.removeEventListener('keydown',onKey);document.body.classList.remove('modal-open');previous?.focus();};
  },[selected]);
  async function signIn(event:FormEvent){event.preventDefault();setLoading(true);try{await helixAdminApi.createSession(apiKey.trim());setApiKey('');await load();}catch(cause){setError(cause instanceof Error?cause.message:'管理凭据验证失败。');setLoading(false);}}
  if(session==='checking')return <section className="source-page source-page-loading" aria-live="polite">正在读取我的收藏…</section>;
  if(session==='required')return <section className="source-page auth-stage"><div className="auth-card"><p className="eyebrow">本机管理会话</p><h1>查看我的收藏</h1>
    <form onSubmit={signIn} className="auth-form"><label><span>管理凭据</span><input type="password" value={apiKey} onChange={(event)=>setApiKey(event.target.value)} required/></label><button disabled={loading||!apiKey.trim()}>进入管理台</button></form>{error&&<p className="form-error" role="alert">{error}</p>}</div></section>;
  return <section className="source-page collection-page"><header className="source-hero"><div><p className="eyebrow">我的收藏 · Arca</p><h1>已经正式上架的 Shelf Entry</h1>
    <p>评分属于你的感知记录，不改变 Arca 对收藏事实的所有权。</p></div><button className="surface-action" onClick={()=>void load()} disabled={loading}>{loading?'刷新中…':'刷新'}</button></header>
    {error&&<p className="form-error" role="alert">{error}</p>}
    <section className="collection-library" aria-labelledby="collection-heading"><div className="collection-library-heading"><div><p className="eyebrow">Collection Library</p><h2 id="collection-heading">收藏条目</h2></div><span>{items.length} 部</span></div>
      {items.length===0?<div className="source-empty"><strong>还没有正式上架的电影</strong><p>Handoff B Accepted并完成Arca On-deck Commit后，电影会在这里形成可浏览的收藏条目。</p></div>:
        <div className="poster-wall">{items.map((item)=><button className="poster-tile" key={item.shelfEntryId} onClick={()=>setSelected(item)} aria-label={`查看 ${item.displayIdentity} 详情`}>
          <span className="poster-frame">{item.hasPoster?<img src={helixAdminApi.collectionPosterUrl(item.shelfEntryId)} alt="" loading="lazy"/>:<span className="poster-fallback" aria-hidden="true"><b>{item.displayIdentity.slice(0,2)}</b><small>ShelfDeck</small></span>}</span>
          <span className="poster-caption"><strong>{item.displayIdentity}</strong><small>{item.year||'年份未知'} · {item.shelfName}</small></span>
        </button>)}</div>}
    </section>
    {selected&&<div className="collection-dialog-backdrop" onMouseDown={(event)=>{if(event.target===event.currentTarget)setSelected(null);}}>
      <section className="collection-dialog" role="dialog" aria-modal="true" aria-labelledby="collection-dialog-title">
        <button ref={closeButton} className="collection-dialog-close" onClick={()=>setSelected(null)} aria-label="关闭详情">×</button>
        <div className="collection-dialog-poster">{selected.hasPoster?<img src={helixAdminApi.collectionPosterUrl(selected.shelfEntryId)} alt={`${selected.displayIdentity} 海报`}/>:<span className="poster-fallback"><b>{selected.displayIdentity.slice(0,2)}</b><small>ShelfDeck</small></span>}</div>
        <div className="collection-dialog-copy"><p className="eyebrow">{selected.shelfName} · Deck r{selected.currentDeckFactRevision}</p><h2 id="collection-dialog-title">{selected.displayIdentity}</h2>
          <p className="collection-dialog-meta">{selected.year||'年份未知'} · {selected.genres.length?selected.genres.join(' / '):'类型未记录'} · {selected.structureKind}</p>
          <p className="collection-dialog-overview">{selected.overview||'当前Package没有提供剧情简介。'}</p>
          {selected.people.length>0&&<dl className="collection-people"><dt>演职人员</dt><dd>{selected.people.slice(0,12).map((person)=>person.displayName).join('、')}</dd></dl>}
          <dl className="collection-facts"><div><dt>收藏事实</dt><dd>Inventory r{selected.currentInventoryRevision}</dd></div><div><dt>身份来源</dt><dd>{selected.provider} · {selected.providerKey}</dd></div><div><dt>状态</dt><dd>{selected.status}</dd></div></dl>
          <div className="collection-rating"><span>我的评分</span><RatingControl targetType="shelf_entry" targetId={selected.shelfEntryId} label={selected.displayIdentity}/></div>
        </div>
      </section>
    </div>}
    </section>;
}
