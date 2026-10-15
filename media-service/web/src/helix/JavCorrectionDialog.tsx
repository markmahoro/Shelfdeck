import {useCallback,useEffect,useRef,useState} from 'react';
import {Link} from 'react-router-dom';
import {Dialog} from '../components/ui';
import {Button} from './chrome';
import {AdminApiError,helixAdminApi,type CollectionEntry,type JavCorrectionPreview,type JavCorrectionStatus} from './api';
import {newOpaqueId} from './id';
import {javSourceLabel} from './jav-source-display';
import {useModalFocus} from './useModalFocus';

type Props={item:CollectionEntry;onClose:()=>void;onChanged:()=>void;onUnauthorized:()=>void};
const cleanupPending=(value:JavCorrectionStatus)=>value.state==='committed'&&value.cleanupState!=='completed';
const pending=(value:JavCorrectionStatus)=>['admitted','active','attention_required'].includes(value.state)||cleanupPending(value);
const cleanupLabels={pending:'身份已更新 · 等待清理',active:'身份已更新 · 正在清理',attention_required:'身份已更新 · 清理需要处理'};
const stateLabels:Record<JavCorrectionStatus['state'],string>={admitted:'等待纠正',active:'正在纠正',attention_required:'纠正需要处理',committed:'身份已纠正',cancelled:'纠正已取消'};
const roleLabels:Record<string,string>={primary_payload:'视频',metadata_sidecar:'NFO',poster:'海报',fanart:'背景图'};

