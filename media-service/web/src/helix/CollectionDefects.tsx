import {useCallback,useEffect,useRef,useState} from 'react';
import {Button} from './chrome';
import {helixAdminApi,type AcceptedGap,type CollectionDefectPreview} from './api';
import {newOpaqueId} from './id';
import {isUnauthorized,useSession} from './session';

const labels:Record<string,string>={actor:'演员资料',plot:'剧情简介',overview:'剧情简介',title:'片名',year:'年份',genres:'类型',director:'导演资料',
  poster:'海报',nfo:'说明书',video_codec_unmet:'视频编码',container_unmet:'封装格式',file_extension_unmet:'文件格式',minimum_raster_unmet:'清晰度',primary_audio_unmet:'音轨',max_size_exceeded:'体积'};
export function gapLabel(gap:AcceptedGap) {
  if(gap.targetKind!=='media')return `${labels[gap.targetId] || gap.targetId}缺失`;
  const value=gap.requiredValue?.value;
  const target=gap.requirementCode==='max_size_exceeded'&&typeof value==='number'?`${(value/1024**3).toFixed(1)} GB`:
    Array.isArray(value)?value.join(' / '):typeof value==='string'?value:'';
  return `${labels[gap.requirementCode] || '媒体要求'}未达标${target?`（目标 ${target}）`:''}`;
}
const blockers:Record<string,string>={maintenance_in_progress:'当前维护结束后可重新检查瑕疵处理条件。',modification_fenced:'收藏正在退出或收藏架不可用。',no_current_gaps:'当前没有需要接受的瑕疵。'};

export default function CollectionDefects({shelfEntryId,revision,onChanged}:{shelfEntryId:string;revision:string;onChanged:()=>void}) {
  const {expire}=useSession();
  const [preview,setPreview]=useState<CollectionDefectPreview|null>(null),[error,setError]=useState(''),[message,setMessage]=useState('');
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[action,setAction]=useState<'accept-defects'|'repair-accepted-defects'|null>(null);
  const dialog=useRef<HTMLDialogElement>(null),version=useRef(0),key=useRef(''),trigger=useRef<HTMLElement|null>(null);
  const load=useCallback(async()=>{const id=++version.current;setLoading(true);setError('');
    try{const result=await helixAdminApi.previewCollectionDefects(shelfEntryId);if(id===version.current)setPreview(result);}
    catch(cause){if(id!==version.current)return;if(isUnauthorized(cause))expire();else setError('瑕疵信息读取失败，请重新读取。');}
    finally{if(id===version.current)setLoading(false);}
  },[shelfEntryId,expire]);
  useEffect(()=>{setPreview(null);setAction(null);void load();return()=>{version.current++;};},[load,revision]);
  useEffect(()=>{if(!action)return;dialog.current?.showModal();return()=>{dialog.current?.close();trigger.current?.focus();};},[action]);
  const accepted=new Set(preview?.acceptedGaps.map(gap=>gap.gapDigest));
  const newGaps=preview?.gaps.filter(gap=>!accepted.has(gap.gapDigest)) || [];
  function open(value:typeof action){trigger.current=document.activeElement as HTMLElement;key.current=newOpaqueId('collection-defects-');setMessage('');setError('');setAction(value);}
  async function confirm(){if(!preview||!action||busy)return;setBusy(true);setError('');
    try{const result=await helixAdminApi.decideCollectionDefects(preview,action,key.current);
      setAction(null);setMessage(result.resultKind==='repair_unavailable'?'当前没有可执行的修复路径。':action==='accept-defects'?'已接受列出的瑕疵。':'已提交手动修复，可在媒体整理中查看进展。');
      await load();onChanged();
    }catch(cause){if(isUnauthorized(cause))expire();else setError('操作未完成，请重新读取当前状态后重试。');}
    finally{setBusy(false);}}
  return <section className="collection-health" aria-labelledby="collection-defects-heading">
    <div className="collection-health-heading"><h3 id="collection-defects-heading">瑕疵</h3><Button type="button" disabled={loading||busy} onClick={()=>void load()}>重新读取</Button></div>
    {loading?<p role="status">正在读取瑕疵…</p>:error&&!action?<p role="alert">{error}</p>:preview&&<>
      {preview.gaps.length>0&&<ul>{preview.gaps.map(gap=><li key={gap.gapDigest}>{gapLabel(gap)}{accepted.has(gap.gapDigest)&&<> · <span className="ui-state" data-state="unknown">已接受</span></>}</li>)}</ul>}
      {preview.eligibility==='evidence_pending'&&<p role="status">需要一次完整的健康检查来确认当前瑕疵，请使用上方“立即检查健康”。</p>}
      {preview.eligibility==='ineligible'&&<p>{preview.ineligibleReasons.map(code=>blockers[code] || '当前存在文件安全或完整性问题，不能接受为瑕疵。').filter((value,index,array)=>array.indexOf(value)===index).join(' ')}</p>}
      {preview.eligibility==='eligible'&&<div className="dialog-actions">
        {newGaps.length>0&&<Button type="button" onClick={()=>open('accept-defects')}>接受当前瑕疵</Button>}
        {preview.repairableGapDigests.length>0&&<Button type="button" onClick={()=>open('repair-accepted-defects')}>手动修复已接受瑕疵</Button>}
      </div>}
      {preview.acceptedGaps.length>0&&preview.unavailableRepairs.length>0&&<p>部分已接受瑕疵当前没有可执行的修复路径，暂时保留。</p>}
    </>}
    {message&&<p role="status">{message}</p>}
    {action&&preview&&<dialog ref={dialog} className="shelf-deregister-dialog" aria-labelledby="collection-defect-confirm-title"
      onKeyDown={event=>event.stopPropagation()} onCancel={event=>{event.preventDefault();if(!busy)setAction(null);}}>
      <div className="dialog"><div className="dialog-head"><h2 id="collection-defect-confirm-title">{action==='accept-defects'?'接受当前瑕疵':'手动修复已接受瑕疵'}</h2></div>
        <div className="dialog-body"><ul>{(action==='accept-defects'?preview.gaps:preview.acceptedGaps.filter(gap=>preview.repairableGapDigests.includes(gap.gapDigest))).map(gap=><li key={gap.gapDigest}>{gapLabel(gap)}</li>)}</ul>
          <p>{action==='accept-defects'?'接受后保留当前影片，列出的差距不再自动修复。文件安全问题仍会独立检查。':'将排队尝试修复列出的瑕疵。成功后更新收藏；失败时保留原片和瑕疵，结束本次尝试。其他已接受瑕疵继续保留。'}</p>
          {error&&<p role="alert">{error}</p>}
        </div><div className="dialog-actions"><Button type="button" disabled={busy} onClick={()=>setAction(null)}>取消</Button>
          <Button type="button" variant="primary" disabled={busy||Boolean(error)} onClick={()=>void confirm()}>{busy?'正在提交…':action==='accept-defects'?'确认接受':'提交手动修复'}</Button>
        </div></div>
    </dialog>}
  </section>;
}
