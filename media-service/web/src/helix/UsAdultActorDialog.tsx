import {useEffect,useRef,useState} from 'react';
import {AdminApiError,helixAdminApi,type FormationSubject,type PeopleProjection,type UsAdultActorSelection,type UsAdultActorChoice,
  type UsAdultRecommendation,type RecommendationPublication,type RecommendationClaimRequest,type RecommendationClaimAccepted} from './api';
import {Button} from './chrome';
import {newOpaqueId} from './id';
import {useModalFocus} from './useModalFocus';
type Person=PeopleProjection['items'][number];
type Props={onClose:()=>void;onSelected:()=>void;onRefresh:()=>void;onUnauthorized?:()=>void}&(
  {item:FormationSubject;recommendation?:never;onClaimStarted?:never}|
  {item?:never;recommendation:{item:UsAdultRecommendation;publication:RecommendationPublication};onClaimStarted:(value:RecommendationClaimAccepted)=>void});
export default function UsAdultActorDialog({item,recommendation,onClaimStarted,onClose,onSelected,onRefresh,onUnauthorized}:Props){
  const runId=item?.currentRun!.libraRunId;
  const [selection,setSelection]=useState<UsAdultActorSelection|null>(null),[people,setPeople]=useState<Person[]>([]),[chosen,setChosen]=useState<Person|null>(null),
    [search,setSearch]=useState(''),[term,setTerm]=useState(''),[cursor,setCursor]=useState<string|null>(null),[loading,setLoading]=useState(true),
    [saving,setSaving]=useState(false),[stale,setStale]=useState(false),[error,setError]=useState(''),
    [visibleImages,setVisibleImages]=useState<Set<string>>(new Set()),[failedImages,setFailedImages]=useState<Set<string>>(new Set());
  const generation=useRef(0),command=useRef<UsAdultActorChoice|null>(null),claimCommand=useRef<RecommendationClaimRequest|null>(null),content=useModalFocus(true,onClose,saving),
    canChoose=recommendation?true:selection?.canChoose;
  const unauthorized=(cause:unknown)=>{if(cause instanceof AdminApiError&&cause.status===401){onUnauthorized?.();return true;}return false;};
  useEffect(()=>{
    const current=++generation.current;
    void Promise.all([runId?helixAdminApi.readUsAdultActorSelection(runId):Promise.resolve(null),helixAdminApi.listPeople({libraryKind:'us_adult',limit:24})]).then(([state,page])=>{
      if(current!==generation.current)return;
      setSelection(state);setPeople(page.items);setCursor(page.nextCursor);
    }).catch(cause=>{if(current===generation.current&&!unauthorized(cause))setError('演员资料读取失败，请关闭后重试。');})
      .finally(()=>{if(current===generation.current)setLoading(false);});
    return()=>{generation.current++;};
  },[runId]);
  async function find(append=false){
    if(loading||saving)return;
    const current=++generation.current,query=append?term:search.trim();setLoading(true);setError('');
    try{
      const page=await helixAdminApi.listPeople({libraryKind:'us_adult',limit:24,search:query,...(append&&cursor?{cursor}:{})});
      if(current!==generation.current)return;
      setPeople(previous=>append?[...previous,...page.items.filter(person=>!previous.some(item=>item.personId===person.personId))]:page.items);
      setCursor(page.nextCursor);setTerm(query);
    }catch(cause){if(current===generation.current&&!unauthorized(cause))setError('演员搜索失败，请重试。');}
    finally{if(current===generation.current)setLoading(false);}
  }
  async function confirm(){
    if(!canChoose||!chosen||!visibleImages.has(chosen.personId)||!chosen.currentReferenceRevision||saving||stale)return;
    setSaving(true);setError('');
    try{
      if(recommendation){
        claimCommand.current??={idempotencyKey:newOpaqueId('us-recommendation-'),expectedPublicationRevision:recommendation.publication.revision,
          expectedSnapshotDigest:recommendation.publication.snapshotDigest,target:{kind:'existing',personId:chosen.personId,
            expectedPersonRevision:chosen.currentRevision,expectedReferenceRevision:chosen.currentReferenceRevision}};
        const accepted=await helixAdminApi.claimUsAdultRecommendation(recommendation.item.recommendationId,claimCommand.current);onClaimStarted?.(accepted);
      }else if(runId&&selection){
        command.current??={idempotencyKey:'choose-us-actor:'+runId+':'+newOpaqueId(),expectedRunStateRevision:selection.expectedRunStateRevision,
          expectedChoiceRevision:selection.expectedChoiceRevision,personId:chosen.personId,expectedPersonRevision:chosen.currentRevision,
          expectedReferenceRevision:chosen.currentReferenceRevision};
        await helixAdminApi.chooseUsAdultActor(runId,command.current);onSelected();
      }
    }
    catch(cause){
      if(unauthorized(cause))return;
      if(cause instanceof AdminApiError&&[400,404,409].includes(cause.status)){
        setStale(true);setError('影片或演员资料已变化，请关闭后重新选择。');onRefresh();
      }else setError('确认结果尚未收到，请重试。');
    }finally{setSaving(false);}
  }
  return <div className="dialog-scrim" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget&&!saving)onClose();}}>
    <div className="dialog dialog-wide us-actor-dialog" ref={content} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="us-actor-title" aria-busy={saving}>
      <div className="dialog-head"><h2 id="us-actor-title">{recommendation?'认领为已有演员':'选择影片演员'}</h2></div>
      <div className="dialog-body stack">
        <p>{recommendation?recommendation.item.source.title:item?.displayIdentity}</p>
        {recommendation&&<p>本次只确认这部来源影片，其余暂存影片保持原状。</p>}
        {selection?.selectedActor&&<p>当前演员：<strong>{selection.selectedActor.canonicalName}</strong>{selection.selectionOrigin==='automatic_match'?' · 系统匹配':''}</p>}
        {selection&&!selection.canChoose&&<p role="status">影片当前无法修改演员，请刷新工作区查看最新状态。</p>}
        <form onSubmit={event=>{event.preventDefault();void find();}} className="identity-picker-input">
          <label className="sr-only" htmlFor="us-actor-search">搜索 US Adult 演员</label>
          <input id="us-actor-search" value={search} onChange={event=>setSearch(event.target.value)} placeholder="输入演员姓名或别名" disabled={saving||stale}/>
          <Button type="submit" disabled={loading||saving||stale}>搜索</Button>
        </form>
        {error&&<p role="alert" className="form-error">{error}</p>}
        {!loading&&people.length===0&&<p>没有找到可选演员。</p>}
        <div className="us-actor-grid" role="radiogroup" aria-label="US Adult 演员库">
          {people.map(person=><label key={person.personId} className="us-actor-option" data-selected={chosen?.personId===person.personId||undefined}>
            <img src={helixAdminApi.personAvatarUrl(person.personId,person.currentReferenceRevision)} alt="" loading="lazy" onLoad={()=>setVisibleImages(previous=>new Set([...previous,person.personId]))}
              onError={()=>{setVisibleImages(previous=>new Set([...previous].filter(id=>id!==person.personId)));setFailedImages(previous=>new Set([...previous,person.personId]));setChosen(previous=>previous?.personId===person.personId?null:previous);}}/>
            {failedImages.has(person.personId)&&<small>图片无法读取</small>}
            <span><input type="radio" name="us-film-actor" value={person.personId} checked={chosen?.personId===person.personId} disabled={saving||stale||!person.currentReferenceRevision||!visibleImages.has(person.personId)}
              onChange={()=>{setChosen(person);command.current=null;claimCommand.current=null;setError('');}}/><strong>{person.canonicalName}</strong></span>
          </label>)}
        </div>
        {loading&&<p role="status">正在读取演员库…</p>}
        {cursor&&<Button type="button" disabled={loading||saving||stale} onClick={()=>void find(true)}>加载更多演员</Button>}
        {chosen&&<p role="status">已选择：{chosen.canonicalName}</p>}
      </div>
      <div className="dialog-actions"><Button type="button" disabled={saving} onClick={onClose}>取消</Button>
        <Button type="button" variant="primary" disabled={!canChoose||!chosen||!visibleImages.has(chosen.personId)||loading||saving||stale} onClick={()=>void confirm()}>{saving?'正在确认…':recommendation?'确认认领':'确认演员'}</Button></div>
    </div>
  </div>;
}
