import {useEffect,useRef,useState} from 'react';
import {Dialog} from '../components/ui';
import {Button} from './chrome';
import {AdminApiError,helixAdminApi,type DefectAdmissionCandidate,type FormationSubject} from './api';
import {newOpaqueId} from './id';
import {isUnauthorized} from './session';

type PendingCommand={item:FormationSubject;candidate:DefectAdmissionCandidate;key:string;phase:'unknown'|'accepted'};
// An uncertain command must retain the original request, including its key,
// while the user closes and reopens the dialog in this browser session.
const pendingCommands=new Map<string,PendingCommand>();
const formatGiB=(bytes:number)=>`${(bytes/1073741824).toFixed(1)} GiB`;
function defectLabel(defect:DefectAdmissionCandidate['defects'][number],size:DefectAdmissionCandidate['sizeForecast']) {
  if(defect.defectCode==='artifacts_unavailable')return `缺少${(defect.artifactKindCodes||[]).map(kind=>({nfo:'资料文件',poster:'海报',fanart:'背景图'}[kind]||kind)).join('、')}`;
  if(defect.defectCode==='metadata_fields_unavailable') {
    const names:Record<string,string>={actor:'演员',director:'导演',plot:'简介',genre:'类型',title:'片名',year_or_release_date:'年份或上映日期',release_date:'上映日期',studio:'制作公司'};
    return `缺少${(defect.metadataFieldCodes||[]).map(code=>names[code]||code).join('、')}资料`;
  }
  if(defect.defectCode==='actor_unavailable')return '缺少演员资料';
  if(defect.defectCode==='media_requirements_unmet')return '原始媒体可用，但未达到本次媒体要求；本次处理失败原因仍保留';
  if(defect.defectCode==='size_cap_exceeded') {
    const max=size?.maxSizeBytes;
    if(Number.isSafeInteger(max)&&max!>0){
      if(size?.measured===true){
        if(Number.isSafeInteger(size.actualSizeBytes)&&size.actualSizeBytes!>0)
          return `上限 ${formatGiB(max!)}，实际 ${formatGiB(size.actualSizeBytes!)}，超出 ${formatGiB(Math.max(0,size.actualSizeBytes!-max!))}。`;
        return `上限 ${formatGiB(max!)}，实际体积暂不可用。`;
      }
      if(Number.isSafeInteger(size?.predictedBytes)&&size!.predictedBytes>0)
        return `上限 ${formatGiB(max!)}，预计 ${formatGiB(size!.predictedBytes)}，大约超出 ${formatGiB(Math.max(0,size!.predictedBytes-max!))}。`;
    }
    return '成品体积超过本次上限。';
  }
  return '外部寻源已耗尽，将保留原始媒体';
}
function matches(item:FormationSubject,candidate:DefectAdmissionCandidate){
  const run=item.currentRun;
  return Boolean(run&&run.state==='frozen'&&candidate.libraRunId===run.libraRunId&&
    candidate.frozenRunStateRevision===run.stateRevision&&candidate.frozenRunStateDigest===run.stateDigest&&candidate.candidateDigest);
}
function rejectionLabel(code:string){
  const labels:Record<string,string>={P9_DEFECT_ADMISSION_EVIDENCE_PENDING:'成品证据尚不完整，请重新检查。',
    P9_DEFECT_ADMISSION_INELIGIBLE:'当前成品没有可接受的差距，请重新检查。',
    P9_DEFECT_ADMISSION_NONWAIVABLE:'当前成品仍有必须满足的收藏要求，请重新检查。',
    LIBRA_DEFECT_ADMISSION_STATE:'整理状态已变化，请重新检查。',LIBRA_DEFECT_ADMISSION_STALE:'整理状态已变化，请重新检查。',
    LIBRA_DEFECT_ADMISSION_CANDIDATE_STALE:'瑕疵证据已变化，请重新检查。',P3_UOW_READ_FENCE_CHANGED:'处理依据已变化，请重新检查。'};
  return labels[code]||'本次确认未完成，请重新检查。';
}
export default function DefectAdmissionDialog({item,candidate,onClose,onComplete,onUnauthorized}:{item:FormationSubject;
  candidate:DefectAdmissionCandidate;onClose:()=>void;onComplete:()=>Promise<void>;onUnauthorized:()=>void}){
  const target=item.currentRun?.libraRunId||'',saved=pendingCommands.get(target),valid=matches(item,candidate);
  const [current,setCurrent]=useState(saved?.item||item),[preview,setPreview]=useState<DefectAdmissionCandidate|null>(saved?.candidate||(valid?candidate:null)),
    [phase,setPhase]=useState<'editing'|'stale'|'unknown'|'accepted'>(saved?.phase||(valid?'editing':'stale')),
    [error,setError]=useState(saved?.phase==='unknown'?'提交结果尚未确认。':saved?.phase==='accepted'?'瑕疵已接受，状态读取失败。':valid?'':'整理状态已变化，请重新检查。'),
    [busy,setBusy]=useState(false);
  const busyRef=useRef(false),dialog=useRef<HTMLElement>(null),origin=useRef<HTMLElement|null>(document.activeElement instanceof HTMLElement?document.activeElement:null),
    close=useRef(onClose);
  close.current=onClose;
  useEffect(()=>{
    const node=dialog.current;if(!node)return;document.body.classList.add('modal-open');node.focus();
    const keys=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(!busyRef.current)close.current();return;}
      if(event.key!=='Tab')return;
      const controls=Array.from(node.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href]'));
      const first=controls[0],last=controls[controls.length-1];
      if(!first){event.preventDefault();node.focus();return;}
      if(!node.contains(document.activeElement)||document.activeElement===node){event.preventDefault();(event.shiftKey?last:first)?.focus();}
      else if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    };
    document.addEventListener('keydown',keys,true);
    return()=>{document.removeEventListener('keydown',keys,true);document.body.classList.remove('modal-open');
      requestAnimationFrame(()=>{if(!node.isConnected&&origin.current?.isConnected)origin.current.focus();});};
  },[]);
  function beginBusy(){
    busyRef.current=true;dialog.current?.focus({preventScroll:true});setBusy(true);setError('');
  }
  async function refreshAccepted(){
    try{await onComplete();pendingCommands.delete(target);onClose();}
    catch(cause){if(isUnauthorized(cause))onUnauthorized();else setError('瑕疵已接受，状态读取失败。');}
  }
  async function recheck(){
    if(busyRef.current||phase!=='stale')return;beginBusy();
    try{
      const latest=await helixAdminApi.getFormation(current.formationViewId);
      if(latest.currentRun?.libraRunId!==target||latest.currentRun.state!=='frozen'){
        setPreview(null);setError('整理状态已变化，请返回刷新任务。');return;
      }
      const next=await helixAdminApi.previewDefectAdmission(latest);
      setCurrent(latest);
      if(next.eligibility!=='eligible'){setPreview(null);setError(next.message);return;}
      if(!matches(latest,next)){setPreview(null);setError('整理状态已变化，请重新检查。');return;}
      setPreview(next);setPhase('editing');
    }catch(cause){if(isUnauthorized(cause))onUnauthorized();else setError('重新检查失败，请稍后重试。');}
    finally{busyRef.current=false;setBusy(false);}
  }
  async function submit(){
    if(busyRef.current||phase==='stale')return;beginBusy();
    try{
      if(phase==='accepted'){await refreshAccepted();return;}
      let command=pendingCommands.get(target),wasUnknown=Boolean(command);
      if(!command){
        if(!preview||!matches(current,preview))return;
        command={item:current,candidate:preview,key:`admit-with-defects:${target}:${current.currentRun!.stateRevision}:${newOpaqueId()}`,phase:'unknown'};
        pendingCommands.set(target,command);
      }
      setPhase('unknown');
      try{
        const result=await helixAdminApi.admitWithDefects(command.item,command.candidate,command.key);
        if(result.resultKind!=='defect_admitted'||result.libraRunId!==target)throw new Error('Unverified command result');
      }catch(cause){
        if(isUnauthorized(cause)){onUnauthorized();return;}
        if(!wasUnknown&&cause instanceof AdminApiError&&cause.status>=400&&cause.status<500&&![408,425,429].includes(cause.status)){
          pendingCommands.delete(target);setPreview(null);setPhase('stale');setError(rejectionLabel(cause.code));
        }else setError('提交结果尚未确认。');
        return;
      }
      command.phase='accepted';setPhase('accepted');await refreshAccepted();
    }finally{busyRef.current=false;setBusy(false);}
  }
  return <Dialog dialogRef={dialog} closeDisabled={busy} open title="确认接受瑕疵入库" onClose={()=>{if(!busyRef.current)onClose();}} actions={<>
    <Button type="button" disabled={busy} onClick={onClose}>取消</Button>
    {phase==='stale'&&<Button type="button" disabled={busy} onClick={()=>void recheck()}>重新检查</Button>}
    {phase==='unknown'&&<Button type="button" disabled={busy} onClick={()=>void submit()}>确认提交结果</Button>}
    {phase==='accepted'&&<Button type="button" disabled={busy} onClick={()=>void submit()}>刷新状态</Button>}
    <Button type="button" variant="primary" disabled={busy||phase!=='editing'||!preview} onClick={()=>void submit()}>确认接受</Button>
  </>}>
    <div className="stack" aria-busy={busy}><p>{current.displayIdentity}</p>
      {preview&&<><ol>{preview.defects.map((defect,index)=><li key={`${defect.defectCode}-${index}`}>{defectLabel(defect,preview.sizeForecast)}</li>)}</ol>
        <p>本次按列明瑕疵继续上架，并保留瑕疵记录；上架仍须通过文件安全检查。</p></>}
      {error&&<p className="form-error" role="alert">{error}</p>}
    </div>
    {busy&&<p role="status">正在处理，请稍候。</p>}
  </Dialog>;
}
