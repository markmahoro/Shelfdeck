import {useEffect,useMemo,useRef,useState} from 'react';
import {AdminApiError,helixAdminApi,type FormationSubject,type EpisodeMetadataState,type EpisodeMetadataReview,
  type EpisodeMetadataInspect,type EpisodeMetadataConfirm,type EpisodeMetadataChoice,type EpisodeLocalScope} from './api';
import {Button} from './chrome';
import {groupPendingBySeason,pendingConfidentChoices,suggestEpisodeMetadataChoices} from './episodeMetadataSuggestions';
import {newOpaqueId} from './id';
import {useModalFocus} from './useModalFocus';

const coordinate=(scope:EpisodeLocalScope|{seasonNumber:number;episodeNumber:number})=>`S${String(scope.seasonNumber).padStart(2,'0')}E${String(scope.episodeNumber).padStart(2,'0')}`;
type Props={item:FormationSubject;onClose:()=>void;onSelected:()=>void;onUnauthorized:()=>void};
export default function EpisodeMetadataDialog({item,onClose,onSelected,onUnauthorized}:Props){
  const runId=item.currentRun!.libraRunId;
  const [state,setState]=useState<EpisodeMetadataState|null>(null),[review,setReview]=useState<{recordId:string;review:EpisodeMetadataReview}|null>(null),
    [seasons,setSeasons]=useState(''),[localKey,setLocalKey]=useState(''),[evidenceKey,setEvidenceKey]=useState(''),
    [uncertainPicks,setUncertainPicks]=useState<Record<string,string>>({}),
    [choices,setChoices]=useState<EpisodeMetadataChoice[]>([]),[acknowledged,setAcknowledged]=useState(false),
    [busy,setBusy]=useState(true),[stale,setStale]=useState(false),[error,setError]=useState('');
  const inspectCommand=useRef<EpisodeMetadataInspect|null>(null),confirmCommand=useRef<EpisodeMetadataConfirm|null>(null),
    focus=useModalFocus(true,onClose,busy),generation=useRef(0);
  const locked=Boolean(confirmCommand.current),queryLocked=Boolean(inspectCommand.current);
  const allowed=state&&['active','suspended','frozen'].includes(state.state)&&state.packageRevisionHead===0;
  const suggestion=useMemo(()=>review?suggestEpisodeMetadataChoices(review.review):null,[review]);
  const pendingConfident=useMemo(()=>suggestion?pendingConfidentChoices(suggestion.confident,choices):[],[suggestion,choices]);
  const pendingBySeason=useMemo(()=>groupPendingBySeason(pendingConfident),[pendingConfident]);
  const selectedKeys=useMemo(()=>new Set(choices.map(choice=>choice.materialKey)),[choices]);
  const usedEvidence=useMemo(()=>new Set(choices.map(choice=>choice.evidenceDigest)),[choices]);
  const uncertainOpen=suggestion?.uncertain.filter(member=>!selectedKeys.has(member.materialKey))||[];
  const unselectedMembers=review?.review.members.filter(member=>!selectedKeys.has(member.materialKey))||[];
  const selectedLocal=review?.review.members.find(member=>member.materialKey===localKey);
  const selectedEvidence=review?.review.evidence.find(entry=>entry.evidenceDigest===evidenceKey);
  function failure(cause:unknown,fallback:string){
    if(cause instanceof AdminApiError&&cause.status===401){onUnauthorized();return;}
    if(cause instanceof AdminApiError&&[400,404,409].includes(cause.status)){
      setStale(true);setError(cause.code==='LIBRA_EPISODE_MAPPING_MULTIPART_UNSUPPORTED'
        ?'该来源包含合并集或拆分集，当前无法建立一对一资料对应。'
        :'任务或资料依据已变化，请关闭后重新打开。');
    }else setError(fallback);
  }
  useEffect(()=>{
    const current=++generation.current;
    void helixAdminApi.readEpisodeMetadataMapping(runId).then(value=>{
      if(current!==generation.current)return;
      setState(value);setSeasons(String(value.members[0]?.localScope.seasonNumber??''));
    }).catch(cause=>{if(current===generation.current)failure(cause,'资料对应读取失败，请关闭后重试。');})
      .finally(()=>{if(current===generation.current)setBusy(false);});
    return()=>{generation.current++;};
  },[runId]);
  async function inspect(){
    if(!state||busy||stale||locked||!allowed)return;
    const parts=seasons.trim().split(/[,，\s]+/);
    if(!queryLocked&&(parts.length>16||parts.some(part=>!/^\d{1,3}$/.test(part))||new Set(parts.map(Number)).size!==parts.length)){
      setError('请输入最多 16 个不重复的季号，用逗号分隔；特别篇填 0。');return;
    }
    inspectCommand.current??={idempotencyKey:newOpaqueId('episode-review-'),expectedRunStateRevision:state.runStateRevision,
      expectedMappingRevision:state.expectedMappingRevision,providerSeasons:parts.map(Number).sort((a,b)=>a-b)};
    focus.current?.focus({preventScroll:true});setBusy(true);setError('');
    try{
      const value=await helixAdminApi.inspectEpisodeMetadata(runId,inspectCommand.current);
      setReview(value.reviewRecord);setChoices([]);setLocalKey('');setEvidenceKey('');setUncertainPicks({});setAcknowledged(false);inspectCommand.current=null;
    }catch(cause){failure(cause,'查询结果尚未收到，请重试本次查询。');}
    finally{setBusy(false);}
  }
  function mergeChoices(additions:EpisodeMetadataChoice[]){
    if(!additions.length||locked||busy||stale)return;
    setChoices(previous=>{
      const next=[...previous];
      const materials=new Set(previous.map(choice=>choice.materialKey));
      const digests=new Set(previous.map(choice=>choice.evidenceDigest));
      for(const choice of additions){
        if(materials.has(choice.materialKey)||digests.has(choice.evidenceDigest))continue;
        materials.add(choice.materialKey);digests.add(choice.evidenceDigest);next.push(choice);
      }
      return next;
    });
    setLocalKey('');setEvidenceKey('');setUncertainPicks(previous=>{
      const next={...previous};for(const choice of additions)delete next[choice.materialKey];return next;
    });setAcknowledged(false);setError('');
  }
  function add(){
    if(!selectedLocal||!selectedEvidence||locked||busy||stale)return;
    if(choices.some(choice=>choice.materialKey!==localKey&&choice.evidenceDigest===evidenceKey)){
      setError('这条 Provider 资料已对应另一集，请先移除该对应。');return;
    }
    mergeChoices([{materialKey:localKey,localScope:selectedLocal.localScope,evidenceDigest:evidenceKey}]);
  }
  function addUncertain(materialKey:string,digest:string){
    if(!review||locked||busy||stale||!digest)return;
    const member=review.review.members.find(entry=>entry.materialKey===materialKey);
    if(!member)return;
    if(choices.some(choice=>choice.materialKey!==materialKey&&choice.evidenceDigest===digest)){
      setError('这条 Provider 资料已对应另一集，请先移除该对应。');return;
    }
    mergeChoices([{materialKey,localScope:member.localScope,evidenceDigest:digest}]);
  }
  async function confirm(){
    if(!review||busy||stale||!allowed||(!locked&&(!choices.length||!acknowledged)))return;
    confirmCommand.current??={idempotencyKey:newOpaqueId('episode-confirm-'),reviewId:review.recordId,
      reviewDigest:review.review.reviewDigest,choices:[...choices]};
    focus.current?.focus({preventScroll:true});setBusy(true);setError('');
    try{await helixAdminApi.confirmEpisodeMetadata(runId,confirmCommand.current);onSelected();}
    catch(cause){failure(cause,'确认结果尚未收到，请重试本次确认。');}
    finally{setBusy(false);}
  }
  const evidenceOptions=[...review?.review.evidence||[]].sort((a,b)=>a.providerEpisode.seasonNumber-b.providerEpisode.seasonNumber||a.providerEpisode.episodeNumber-b.providerEpisode.episodeNumber);
  return <div className="dialog-scrim" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget&&!busy)onClose();}}>
    <div className="dialog dialog-wide episode-metadata-dialog" ref={focus} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="episode-metadata-title" aria-busy={busy}>
      <div className="dialog-head"><h2 id="episode-metadata-title">确认季集资料</h2></div>
      <div className="dialog-body stack">
        <p><strong>{item.displayIdentity}</strong>{state&&` · TMDB ${state.providerKey}`}</p>
        {state&&!allowed&&<p role="status">当前任务已交付或结束，无法修改资料对应。</p>}
        <form onSubmit={event=>{event.preventDefault();void inspect();}}>
          <label htmlFor="episode-provider-seasons">查询 Provider 季号（特别篇为 0，可用逗号分隔）</label>
          <div className="identity-picker-input"><input id="episode-provider-seasons" value={seasons}
            disabled={busy||stale||locked||queryLocked||!allowed} onChange={event=>setSeasons(event.target.value)}/>
            <Button type="submit" disabled={busy||stale||locked||!allowed}>{queryLocked?'重试本次查询':'查询资料'}</Button></div>
        </form>
        {state?.currentMapping&&<details><summary>已有 {state.currentMapping.entries.length} 条对应</summary>
          <ul>{state.currentMapping.entries.map(entry=>{const evidence=state.currentReview?.evidence.find(e=>e.evidenceDigest===entry.evidenceDigest);
            return <li key={entry.materialKey}>{coordinate(entry.localScope)} → {evidence?`${coordinate(evidence.providerEpisode)} · ${evidence.title}`:'资料证据不可用'}</li>;})}</ul>
          <p>本次确认会替换全部已有对应；需要保留的对应也须加入。</p></details>}
        {review&&suggestion&&<>
          <p role="status">已选 {choices.length} / {review.review.members.length} 集 · 高置信 {suggestion.confident.length} · 待核对 {suggestion.uncertain.length}</p>
          {pendingConfident.length>0&&<div className="episode-metadata-batch">
            <Button type="button" variant="primary" disabled={busy||stale||locked||queryLocked}
              onClick={()=>mergeChoices(pendingConfident)}>加入全部高置信（{pendingConfident.length}）</Button>
            {pendingBySeason.length>1&&pendingBySeason.map(({seasonNumber,items})=>
              <Button key={seasonNumber} type="button" disabled={busy||stale||locked||queryLocked}
                onClick={()=>mergeChoices(items)}>加入第 {seasonNumber} 季高置信（{items.length}）</Button>)}
          </div>}
          {uncertainOpen.length>0&&<section className="episode-metadata-uncertain" aria-labelledby="episode-uncertain-title">
            <h3 id="episode-uncertain-title">待核对 {uncertainOpen.length}</h3>
            <ul>{uncertainOpen.map(member=>{
              const pick=uncertainPicks[member.materialKey]||'';
              const available=evidenceOptions.filter(entry=>!usedEvidence.has(entry.evidenceDigest)||entry.evidenceDigest===pick);
              return <li key={member.materialKey}>
                <div className="episode-metadata-uncertain-row">
                  <strong>{coordinate(member.localScope)}</strong>
                  <span>{member.title||'本地集'} · {member.airDate||'日期未知'}</span>
                  <label className="sr-only" htmlFor={`episode-uncertain-${member.materialKey}`}>为 {coordinate(member.localScope)} 选择 Provider 集</label>
                  <select id={`episode-uncertain-${member.materialKey}`} value={pick} disabled={busy||stale||locked||queryLocked}
                    onChange={event=>setUncertainPicks(previous=>({...previous,[member.materialKey]:event.target.value}))}>
                    <option value="">选择 Provider 集</option>
                    {available.map(entry=><option key={entry.evidenceDigest} value={entry.evidenceDigest}>
                      {coordinate(entry.providerEpisode)} · {entry.title} · {entry.airDate||'日期未知'}</option>)}
                  </select>
                  <Button type="button" disabled={busy||stale||locked||queryLocked||!pick}
                    onClick={()=>addUncertain(member.materialKey,pick)}>加入对应</Button>
                </div>
              </li>;
            })}</ul>
          </section>}
          {unselectedMembers.length>0&&<details className="episode-metadata-manual">
            <summary>手动调整未选对应</summary>
            <label htmlFor="episode-local">本地集</label>
            <select id="episode-local" value={localKey} disabled={busy||stale||locked||queryLocked} onChange={event=>{setLocalKey(event.target.value);setEvidenceKey('');}}>
              <option value="">选择本地集</option>{unselectedMembers.map(member=><option key={member.materialKey} value={member.materialKey}>{coordinate(member.localScope)} · {member.title}</option>)}
            </select>
            {selectedLocal&&<p>本地日期：{selectedLocal.airDate||'未知'}</p>}
            <label htmlFor="episode-provider">Provider 集</label>
            <select id="episode-provider" value={evidenceKey} disabled={busy||stale||locked||queryLocked||!selectedLocal} onChange={event=>setEvidenceKey(event.target.value)}>
              <option value="">选择 Provider 集</option>{evidenceOptions.filter(entry=>!usedEvidence.has(entry.evidenceDigest)).map(entry=><option key={entry.evidenceDigest} value={entry.evidenceDigest}>
                {coordinate(entry.providerEpisode)} · {entry.title} · {entry.airDate||'日期未知'}</option>)}
            </select>
            {selectedEvidence&&<div><strong>{selectedEvidence.title}</strong><p>{selectedEvidence.airDate||'日期未知'}</p><p>{selectedEvidence.plot||'暂无剧情资料'}</p></div>}
            {review.review.evidence.length===0&&<p role="status">这些季没有可选集资料，请核对季号后重新查询。</p>}
            <Button type="button" disabled={busy||stale||locked||queryLocked||!selectedLocal||!selectedEvidence} onClick={add}>加入对应</Button>
          </details>}
          {choices.length>0&&<ul className="episode-metadata-choices">{choices.map(choice=>{const evidence=review.review.evidence.find(entry=>entry.evidenceDigest===choice.evidenceDigest)!;
            const local=review.review.members.find(member=>member.materialKey===choice.materialKey)!;
            return <li key={choice.materialKey}>{coordinate(choice.localScope)} → {coordinate(evidence.providerEpisode)} · {evidence.title}
              <Button type="button" variant="text" disabled={busy||stale||locked||queryLocked} aria-label={`移除 ${coordinate(choice.localScope)} 的对应`}
                onClick={()=>{setChoices(previous=>previous.filter(item=>item.materialKey!==choice.materialKey));setAcknowledged(false);}}>移除</Button>
              <details><summary>查看双方资料</summary><p>本地：{coordinate(local.localScope)} · {local.title} · {local.airDate||'日期未知'}</p>
                <p>Provider：{coordinate(evidence.providerEpisode)} · {evidence.title} · {evidence.airDate||'日期未知'}</p>
                <p>{evidence.plot||'暂无剧情资料'}</p></details></li>;})}</ul>}
          <label className="episode-metadata-confirmation"><input type="checkbox" checked={acknowledged} disabled={busy||stale||locked||queryLocked||!choices.length} onChange={event=>setAcknowledged(event.target.checked)}/>
            确认后重新整理并使用上述资料，本地编号不变；未选择的集仍按本地编号查询。</label>
        </>}
        {busy&&<p role="status">正在处理…</p>}{error&&<p role="alert" className="form-error">{error}</p>}
      </div>
      <div className="dialog-actions"><Button type="button" disabled={busy} onClick={onClose}>关闭</Button>
        <Button type="button" variant="primary" disabled={busy||stale||queryLocked||!review||!allowed||!locked&&(!choices.length||!acknowledged)}
          onClick={()=>void confirm()}>{locked?'重试本次确认':'确认对应并重新整理'}</Button></div>
    </div>
  </div>;
}
