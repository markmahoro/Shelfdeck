import {useEffect,useState} from 'react';
import {helixAdminApi,type FormationSubject} from './api';
import {Button} from './chrome';

export function DefectAdmissionControl({item,disabled,onAdmit}:{item:FormationSubject;disabled:boolean;onAdmit:()=>void}) {
  const [state,setState]=useState<'loading'|'eligible'|'ineligible'|'evidence_pending'|'error'>('loading');
  const [reason,setReason]=useState('');
  const [attempt,setAttempt]=useState(0);
  useEffect(()=>{
    let cancelled=false;
    setState('loading');
    void helixAdminApi.previewDefectAdmission(item).then(preview=>{
      if(!cancelled){setState(preview.eligibility);setReason(preview.eligibility==='eligible'?'':preview.message);}
    }).catch(()=>{
      if(!cancelled)setState('error');
    });
    return()=>{cancelled=true;};
  },[item.currentRun?.libraRunId,item.currentRun?.stateRevision,item.currentRun?.stateDigest,attempt]);
  if(state==='eligible')return <Button type="button" disabled={disabled} onClick={onAdmit}>接受瑕疵</Button>;
  if(state==='loading')return <small role="status">正在检查瑕疵接纳条件…</small>;
  if(state==='ineligible')return <small>{reason}</small>;
  if(state==='evidence_pending')return <span><small role="status">{reason}</small><Button type="button" variant="text" disabled={disabled} onClick={()=>setAttempt(value=>value+1)}>重新检查</Button></span>;
  return <span><small role="status">暂时无法确认瑕疵接纳条件</small><Button type="button" variant="text" disabled={disabled}
    onClick={()=>setAttempt(value=>value+1)}>重新检查</Button></span>;
}
