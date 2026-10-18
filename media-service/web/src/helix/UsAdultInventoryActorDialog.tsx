import {useCallback,useEffect,useRef,useState} from 'react';
import {AdminApiError,helixAdminApi,type CollectionEntry,type PeopleProjection,type UsAdultActorRefreshRequest,type UsAdultActorRefreshView} from './api';
import {Button} from './chrome';
import {newOpaqueId} from './id';
import {useModalFocus} from './useModalFocus';
type Person=PeopleProjection['items'][number];
const phaseLabels:Record<string,string>={source:'正在分析影片',matching:'正在匹配演员',match:'正在匹配演员',assets:'正在生成海报和说明书',
  stage:'正在准备文件',publish:'正在更新文件',verify:'正在核验文件',commit:'正在更新收藏',retire:'正在清理旧文件',close:'正在完成刷新'};
function attentionCopy(code:string|null){
  if(code==='ARCA_US_ADULT_TARGET_CONFLICT'||code==='ARCA_US_ADULT_STAGE_CONFLICT')return '目标位置存在冲突文件，刷新已停止，当前进度已保留。';
  if(['ARCA_US_ADULT_FILE_CHANGED','ARCA_US_ADULT_SOURCE_CHANGED','PHYSICAL_MATERIAL_STAT_FENCE_CHANGED'].includes(code||''))return '影片文件发生变化，刷新已停止，当前进度已保留。';
  if(['ARCA_US_ADULT_REFRESH_EXECUTION_STALE','ARCA_US_ADULT_PHASE_PROOF_INVALID','P6_PEOPLE_REFERENCE_REVISION_CONFLICT'].includes(code||''))return '影片或执行版本发生变化，刷新已停止，当前进度已保留。';
  return '刷新遇到问题，当前进度已保留。';
}
export default function UsAdultInventoryActorDialog({item,onClose,onChanged,onUnauthorized}:{item:CollectionEntry;onClose:()=>void;onChanged:()=>void;onUnauthorized:()=>void}){
  const [view,setView]=useState<UsAdultActorRefreshView|null>(null),[people,setPeople]=useState<Person[]>([]),[chosen,setChosen]=useState<Person|null>(null),
    [search,setSearch]=useState(''),[term,setTerm]=useState(''),[cursor,setCursor]=useState<string|null>(null),[loading,setLoading]=useState(true),
    [saving,setSaving]=useState(false),[error,setError]=useState(''),[stale,setStale]=useState(false),[visible,setVisible]=useState<Set<string>>(new Set());
  const version=useRef(0),command=useRef<UsAdultActorRefreshRequest|null>(null),completed=useRef<string|null>(null),
    content=useModalFocus(true,onClose,saving);
  const failed=(cause:unknown,message:string)=>{if(cause instanceof AdminApiError&&cause.status===401)onUnauthorized();else setError(message);};
  const read=useCallback(async()=>{
    const current=version.current;
    try{const next=await helixAdminApi.readInventoryActorRefresh(item.shelfEntryId);if(current!==version.current)return;
      setView(next);
      if(next.progress?.state==='resolved'&&completed.current!==next.progress.aftercareCaseId){completed.current=next.progress.aftercareCaseId;onChanged();}
    }catch(cause){if(current===version.current)failed(cause,'刷新状态读取失败，请重试。');}
  },[item.shelfEntryId,onChanged]);
  useEffect(()=>{version.current++;const current=version.current;
    void Promise.all([read(),helixAdminApi.listPeople({libraryKind:'us_adult',limit:24})]).then(([,page])=>{
      if(current===version.current){setPeople(page.items);setCursor(page.nextCursor);}
    }).catch(cause=>{if(current===version.current)failed(cause,'演员库读取失败，请重试。');}).finally(()=>{if(current===version.current)setLoading(false);});
    return()=>{version.current++;};
  },[item.shelfEntryId]);
  useEffect(()=>{if(!view?.progress||!['queued','active'].includes(view.progress.state))return;
    const timer=window.setInterval(()=>void read(),2000);return()=>window.clearInterval(timer);
  },[view?.progress?.state,read]);
  async function find(append=false){if(loading||saving)return;const current=version.current,query=append?term:search.trim();setLoading(true);setError('');
    try{const page=await helixAdminApi.listPeople({libraryKind:'us_adult',limit:24,search:query,...(append&&cursor?{cursor}:{})});
      if(current!==version.current)return;setPeople(previous=>append?[...previous,...page.items.filter(person=>!previous.some(row=>row.personId===person.personId))]:page.items);
      setCursor(page.nextCursor);setTerm(query);
    }catch(cause){if(current===version.current)failed(cause,'演员搜索失败，请重试。');}finally{if(current===version.current)setLoading(false);}}
  async function refresh(mode:'automatic'|'specified'){
    if(!view?.canRefresh||saving||stale||mode==='specified'&&(!chosen?.currentReferenceRevision||!visible.has(chosen.personId)))return;
    setSaving(true);setError('');
    try{
      command.current??={idempotencyKey:newOpaqueId('inventory-actor-'),expectedInventoryRevision:view.expectedInventoryRevision,
        expectedRepresentationDigest:view.expectedRepresentationDigest,...(mode==='automatic'?{mode}:{mode,personId:chosen!.personId,
          expectedPersonRevision:chosen!.currentRevision,expectedReferenceRevision:chosen!.currentReferenceRevision!})};
      await helixAdminApi.refreshInventoryActor(item.shelfEntryId,command.current);command.current=null;await read();
    }catch(cause){if(cause instanceof AdminApiError&&[400,404,409].includes(cause.status)){setStale(true);setError('影片或演员资料已变化，请关闭后重新读取。');}
      else failed(cause,'提交结果尚未收到，请重试同一操作。');}finally{setSaving(false);}
  }
  const running=view?.progress&&['queued','active'].includes(view.progress.state),active=view?.progress?.works.find(work=>work.state!=='succeeded'),
    attention=active&&['failed','timed_out','cancelled','blocked'].includes(active.state),pendingMode=command.current?.mode,available=view?.canRefresh&&!stale&&!saving;
  return <div className="dialog-scrim" onMouseDown={event=>{if(event.target===event.currentTarget&&!saving)onClose();}}>
    <section ref={content} tabIndex={-1} className="dialog dialog-wide us-actor-dialog" role="dialog" aria-modal="true" aria-labelledby="inventory-actor-title" aria-busy={saving}>
      <div className="dialog-head"><h2 id="inventory-actor-title">刷新影片演员</h2></div>
      <div className="dialog-body stack">
        <p>{item.displayIdentity}</p>{view&&<p>当前演员：<strong>{view.currentActor.displayName}</strong></p>}
        <p>本片的演员、海报、说明书和文件名会一并更新。</p>
        {error&&<p role="alert" className="form-error">{error}</p>}
        {running?<p role={attention?'alert':'status'}>{attention?attentionCopy(active.failureCode):active?phaseLabels[active.phase]||'正在刷新演员':'等待执行'}
          </p>:view?.progress?.state==='resolved'&&
          <p role="status">{view.progress.reasonCode==='actor_match_unchanged'?'未找到有效匹配，保留原演员。':'演员刷新已完成。'}</p>}
        {view&&!view.canRefresh&&!running&&<p>影片当前有其他维护任务，请稍后重新读取。</p>}
        <Button type="button" disabled={!available||Boolean(pendingMode&&pendingMode!=='automatic')} onClick={()=>void refresh('automatic')}>自动刷新演员</Button>
        <form className="identity-picker-input" onSubmit={event=>{event.preventDefault();void find();}}>
          <label className="sr-only" htmlFor="inventory-actor-search">搜索 US Adult 演员</label>
          <input id="inventory-actor-search" value={search} onChange={event=>setSearch(event.target.value)} placeholder="输入演员姓名或别名" disabled={saving||Boolean(command.current)}/>
          <Button type="submit" disabled={loading||saving||Boolean(command.current)}>搜索</Button>
        </form>
        {!loading&&people.length===0&&<p>没有找到可选演员。</p>}
        <div className="us-actor-grid" role="radiogroup" aria-label="US Adult 演员库">{people.map(person=><label key={person.personId} className="us-actor-option" data-selected={chosen?.personId===person.personId||undefined}>
          <img src={helixAdminApi.personAvatarUrl(person.personId)} alt="" loading="lazy" onLoad={()=>setVisible(previous=>new Set([...previous,person.personId]))}
            onError={()=>{setVisible(previous=>new Set([...previous].filter(id=>id!==person.personId)));setChosen(previous=>previous?.personId===person.personId?null:previous);}}/>
          <span><input type="radio" name="inventory-us-actor" checked={chosen?.personId===person.personId} disabled={!available||Boolean(command.current)||!person.currentReferenceRevision||!visible.has(person.personId)}
            onChange={()=>{setChosen(person);setError('');}}/><strong>{person.canonicalName}</strong></span>
        </label>)}</div>
        {loading&&<p role="status">正在读取演员库…</p>}
        {cursor&&<Button type="button" disabled={loading||saving} onClick={()=>void find(true)}>加载更多演员</Button>}
      </div>
      <div className="dialog-actions"><Button type="button" disabled={saving} onClick={onClose}>关闭</Button>
        <Button type="button" variant="primary" disabled={!available||!chosen||!visible.has(chosen.personId)||Boolean(pendingMode&&pendingMode!=='specified')}
          onClick={()=>void refresh('specified')}>{saving?'正在提交…':'指定演员并更新'}</Button></div>
    </section>
  </div>;
}
