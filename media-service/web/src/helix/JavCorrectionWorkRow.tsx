import {useEffect,useRef,useState} from 'react';
import {AdminApiError,helixAdminApi,type JavCorrectionWorkItem} from './api';
import {Button} from './chrome';
import {newOpaqueId} from './id';
import {ProcessStages} from './ProcessStages';

export function correctionWorkLabel(item:JavCorrectionWorkItem){
  if(item.state==='cancelled')return '纠正已取消';
  if(item.state==='committed')return ({pending:'身份已更新 · 等待清理',active:'身份已更新 · 正在清理',attention_required:'身份已更新 · 清理需要处理',completed:'已完成'})[item.cleanupState!]||'正在读取清理状态';
  return ({admitted:'等待纠正',active:'正在纠正',attention_required:'纠正需要处理'})[item.state];
}
export function JavCorrectionWorkRow({item,onOpen,onChanged,onUnauthorized}:{item:JavCorrectionWorkItem;onOpen:(item:JavCorrectionWorkItem)=>void;onChanged:()=>void;onUnauthorized:()=>void}){
  const [action,setAction]=useState<'cancel'|'recover'|null>(null),[consentBasis,setConsentBasis]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[conflicts,setConflicts]=useState<string[]>([]);
  const command=useRef<{kind:'cancel'|'recover';status:JavCorrectionWorkItem;key:string}|null>(null),live=useRef(true),pending=useRef(false);
  const actionStatus=command.current?.status||item,confirmationBasis=JSON.stringify([action,actionStatus.correctionId,actionStatus.shelfEntryId,
    actionStatus.stateRevision,actionStatus.admissionDigest,actionStatus.state,actionStatus.cleanupState,actionStatus.recovery.mode,
    actionStatus.recovery.previousIntentDigest,actionStatus.recovery.available,actionStatus.cancellation.available]),consent=consentBasis===confirmationBasis,
    actionAvailable=Boolean(command.current)||(action==='cancel'?item.cancellation.available:item.recovery.available);
  const setConsent=(value:boolean)=>setConsentBasis(value?confirmationBasis:null);
  useEffect(()=>{if(!command.current)setConsentBasis(null);},[confirmationBasis]);
  useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
  const submit=async()=>{
    if(!consent||!actionAvailable||pending.current||!action)return;
    command.current??={kind:action,status:item,key:newOpaqueId()};const request=command.current;
    pending.current=true;setBusy(true);setError('');setConflicts([]);
    try{const result=request.kind==='cancel'?await helixAdminApi.cancelJavCorrection(request.status.shelfEntryId,request.status,request.key):
      await helixAdminApi.recoverJavCorrection(request.status.shelfEntryId,request.status,request.key);
      if(request.kind==='cancel'?result.state!=='cancelled':!['active','committed'].includes(result.state))throw new Error('Correction command has not been admitted.');
      if(live.current){setAction(null);setConsent(false);command.current=null;onChanged();}}
    catch(cause){if(live.current){if(cause instanceof AdminApiError&&cause.status===401)onUnauthorized();
      else if(cause instanceof AdminApiError&&['ARCA_JAV_CORRECTION_RECOVERY_SCENE_INVALID','ARCA_JAV_CORRECTION_RECOVERY_UNPROVEN'].includes(cause.code)){
        setError('文件与处理记录不一致，请核对后重试。');setConflicts(Array.isArray(cause.details.locations)?cause.details.locations.filter((value):value is string=>typeof value==='string').slice(0,8):[]);
        setAction(null);setConsent(false);command.current=null;onChanged();}
      else if(cause instanceof AdminApiError&&cause.status===409){setError('当前状态已变化，请刷新任务。');setAction(null);setConsent(false);command.current=null;onChanged();}
      else setError(request.kind==='cancel'?'取消未完成，请重试。':'尚未确认继续请求，请重试。');}}
    finally{pending.current=false;if(live.current)setBusy(false);}
  };
  const begin=(kind:'cancel'|'recover')=>{setAction(kind);setConsent(false);setError('');setConflicts([]);command.current=null;};
  const continuingCleanup=actionStatus.recovery.mode==='continue_cleanup',continueLabel=continuingCleanup?'继续清理':'继续纠正';
  return <tr className="formation-stub-media-row"><td><strong>{item.displayIdentity}</strong><small>{item.oldJavCode} → {item.newJavCode}</small></td><td>—</td><td>{item.targetShelfName||'—'}</td><td>纠正影片身份</td>
    <td><strong className="formation-stub-current">{correctionWorkLabel(item)}</strong></td>
    <td><Button type="button" variant="text" onClick={()=>onOpen(item)}>查看过程</Button></td>
    <td>{action?<div><label><input type="checkbox" checked={consent} disabled={busy||!actionAvailable} onChange={event=>setConsent(event.target.checked)}/>{action==='cancel'?'结束此次纠正，保留当前影片和视频。':
      continuingCleanup?'继续清理本次纠正的旧资料和临时文件，保留当前影片和视频。':'继续按已确认的番号更新资料和文件位置，保留视频。'}</label>
      <Button type="button" disabled={!consent||busy||!actionAvailable} onClick={()=>void submit()}>{busy?(action==='cancel'?'正在取消…':'正在受理…'):(action==='cancel'?'确认取消':continueLabel)}</Button>
      <Button type="button" disabled={busy} onClick={()=>{setAction(null);setConsent(false);setError('');setConflicts([]);command.current=null;onChanged();}}>返回</Button></div>:
      <>{item.recovery.available&&<Button type="button" onClick={()=>begin('recover')}>{continueLabel}</Button>}{item.cancellation.available&&<Button type="button" onClick={()=>begin('cancel')}>取消纠正</Button>}</>}
      {error&&<p role="alert">{error}</p>}{conflicts.length>0&&<ul>{conflicts.map(location=><li key={location}>{location}</li>)}</ul>}
      {!item.cancellation.available&&!item.recovery.available&&item.classification==='attention_required'&&<span>需要处理</span>}</td><td>—</td><td>维护任务<small>身份纠正</small></td></tr>;
}
export function JavCorrectionWorkDetail({item,onUnauthorized}:{item:JavCorrectionWorkItem;onUnauthorized:()=>void}){
  const [detail,setDetail]=useState(item),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  useEffect(()=>{let cancelled=false,timer:ReturnType<typeof setTimeout>|undefined;setDetail(item);setError('');
    const read=async()=>{let again=true;
      try{const result=await helixAdminApi.listJavCorrectionWork(undefined,item.correctionId);if(cancelled)return;
        if(result.items[0]){setDetail(result.items[0]);setError('');again=!['completed','ended'].includes(result.items[0].classification);}
        else{setError('当前没有可展示的纠正任务。');again=false;}}
      catch(cause){if(!cancelled){if(cause instanceof AdminApiError&&cause.status===401){again=false;onUnauthorized();}else setError('纠正过程读取失败，请重试。');}}
      if(!cancelled&&again)timer=setTimeout(()=>void read(),3000);
    };void read();
    return()=>{cancelled=true;if(timer)clearTimeout(timer);};
  },[item.correctionId,retry,onUnauthorized]);
  return <article className="formation-process-card"><header className="formation-process-head"><div><span className="formation-process-eyebrow">上架后维护 · 身份纠正</span><h3>{detail.displayIdentity}</h3><p>{correctionWorkLabel(detail)}</p></div></header>
    <dl className="formation-process-facts"><div><dt>影片身份</dt><dd>{detail.oldJavCode} → {detail.newJavCode}</dd></div><div><dt>目标收藏架</dt><dd>{detail.targetShelfName||'—'}</dd></div></dl>
    {error?<><p role="alert">{error}</p><Button type="button" onClick={()=>setRetry(value=>value+1)}>重新读取过程</Button></>:detail.processDetail?<ProcessStages stages={detail.processDetail.stages}/>:<p role="status">正在读取纠正过程…</p>}
  </article>;
}
