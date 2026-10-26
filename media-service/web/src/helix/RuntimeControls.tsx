import {useEffect,useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {helixAdminApi,type FormationResetPreview} from './api';
import {Button,LoadingState} from './chrome';
import {isUnauthorized,useSession} from './session';
import {useModalFocus} from './useModalFocus';
import {newOpaqueId} from './id';
import './runtime-controls.css';

const labels={starting:'正在启动',running:'后台运行中',stopping:'正在安全停机',stopped:'已安全停机',resuming:'正在恢复运行',resetting:'正在重置工作台',error:'运行操作未完成'};
function space(bytes:string|null){return bytes===null?'尚未核算':`${(Number(BigInt(bytes)*100n/(1024n**3n))/100).toLocaleString('zh-CN')} GiB`;}

export default function RuntimeControls(){
  const {expire}=useSession(),queryClient=useQueryClient();
  const completedReset=useRef<string|null>(null);
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
  async function retryReset(){
    const request=status.data?.resetRetry;if(!request)return;
    setSubmitting(true);setError('');
    try{await helixAdminApi.resetFormation(request.previewDigest,request.idempotencyKey);await status.refetch();}
    catch(cause){report(cause);}finally{setSubmitting(false);}
  }
  useEffect(()=>{const operation=status.data?.operation;
    if(operation?.kind==='reset'&&operation.state==='completed'){
      setNotice('已重置工作台，服务保持停机。');
      if(completedReset.current!==operation.operationId){
        completedReset.current=operation.operationId;
        void queryClient.invalidateQueries({queryKey:['overview']});
      }
    }
  },[status.data?.operation,queryClient]);
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
        {mode==='stopped'&&!status.data?.resetStage&&<Button variant="primary" type="button" disabled={commandsDisabled} onClick={()=>void command('resume')}>恢复运行</Button>}
        {mode==='error'&&!status.data?.recoveryBackup&&status.data?.error?.code!=='RUNTIME_RESET_INTERRUPTED'&&<Button type="button" disabled={commandsDisabled} onClick={()=>void command('stop')}>重新停机</Button>}
        {(!status.data?.resetStage||status.data.resetStage==='awaiting_confirmation')&&<Button type="button" disabled={commandsDisabled||!resetAllowed} onClick={()=>void inspectReset()}>重置工作台</Button>}
        {status.data?.resetRetry&&<Button type="button" disabled={commandsDisabled} onClick={()=>void retryReset()}>继续本次重置</Button>}
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
        {preview.counts&&preview.protectedSummary?<>
          <p>将清除 {preview.counts.find(row=>row.table==='proc_candidate_packages')?.removed||0} 个未入藏采购包、{preview.counts.find(row=>row.table==='libra_runs')?.removed||0} 次无收藏依赖的整理记录及其未完成上架状态。</p>
          <p>保留 {preview.protectedSummary.collectionCount} 条当前及历史收藏、收藏证据与维护责任、配置、来源及收藏文件。</p>
          <p>无收藏依赖的历史仅保存在校验后的离线备份中。专用临时空间预计释放 {space(preview.expectedReleasedBytes)}，完成后仍保持停机。</p>
          {preview.ready&&<label className="runtime-reset-confirm">输入“重置工作台”以确认<input aria-label="确认词" autoComplete="off" disabled={stateChanged||submitting} value={confirmation} onChange={e=>setConfirmation(e.target.value)} /></label>}
        </>:<p>容量预检未通过，保留与清除范围尚未核算。</p>}
        <ul aria-label="各卷空间预算">{preview.volumeBudget.volumes.map(volume=><li key={volume.device}>
          <strong>{volume.allocations[0]?.directory}</strong><span>需要 {space(volume.requiredBytes)} · 可用 {space(volume.availableBytes)} · {volume.sufficient?'空间足够':'空间不足'}</span>
        </li>)}</ul>
        {preview.blockers.map(blocker=><p className="form-error" role="alert" key={blocker.code}>{blocker.code==='RESET_OPERATOR_SPACE_INSUFFICIENT'?'作业空间不足，请先整理备份，再重新核对。':blocker.message||`预检未通过（${blocker.code}）`}</p>)}
        <details><summary>查看预检明细</summary><dl><dt>合同版本</dt><dd>{preview.contractVersion}</dd><dt>预检摘要</dt><dd className="runtime-reset-digest">{preview.previewDigest}</dd></dl>
          {preview.counts&&<table><caption>在线记录保留与清除</caption><thead><tr><th>记录类型</th><th>保留</th><th>清除</th></tr></thead>
            <tbody>{preview.counts.filter(row=>row.retained||row.removed).map(row=><tr key={row.table}><td>{row.table}</td><td>{row.retained}</td><td>{row.removed}</td></tr>)}</tbody></table>}
        </details>
      </>:null}
      {error&&<p className="form-error" role="alert">{error}</p>}
      {stateChanged&&<p className="form-error" role="alert">{status.error?'运行状态读取失败，请重试。':resetAllowed?'运行状态已变化，请重新核对清单。':'服务尚未停稳，请先安全停机后重新核对。'}</p>}
      <div className="runtime-reset-actions"><Button type="button" disabled={submitting} onClick={closeDialog}>取消</Button>
        {!checking&&(error||stateChanged||preview&&!preview.ready)&&<Button type="button" disabled={submitting||!resetAllowed} onClick={()=>void inspectReset()}>重新核对</Button>}
        <Button variant="danger" type="button" disabled={checking||submitting||!preview?.ready||!confirmed||!resetAllowed||stateChanged} onClick={()=>void reset()}>{submitting?'正在提交…':'确认重置'}</Button>
      </div>
    </section></div>}
  </>;
}
