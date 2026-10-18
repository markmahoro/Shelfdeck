import {useEffect,useRef,useState} from 'react';
import {Link} from 'react-router-dom';
import {helixAdminApi,type PeopleProjection,type PersonRelatedCollection} from './api';
import {Button} from './chrome';
import {useModalFocus} from './useModalFocus';
import {isUnauthorized} from './session';
export default function PersonWorksDialog({person,onClose,onUnauthorized}:{person:PeopleProjection['items'][number];onClose:()=>void;onUnauthorized:()=>void}){
  const [page,setPage]=useState<PersonRelatedCollection|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),
    version=useRef(0),content=useModalFocus(true,onClose,false);
  async function load(cursor?:string){const current=++version.current;setLoading(true);setError('');
    try{const next=await helixAdminApi.readPersonCollection(person.personId,cursor);if(current!==version.current)return;
      if(next.personId!==person.personId||next.libraryKind!==person.libraryKind)throw new Error('Related works returned a different Person scope.');
      setPage(previous=>cursor&&previous?{...next,items:[...previous.items,...next.items.filter(item=>!previous.items.some(old=>old.shelfEntryId===item.shelfEntryId))]}:next);
    }catch(cause){if(current!==version.current)return;if(isUnauthorized(cause))onUnauthorized();else setError('相关作品读取失败，请重试。');}
    finally{if(current===version.current)setLoading(false);}}
  useEffect(()=>{setPage(null);void load();return()=>{version.current++;};},[person.personId]);
  return <div className="dialog-scrim" onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}>
    <section ref={content} tabIndex={-1} className="dialog dialog-wide" role="dialog" aria-modal="true" aria-labelledby="person-works-title">
      <div className="dialog-head"><h2 id="person-works-title">{person.canonicalName} 的相关作品</h2></div>
      <div className="dialog-body stack">
        {error&&<p role="alert" className="form-error">{error} <Button type="button" disabled={loading} onClick={()=>void load(page?.nextCursor||undefined)}>重试</Button></p>}
        {!loading&&!error&&page?.items.length===0&&<p>当前收藏中没有这位演员的作品。</p>}
        <ul className="people-related-works">{page?.items.map(item=><li key={item.shelfEntryId}>
          <Link to={`/collection?entry=${encodeURIComponent(item.shelfEntryId)}`} onClick={onClose}>
            {item.hasPoster&&<img src={helixAdminApi.collectionPosterUrl(item.shelfEntryId,item.currentInventoryRevision,'wall')} alt="" loading="lazy"/>}
            <span><strong>{item.displayIdentity}</strong><small>{[item.year,item.shelfName].filter(Boolean).join(' · ')}</small></span>
          </Link>
        </li>)}</ul>
        {loading&&<p role="status">正在读取相关作品…</p>}
        {page?.nextCursor&&<Button type="button" disabled={loading} onClick={()=>void load(page.nextCursor!)}>加载更多作品</Button>}
      </div>
      <div className="dialog-actions"><Button type="button" onClick={onClose}>关闭</Button></div>
    </section>
  </div>;
}
