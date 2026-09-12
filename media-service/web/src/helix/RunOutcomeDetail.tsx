import {useCallback,useEffect,useRef,useState} from 'react';
import {Button} from './chrome';
import {helixAdminApi,type FormationRunHistory,type LibraRunOutcome} from './api';
import {newOpaqueId} from './id';
import {isUnauthorized,useSession} from './session';

const reasonLabels:Record<string,string>={playback_decode_failed:'成品未通过播放检查',
  required_artifact_missing:'本次未能取得要求的附件',
  LIBRA_ARTIFACT_FETCH_FAILED:'本次附件获取失败',EXECUTION_TIMEOUT:'本次处理超时',
  product_metadata_required_cast_missing:'本次未能取得演员资料',
  product_conformance_failed:'成品未通过上架要求检查'};
export function terminalReasonLabels(reasons:LibraRunOutcome['terminalReasons']) {
  const labels=[...new Set((reasons||[]).map(reason=>reasonLabels[reason.failureCode]||'本次处理未完成'))];
  return labels.length?labels:['本次处理未完成'];
}

export default function RunOutcomeDetail({item,onChanged}:{item:FormationRunHistory;onChanged:()=>void}) {
  const {expire}=useSession();
  const [outcome,setOutcome]=useState<LibraRunOutcome|null>(null),[loading,setLoading]=useState(true);
  const [error,setError]=useState(''),[confirming,setConfirming]=useState(false),[busy,setBusy]=useState(false),[submitted,setSubmitted]=useState(false);
  const generation=useRef(0),key=useRef(newOpaqueId());
  const dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLElement|null>(null);
  useEffect(()=>{if(!confirming)return;trigger.current=document.activeElement instanceof HTMLElement?document.activeElement:null;
    dialog.current?.showModal();return()=>{dialog.current?.close();trigger.current?.focus();};},[confirming]);
  const load=useCallback(async()=>{
    const current=++generation.current;setLoading(true);setError('');setOutcome(null);
    try {const result=await helixAdminApi.readRunOutcome(item.libraRunId);
      if(current!==generation.current)return;
      if(result.outcome?.outcome!=='unable_to_on_deck'||result.outcome.reasonCode!=='processing_failed')throw new Error('Outcome unavailable');
      setOutcome(result.outcome);
    }catch(cause){if(current===generation.current){if(isUnauthorized(cause))expire();else setError('整理结果读取失败，请重新读取。');}}
    finally{if(current===generation.current)setLoading(false);}
  },[item.libraRunId,expire]);
  useEffect(()=>{void load();return()=>{generation.current++;};},[load]);
  async function submit(){
    if(!outcome||busy)return;setBusy(true);setError('');
    try{await helixAdminApi.reprocessRun(outcome,key.current);setConfirming(false);setSubmitted(true);onChanged();}
    catch(cause){if(isUnauthorized(cause))expire();else setError('重新整理未确认成功，请重试。');}
    finally{setBusy(false);}
  }
  return <article className="formation-run-outcome">
    {loading?<p role="status">正在读取整理结果…</p>:outcome?<>
      <h3>无法上架</h3>
      <ul>{terminalReasonLabels(outcome.terminalReasons).map(reason=><li key={reason}>{reason}</li>)}</ul>
      {submitted?<p role="status">已提交重新整理</p>:<Button type="button" onClick={()=>{setError('');setConfirming(true);}}>重新整理</Button>}
    </>:<Button type="button" onClick={()=>void load()}>重新读取</Button>}
    {error&&!confirming&&<p role="alert">{error}</p>}
    {confirming&&<dialog ref={dialog} className="shelf-deregister-dialog" aria-labelledby="reprocess-confirm-title"
      onKeyDown={event=>event.stopPropagation()} onCancel={event=>{event.preventDefault();if(!busy)setConfirming(false);}}>
      <div className="dialog"><div className="dialog-head"><h2 id="reprocess-confirm-title">确认重新整理</h2></div>
        <div className="dialog-body"><p>{item.displayIdentity}</p><p>将从原文件来源重新检查并尝试整理一次，原始媒体保留。</p>{error&&<p role="alert">{error}</p>}</div>
        <div className="dialog-actions"><Button type="button" disabled={busy} onClick={()=>setConfirming(false)}>取消</Button>
          <Button type="button" variant="primary" disabled={busy} onClick={()=>void submit()}>{busy?'正在提交…':'确认重新整理'}</Button></div>
      </div>
    </dialog>}
  </article>;
}
