import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {Dialog} from '../components/ui';
import {Button} from './chrome';
import {AdminApiError,helixAdminApi,type FormationSubject} from './api';
import {newOpaqueId} from './id';
import {processFailureLabel} from './error-labels';

type ImageInput={artifactKind:'poster'|'fanart';bytesBase64:string};
type PendingCommand={key:string;images:ImageInput[];phase:'unknown'|'accepted'};
// Retain uncertain commands across dialog reopening without browser storage.
const pendingCommands=new Map<string,PendingCommand>();
async function readImage(file:File,kind:ImageInput['artifactKind']):Promise<ImageInput>{
  const label=kind==='poster'?'剧集海报':'剧集背景';
  if(!file.size||file.size>8*1024*1024)throw new Error(`${label}不能超过 8 MB，且不能为空。`);
  if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error(`${label}需要是 JPEG、PNG 或 WebP 图片。`);
  const url=URL.createObjectURL(file);
  try{
    const image=new Image();image.src=url;
    try{await image.decode();}catch{throw new Error(`${label}无法读取，请选择其他图片。`);}
    if(kind==='poster'?image.height<=image.width:image.width<=image.height)throw new Error(kind==='poster'?'剧集海报需要竖版图片。':'剧集背景需要横版图片。');
  }finally{URL.revokeObjectURL(url);}
  const bytesBase64=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error(`${label}读取失败。`));reader.readAsDataURL(file);});
  return {artifactKind:kind,bytesBase64};
}
export default function SeriesPresentationRetryDialog({item,entry,canSupplyImages=true,onClose,onComplete}:{item?:FormationSubject;entry?:{shelfEntryId:string;displayIdentity:string};canSupplyImages?:boolean;onClose:()=>void;onComplete:()=>Promise<void>}){
  const target=item?`acceptance:${item.executorIssue?.offerId}`:`entry:${entry?.shelfEntryId}`;
  const [files,setFiles]=useState<Partial<Record<ImageInput['artifactKind'],File>>>({}),[busy,setBusy]=useState(false),[error,setError]=useState(''),
    [phase,setPhase]=useState<'editing'|'unknown'|'accepted'>(()=>pendingCommands.get(target)?.phase||'editing');
  const dialog=useRef<HTMLElement>(null),origin=useRef<HTMLElement|null>(document.activeElement instanceof HTMLElement?document.activeElement:null),busyRef=useRef(false),close=useRef(onClose);
  close.current=onClose;busyRef.current=busy;
  useLayoutEffect(()=>{if(busy)dialog.current?.focus();},[busy]);
  useEffect(()=>{
    const node=dialog.current;if(!node)return;document.body.classList.add('modal-open');node.focus();
    const keys=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(!busyRef.current)close.current();return;}
      if(event.key!=='Tab')return;
      const controls=Array.from(node.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]'));
      const first=controls[0],last=controls[controls.length-1];
      if(!node.contains(document.activeElement)||document.activeElement===node){event.preventDefault();(event.shiftKey?last:first)?.focus();}
      else if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    };
    const keepFocus=(event:FocusEvent)=>{if(busyRef.current&&event.target instanceof Node&&!node.contains(event.target))node.focus();};
    document.addEventListener('keydown',keys,true);document.addEventListener('focusin',keepFocus,true);
    return()=>{document.removeEventListener('keydown',keys,true);document.removeEventListener('focusin',keepFocus,true);document.body.classList.remove('modal-open');requestAnimationFrame(()=>{
      if(node.isConnected)return;
      if(origin.current?.isConnected)origin.current.focus();
      else document.querySelector<HTMLElement>('[role="dialog"]')?.focus();
    });};
  },[]);
  async function refresh(){try{await onComplete();pendingCommands.delete(target);onClose();}catch{setError('任务已受理，状态读取失败。');}}
  async function submit(){
    if(busyRef.current)return;busyRef.current=true;setBusy(true);setError('');
    try{
      if(phase==='accepted'){await refresh();return;}
      let command=pendingCommands.get(target);
      if(!command){
        const images:ImageInput[]=[];
        try{for(const kind of ['poster','fanart'] as const)if(files[kind])images.push(await readImage(files[kind]!,kind));}
        catch(cause){setError(cause instanceof Error?cause.message:'图片无法读取，请选择其他图片。');return;}
        command={key:`series-retry:${newOpaqueId()}`,images,phase:'unknown'};pendingCommands.set(target,command);
      }
      setPhase('unknown');
      try{
        if(item)await helixAdminApi.retryAcceptance(item,command.images,command.key);
        else if(entry)await helixAdminApi.checkCare(entry.shelfEntryId,command.images,command.key);
        else throw new Error('Retry target is unavailable.');
      }catch(cause){
        if(cause instanceof AdminApiError&&cause.status>=400&&cause.status<500){pendingCommands.delete(target);setPhase('editing');setError(processFailureLabel(cause.code));}
        else setError('提交结果尚未确认。');
        return;
      }
      command.phase='accepted';setPhase('accepted');await refresh();
    }finally{busyRef.current=false;setBusy(false);}
  }
  const locked=busy||phase!=='editing';
  return <Dialog dialogRef={dialog} open title="重试任务" onClose={()=>{if(!busyRef.current)onClose();}} actions={<>
    <Button type="button" variant="text" disabled={busy} onClick={onClose}>返回</Button>
    <Button type="button" disabled={busy} onClick={()=>void submit()}>{busy?'正在提交…':phase==='accepted'?'刷新状态':phase==='unknown'?'确认提交结果':'重试任务'}</Button>
  </>}>
    <div className="stack" aria-busy={busy}><p>{item?.displayIdentity||entry?.displayIdentity}</p>
      {canSupplyImages&&<>
        <label>剧集海报（可选，竖版，8 MB 以内）<input type="file" accept="image/jpeg,image/png,image/webp" disabled={locked} onChange={event=>{setError('');setFiles(value=>({...value,poster:event.target.files?.[0]}));}}/></label>
        <label>剧集背景（可选，横版，8 MB 以内）<input type="file" accept="image/jpeg,image/png,image/webp" disabled={locked} onChange={event=>{setError('');setFiles(value=>({...value,fanart:event.target.files?.[0]}));}}/></label>
      </>}
      {error&&<p className="form-error" role="alert">{error}</p>}
    </div>
  </Dialog>;
}