export default function JavCorrectionDialog({item,onClose,onChanged,onUnauthorized}:Props){
  const [code,setCode]=useState(item.providerKey),[preview,setPreview]=useState<JavCorrectionPreview|null>(null);
  const [status,setStatus]=useState<JavCorrectionStatus|null>(null),[checked,setChecked]=useState(false),[busy,setBusy]=useState(false),[submitting,setSubmitting]=useState(false);
  const [consent,setConsent]=useState(false),[imageFailed,setImageFailed]=useState(false),[error,setError]=useState(''),[needsSource,setNeedsSource]=useState(false),[invalidPreview,setInvalidPreview]=useState(false);
  const alive=useRef(true),generation=useRef(0),command=useRef<string|null>(null),notified=useRef<string|null>(null),input=useRef<HTMLInputElement>(null);
  const dialog=useModalFocus<HTMLElement>(true,onClose,submitting);
  useEffect(()=>{alive.current=true;document.body.classList.add('modal-open');return()=>{alive.current=false;generation.current++;document.body.classList.remove('modal-open');};},[]);
  const report=useCallback((cause:unknown)=>{
    if(cause instanceof AdminApiError&&cause.status===401){onUnauthorized();return;}
    const key=cause instanceof AdminApiError?cause.code:'';
    if(key==='PLATFORM_INTEGRATION_NOT_CONFIGURED'){setNeedsSource(true);setError('没有已连接的适用资料来源。');}
    else if(key==='ARCA_JAV_CORRECTION_INPUT_INVALID')setError('请输入完整番号，例如 IPX-177 或 FC2-718323。');
    else if(key==='ARCA_JAV_CORRECTION_BUSY')setError('此收藏正在处理，请稍后重新核对。');
    else if(key==='ARCA_JAV_CORRECTION_SAME_IDENTITY')setError('新番号与当前影片相同，请核对输入。');
    else if(key==='ARCA_JAV_CORRECTION_PREVIEW_EXPIRED'||key.endsWith('_STALE')){setInvalidPreview(true);setError('收藏或资料来源已变化，请重新查询。');}
    else if(key.includes('COLLISION')||key.includes('TARGET_EXISTS'))setError('目标位置已被占用，请处理冲突后重新查询。');
    else if(key==='ARCA_JAV_CORRECTION_INELIGIBLE')setError('此收藏当前无法纠正，请关闭后刷新收藏。');
    else setError('核对未完成，请重试。');
  },[onUnauthorized]);
  const refresh=useCallback(async()=>{
    const current=++generation.current;
    try{
      const next=status?await helixAdminApi.getJavCorrection(item.shelfEntryId,status.correctionId):(await helixAdminApi.getLatestJavCorrection(item.shelfEntryId)).correction;
      if(!alive.current||current!==generation.current)return;
      setError('');setChecked(true);
      if(status||next&&pending(next))setStatus(next);
      if(next?.state==='committed'&&status&&notified.current!==next.correctionId){notified.current=next.correctionId;onChanged();}
    }catch(cause){if(alive.current&&current===generation.current)report(cause);}
  },[item.shelfEntryId,status,onChanged,report]);
  useEffect(()=>{void refresh();},[]);
  useEffect(()=>{
    if(!checked||status)return;input.current?.focus();
  },[checked,status]);
  useEffect(()=>{
    if(!status||(!['admitted','active'].includes(status.state)&&!(cleanupPending(status)&&status.cleanupState!=='attention_required')))return;
    const timer=setTimeout(()=>void refresh(),2000);return()=>clearTimeout(timer);
  },[status,refresh]);
  const lookup=async(candidate?:{siteRef:string;resourceKey:string})=>{
    if(!checked||status||!code.trim()||busy||submitting)return;
    const current=++generation.current;setBusy(true);setError('');setPreview(null);setConsent(false);setImageFailed(false);setNeedsSource(false);setInvalidPreview(false);command.current=null;
    try{const result=await helixAdminApi.previewJavCorrection(item.shelfEntryId,code.trim(),candidate);
      if(!alive.current||current!==generation.current)return;setPreview(result);
      if(result.result==='not_qualified')setError('未取得匹配影片的标题和可用封面，请核对番号或稍后重试。');
    }catch(cause){if(alive.current&&current===generation.current)report(cause);}
    finally{if(alive.current&&current===generation.current)setBusy(false);}
  };
  const selected=preview?.result==='qualified'?preview:null;
  const confirm=async()=>{
    if(!selected||!consent||imageFailed||invalidPreview||submitting)return;
    command.current??=`jav-correction:${item.shelfEntryId}:${newOpaqueId()}`;setSubmitting(true);setError('');
    try{const accepted=await helixAdminApi.confirmJavCorrection(item.shelfEntryId,selected,command.current);
      if(alive.current){setStatus({...accepted,cleanupState:null,cancellation:{available:false,reasonCode:'not_attention_required'},recovery:{available:false,mode:null,previousIntentDigest:null},oldJavCode:selected.oldIdentity.javCode,newJavCode:selected.newIdentity.javCode});setPreview(null);}
    }catch(cause){if(alive.current)report(cause);}finally{if(alive.current)setSubmitting(false);}
  };
  const close=()=>{if(!submitting)onClose();};
  return <Dialog open title="核对影片" dialogRef={dialog} onClose={close} actions={<>
    <Button type="button" disabled={submitting} onClick={close}>{status?.state==='committed'&&!cleanupPending(status)?'完成':'关闭'}</Button>
    {!status&&<Button type="button" variant="primary" disabled={!selected||!consent||imageFailed||invalidPreview||busy||submitting||!checked} onClick={()=>void confirm()}>{submitting?'正在确认…':'确认纠正'}</Button>}
  </>}><div className="identity-picker jav-correction">
    {error&&<p className="identity-picker-error" role="alert">{error}</p>}
    {!checked&&<>{!error?<p role="status">正在读取纠正状态…</p>:<Button type="button" onClick={()=>void refresh()}>重新读取状态</Button>}</>}
    {status?<section aria-label="纠正状态"><strong role="status">{cleanupPending(status)?cleanupLabels[status.cleanupState as keyof typeof cleanupLabels]||'正在读取清理状态…':stateLabels[status.state]}</strong><p>{status.oldJavCode} → {status.newJavCode}</p>
      <Link to={`/formation?correctionId=${encodeURIComponent(status.correctionId)}`} onClick={close}>查看维护任务</Link>
      {(status.state==='attention_required'||status.cleanupState==='attention_required'||error)&&<Button type="button" disabled={submitting} onClick={()=>void refresh()}>刷新状态</Button>}
    </section>:<>
      <form onSubmit={event=>{event.preventDefault();void lookup();}}><label htmlFor="jav-correction-code">新番号</label>
        <div className="identity-picker-input"><input ref={input} id="jav-correction-code" value={code} maxLength={64} autoComplete="off" disabled={!checked||submitting}
          onChange={event=>{generation.current++;setCode(event.target.value);setPreview(null);setConsent(false);setError('');setBusy(false);setNeedsSource(false);command.current=null;}}/>
          <Button type="submit" disabled={!checked||!code.trim()||busy||submitting}>{busy?'正在查询…':'查询'}</Button></div></form>
      {busy&&<p role="status">正在核验影片和封面…</p>}
      {needsSource&&<Link to="/settings" onClick={close}>连接 JAV 资料来源</Link>}
      {preview?.result==='ambiguous'&&<div><p>找到多个同号记录，请逐项核验。</p>{preview.candidates.map((candidate,index)=><Button type="button" key={`${candidate.siteRef}:${candidate.resourceKey}`} disabled={busy||submitting}
        onClick={()=>void lookup(candidate)}>核验候选 {index+1} · {javSourceLabel(candidate.siteRef)}</Button>)}</div>}
      {selected&&<>
        <div className="jav-correction-identities" aria-label="新旧影片预览">
          <section><h2>当前影片</h2><div className="identity-picker-preview">{item.hasPoster&&<img src={helixAdminApi.collectionPosterUrl(item.shelfEntryId,item.currentInventoryRevision,'detail')} alt="当前影片封面"/>}<div><strong>{selected.oldIdentity.title}</strong><p>{selected.oldIdentity.javCode}</p></div></div></section>
          <section><h2>纠正为</h2><div className="identity-picker-preview">{!imageFailed?<img src={selected.newIdentity.posterUrl} alt="新影片封面" onError={()=>setImageFailed(true)}/>:<span>封面显示失败，请重新查询。</span>}<div><strong>{selected.newIdentity.title}</strong><p>{selected.newIdentity.javCode}</p><p>来源 · {javSourceLabel(selected.newIdentity.siteRef)}</p></div></div></section>
        </div>
        <details className="jav-correction-paths"><summary>文件位置 · {selected.paths.length} 项</summary>{selected.paths.map(path=><dl key={path.materialKey}><dt>{roleLabels[path.role]||'附件'}</dt><dd><span>原位置</span><code>{path.previousLocation}</code><span>新位置</span><code>{path.targetLocation}</code></dd></dl>)}</details>
        <label className="jav-correction-consent"><input type="checkbox" checked={consent} disabled={submitting} onChange={event=>setConsent(event.target.checked)}/><span>保留视频，按预览位置更新番号、标题、图片和 NFO。</span></label>
      </>}
    </>}
  </div></Dialog>;
}
