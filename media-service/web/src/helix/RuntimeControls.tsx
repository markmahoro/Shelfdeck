import {useEffect,useRef,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {helixAdminApi,type FormationResetPreview} from './api';
import {Button,LoadingState} from './chrome';
import {isUnauthorized,useSession} from './session';
import {useModalFocus} from './useModalFocus';
import {newOpaqueId} from './id';
import './runtime-controls.css';

const labels={starting:'正在启动',running:'后台运行中',stopping:'正在安全停机',stopped:'已安全停机',resuming:'正在恢复运行',resetting:'正在 Reset',error:'运行操作未完成'};

export default function RuntimeControls(){
  const {expire}=useSession();
  const status=useQuery({queryKey:['runtime-operations'],queryFn:()=>helixAdminApi.getRuntimeStatus(),
    refetchInterval:query=>query.state.data?.maintenance?.maintenanceActive||['stopping','resuming','resetting'].includes(query.state.data?.mode||'')?1000:5000});
  const [submitting,setSubmitting]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [open,setOpen]=useState(false),[preview,setPreview]=useState<FormationResetPreview|null>(null),[checking,setChecking]=useState(false),[confirmation,setConfirmation]=useState('');
  const previewRequest=useRef(0);
  const currentStatus=useRef(status.data);currentStatus.current=status.data;
  const [previewRevision,setPreviewRevision]=useState<number|null>(null);
  function closeDialog(){previewRequest.current++;setOpen(false);}
  useEffect(()=>()=>{previewRequest.current++;},[]);
  const dialog=useModalFocus<HTMLElement>(open,closeDialog,submitting);
  const mode=status.data?.mode;
  const busy=submitting||Boolean(mode&&['starting','stopping','resuming','resetting'].includes(mode));
  const commandsDisabled=busy||Boolean(status.error);
  const resetAllowed=mode==='stopped'&&!status.error;
  const stateChanged=open&&(!resetAllowed||(preview!==null&&previewRevision!==status.data?.revision));
  const confirmed=confirmation.trim()==='重置工作台';
  useEffect(()=>{if(stateChanged)setConfirmation('');},[stateChanged]);
  const unauthorized=Boolean(status.error&&isUnauthorized(status.error));
  useEffect(()=>{if(unauthorized)expire();},[expire,unauthorized]);
  function report(cause:unknown){if(isUnauthorized(cause))expire();else setError(cause instanceof Error?cause.message:'运行操作失败，请重试。');}
  async function command(kind:'stop'|'resume'){
    setSubmitting(true);setError('');setNotice('');
    try{await (kind==='stop'?helixAdminApi.stopRuntime(newOpaqueId('runtime-stop-')):helixAdminApi.resumeRuntime(newOpaqueId('runtime-resume-')));await status.refetch();}
    catch(cause){report(cause);}finally{setSubmitting(false);}
  }
  async function inspectReset(){
    if(!resetAllowed)return;
    const request=++previewRequest.current;
    const revision=status.data!.revision;setPreviewRevision(revision);
    setOpen(true);setPreview(null);setChecking(true);setConfirmation('');setError('');setNotice('');
    try{const value=await helixAdminApi.previewFormationReset();if(request===previewRequest.current){
      if(currentStatus.current?.mode!=='stopped'||currentStatus.current.revision!==revision)setError('运行状态已变化，请重新核对清单。');
      else setPreview(value);}}
    catch(cause){if(request===previewRequest.current)report(cause);}finally{if(request===previewRequest.current)setChecking(false);}
  }
  async function reset(){
    if(!preview?.ready||!confirmed||!resetAllowed||stateChanged)return;
    setSubmitting(true);setError('');
    try{await helixAdminApi.resetFormation(preview.previewDigest,newOpaqueId('formation-reset-'));setOpen(false);await status.refetch();}
    catch(cause){report(cause);setConfirmation('');}finally{setSubmitting(false);}
  }
  useEffect(()=>{const operation=status.data?.operation;
    if(operation?.kind==='reset'&&operation.state==='completed')setNotice(`已清理 ${operation.result?.removedSubjects||0} 项整理，服务保持停机。`);
  },[status.data?.operation]);
  const activity=status.data?.activity;
  const maintenance=mode==='running'&&status.data?.maintenance?.maintenanceActive?status.data.maintenance:null;
  const maintenanceLabel=maintenance?.phase==='settling'?'维护收尾中':maintenance?.phase==='entering'||maintenance?.phase==='recovering'?'正在安全进入维护':'维护中';
  const active=(activity?.inFlightEvents||0)+(activity?.inFlightRecoveries||0)+(activity?.inFlightOwnerReconciliations||0)+(activity?.inFlightAdminCommands||0);
  return <>
    <section className="runtime-controls" aria-label="运行控制" aria-busy={busy}>
      <div className="runtime-control-state" role="status" aria-live="polite"><strong>{status.error?'运行状态读取失败':maintenance?maintenanceLabel:mode?labels[mode]:'正在读取运行状态…'}</strong>
        {maintenance?.phase==='maintaining'&&<small>{maintenance.currentTask||'等待下一批任务'}</small>}
        {mode==='stopping'&&<small>{active?`等待 ${active} 项操作完成`:'正在收尾'}</small>}
      </div>
      <div className="runtime-control-actions">
        {mode==='running'&&<Button type="button" disabled={commandsDisabled} onClick={()=>void command('stop')}>安全停机</Button>}
        {mode==='stopped'&&<Button variant="primary" type="button" disabled={commandsDisabled} onClick={()=>void command('resume')}>恢复运行</Button>}
        {mode==='error'&&!status.data?.recoveryBackup&&status.data?.error?.code!=='RUNTIME_RESET_INTERRUPTED'&&<Button type="button" disabled={commandsDisabled} onClick={()=>void command('stop')}>重新停机</Button>}
        <Button type="button" disabled={commandsDisabled||!resetAllowed} onClick={()=>void inspectReset()}>重置工作台</Button>
        {status.error&&<Button type="button" onClick={()=>void status.refetch()}>重试读取</Button>}
      </div>
    </section>
    {!open&&(error||status.data?.error)&&<p className="form-error" role="alert">{error||status.data?.error?.message}</p>}
    {!open&&status.error&&!unauthorized&&<p className="form-error" role="alert">运行状态读取失败，请重试。</p>}
    {notice&&<p className="form-notice" role="status">{notice}</p>}
    {status.data?.recoveryBackup&&<details><summary>查看恢复资料</summary><p className="form-neutral">备份编号：{status.data.recoveryBackup}</p></details>}
    {open&&<div className="dialog-scrim"><section ref={dialog} className="runtime-reset-dialog" tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="runtime-reset-title" aria-busy={checking||submitting}>
      <h2 id="runtime-reset-title">重置整理工作台</h2>
      {checking?<LoadingState>正在核对清理范围…</LoadingState>:preview?<>
        {preview.empty?<p>{preview.blockers.length?'未找到可直接清理的整理任务。':'没有可重置的当前整理任务。'}</p>:<>
          <p>将清理 {preview.counts.subjects} 项当前整理任务，并释放对应的工作区、保管与上架目标预留。</p>
          <p>保留 {preview.protected.collectionCount} 条收藏、已完成/已结束历史、Aftercare 和文件来源配置。完成后仍保持停机。</p>
          {preview.ready&&<label className="runtime-reset-confirm">输入“重置工作台”以确认<input aria-label="确认词" autoComplete="off" disabled={stateChanged||submitting} value={confirmation} onChange={e=>setConfirmation(e.target.value)} /></label>}
        </>}
        {preview.blockers.map(blocker=><p className="form-error" role="alert" key={blocker.code}>{blocker.message}</p>)}
      </>:null}
      {error&&<p className="form-error" role="alert">{error}</p>}
      {stateChanged&&<p className="form-error" role="alert">{status.error?'运行状态读取失败，请重试。':resetAllowed?'运行状态已变化，请重新核对清单。':'服务尚未停稳，请先安全停机后重新核对。'}</p>}
      <div className="runtime-reset-actions"><Button type="button" disabled={submitting} onClick={closeDialog}>取消</Button>
        {!checking&&(error||stateChanged)&&<Button type="button" disabled={submitting||!resetAllowed} onClick={()=>void inspectReset()}>重新核对</Button>}
        <Button variant="danger" type="button" disabled={checking||submitting||!preview?.ready||!confirmed||!resetAllowed||stateChanged} onClick={()=>void reset()}>{submitting?'正在提交…':'确认重置'}</Button>
      </div>
    </section></div>}
  </>;
}
