import {useState} from 'react';
import {Dialog} from '../components/ui';
import {Button} from './chrome';
import {helixAdminApi,type FormationSubject} from './api';

type ImageInput={artifactKind:'poster'|'fanart';bytesBase64:string};
async function readImage(file:File,kind:ImageInput['artifactKind']):Promise<ImageInput>{
  if(!file.size||file.size>8*1024*1024)throw new Error('请选择不超过 8 MB 的图片。');
  if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('请选择 JPEG、PNG 或 WebP 图片。');
  const url=URL.createObjectURL(file);
  try{
    const image=new Image();image.src=url;await image.decode();
    if(kind==='poster'?image.height<=image.width:image.width<=image.height)throw new Error(kind==='poster'?'剧集海报需要竖版图片。':'剧集背景需要横版图片。');
  }finally{URL.revokeObjectURL(url);}
  const bytesBase64=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('图片读取失败。'));reader.readAsDataURL(file);});
  return {artifactKind:kind,bytesBase64};
}
export default function SeriesPresentationRetryDialog({item,entry,canSupplyImages=true,onClose,onComplete}:{item?:FormationSubject;entry?:{shelfEntryId:string;displayIdentity:string};canSupplyImages?:boolean;onClose:()=>void;onComplete:()=>Promise<void>}){
  const [files,setFiles]=useState<Partial<Record<ImageInput['artifactKind'],File>>>({}),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function submit(){setBusy(true);setError('');try{
    const images:ImageInput[]=[];for(const kind of ['poster','fanart'] as const)if(files[kind])images.push(await readImage(files[kind]!,kind));
    if(item)await helixAdminApi.retryAcceptance(item,images);else if(entry)await helixAdminApi.checkCare(entry.shelfEntryId,images);else throw new Error('重试目标已失效。');await onComplete();onClose();
  }catch(cause){setError(cause instanceof Error?cause.message:'重试任务未能提交。');}finally{setBusy(false);}}
  return <Dialog open title="重试任务" onClose={()=>{if(!busy)onClose();}} actions={<><Button type="button" variant="text" disabled={busy} onClick={onClose}>返回</Button><Button type="button" disabled={busy} onClick={()=>void submit()}>{busy?'正在提交…':'重试任务'}</Button></>}>
    <div className="stack"><p>{item?.displayIdentity||entry?.displayIdentity}</p>
      {canSupplyImages&&<>
      <label>剧集海报（可选，竖版，8 MB 以内）<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={event=>{setError('');setFiles(value=>({...value,poster:event.target.files?.[0]}));}}/></label>
      <label>剧集背景（可选，横版，8 MB 以内）<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={event=>{setError('');setFiles(value=>({...value,fanart:event.target.files?.[0]}));}}/></label>
      </>}
      {error&&<p role="alert">{error}</p>}
    </div>
  </Dialog>;
}
