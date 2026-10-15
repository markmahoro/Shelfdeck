import {useEffect,useRef,useState} from 'react';
import {Link} from 'react-router-dom';
import {Dialog} from '../components/ui';
import {Button} from './chrome';
import {AdminApiError,helixAdminApi,type FormationSubject,type JavIdentityPreview,type JavQualifiedIdentityPreview} from './api';
import {newOpaqueId} from './id';
import {javSourceLabel} from './jav-source-display';

type Props={item:FormationSubject;onClose:()=>void;onSelected:()=>void;onRefresh:()=>void;onUnauthorized?:()=>void};
export default function JavIdentityDialog({item,onClose,onSelected,onRefresh,onUnauthorized}:Props) {
  const [code,setCode]=useState(item.productIdentityIssue?.claimedCode||''),[preview,setPreview]=useState<JavIdentityPreview|null>(null);
  const [busy,setBusy]=useState(false),[submitting,setSubmitting]=useState(false),[error,setError]=useState('');
  const [stale,setStale]=useState(false),[imageFailed,setImageFailed]=useState(false),[needsSource,setNeedsSource]=useState(false);
  const input=useRef<HTMLInputElement>(null),content=useRef<HTMLDivElement>(null),generation=useRef(0),command=useRef<string|null>(null);
  useEffect(()=>{input.current?.focus();return()=>{generation.current++;};},[]);
  useEffect(()=>{
    const dialog=content.current?.closest('[role="dialog"]');if(!dialog)return;
    const keydown=(event:Event)=>{
      const key=event as KeyboardEvent;
      if(key.key==='Escape'){key.preventDefault();if(!submitting)onClose();}
      if(key.key==='Tab'){
        const controls=Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),a[href]'));
        const first=controls[0],last=controls[controls.length-1];
        if(key.shiftKey&&document.activeElement===first){key.preventDefault();last?.focus();}
        else if(!key.shiftKey&&document.activeElement===last){key.preventDefault();first?.focus();}
      }
    };dialog.addEventListener('keydown',keydown);return()=>dialog.removeEventListener('keydown',keydown);
  },[onClose,submitting]);
  const handleError=(cause:unknown)=>{
    if(cause instanceof AdminApiError&&cause.status===401){onUnauthorized?.();return;}
    const key=cause instanceof AdminApiError?cause.code:'';
    if(key==='LIBRA_JAV_IDENTITY_LOCKED'){setStale(true);setError('身份已确认，整理中不能更改番号。');onRefresh();}
    else if(['LIBRA_IDENTITY_SELECTION_STALE','LIBRA_IDENTITY_SELECTION_HEAD_STALE','LIBRA_IDENTITY_SELECTION_RUN_STATE'].includes(key)){
      setStale(true);setError('整理状态已变化，请关闭后重新查询。');onRefresh();
    }else if(key==='PLATFORM_INTEGRATION_NOT_CONFIGURED'){setNeedsSource(true);setError('没有已连接的适用资料来源。');}
    else if(key==='LIBRA_IDENTITY_SELECTION_INPUT')setError('请输入完整番号，例如 IPX-177 或 FC2-718323。');
    else if(key==='LIBRA_JAV_PREVIEW_EXPIRED'){setPreview(null);command.current=null;setImageFailed(false);setError('预览已过期，请重新查询。');}
    else setError('资料核验未完成，请重试。');
  };
  const lookup=async(candidate?:{siteRef:string;resourceKey:string})=>{
    if(!code.trim()||busy||submitting||stale)return;
    const current=++generation.current;setBusy(true);setPreview(null);setError('');setNeedsSource(false);setImageFailed(false);command.current=null;
    try{const result=await helixAdminApi.previewJavIdentity(item,code.trim(),candidate);
      if(current!==generation.current)return;setPreview(result);
      if(result.result==='not_qualified')setError('适用来源未找到标题和可用封面，请核对番号或稍后重试。');
    }catch(cause){if(current===generation.current)handleError(cause);}
    finally{if(current===generation.current)setBusy(false);}
  };
  const selected: JavQualifiedIdentityPreview|null=preview?.result==='qualified'?preview:null;
  const confirm=async()=>{
    if(!selected||imageFailed||submitting||stale)return;
    command.current??=`jav-identity:${item.currentRun?.libraRunId}:${newOpaqueId()}`;setSubmitting(true);setError('');
    try{await helixAdminApi.chooseJavIdentity(item,selected,command.current);onSelected();}
    catch(cause){handleError(cause);}finally{setSubmitting(false);}
  };
  return <Dialog open title="确认番号" onClose={()=>{if(!submitting)onClose();}} actions={<>
    <Button type="button" disabled={submitting} onClick={onClose}>稍后处理</Button>
    <Button type="button" variant="primary" disabled={!selected||imageFailed||busy||submitting||stale} onClick={()=>void confirm()}>{submitting?'正在提交…':'确认影片并继续整理'}</Button>
  </>}><div ref={content} className="identity-picker">
    <p>{item.displayIdentity}</p>
    {item.productIdentityIssue?.sourceLocation&&<dl><dt>原文件</dt><dd>{item.productIdentityIssue.sourceLocation}</dd></dl>}
    <form onSubmit={event=>{event.preventDefault();void lookup();}}><label htmlFor="jav-identity-code">番号</label>
      <div className="identity-picker-input"><input id="jav-identity-code" ref={input} autoComplete="off" value={code} maxLength={64} disabled={submitting||stale}
        onChange={event=>{generation.current++;setCode(event.target.value);setPreview(null);setError('');setBusy(false);setNeedsSource(false);command.current=null;}}/>
      <Button type="submit" disabled={!code.trim()||busy||submitting||stale}>{busy?'正在查询…':'查询'}</Button></div></form>
    {busy&&<p role="status">正在核验影片和封面…</p>}
    {error&&<p role="alert" className="identity-picker-error">{error}</p>}
    {needsSource&&<Link to="/settings" onClick={onClose}>连接 JAV 资料来源</Link>}
    {preview?.result==='ambiguous'&&<div><p>找到多个同号记录，请逐项核验。</p>
      {preview.candidates.map((candidate,index)=><Button key={`${candidate.siteRef}:${candidate.resourceKey}`} type="button" disabled={busy||submitting||stale}
        onClick={()=>void lookup({siteRef:candidate.siteRef,resourceKey:candidate.resourceKey})}>核验候选 {index+1} · {javSourceLabel(candidate.siteRef)}</Button>)}</div>}
    {selected&&<div className="identity-picker-preview" aria-label="影片预览">
      {!imageFailed?<img src={selected.posterUrl} alt={`${selected.displayTitle}封面`} onError={()=>setImageFailed(true)}/>:<div className="identity-picker-poster-empty">封面显示失败</div>}
      <div><strong>{selected.displayTitle}</strong><p>{selected.javCode}</p><p>来源 · {javSourceLabel(selected.siteRef)}</p></div>
    </div>}
  </div></Dialog>;
}
