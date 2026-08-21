import { useEffect, useState } from 'react';
import { helixAdminApi } from './api';

type Props = { targetType:'subject'|'shelf_entry'; targetId:string; label:string; initialRating?:number|null; initialSource?:string|null; initialRevision?:number|null };

export default function RatingControl({targetType,targetId,label,initialRating,initialSource,initialRevision}:Props){
  const hasProjectionRating=initialRating!==undefined;
  const [rating,setRating]=useState<number|null>(initialRating??null),[source,setSource]=useState<string|null>(initialSource??null),[revision,setRevision]=useState(initialRevision??0);
  const [pending,setPending]=useState(false),[error,setError]=useState('');
  async function load(){const result=await helixAdminApi.listPerceptionRecords({targetType,targetId,limit:1});const current=result.currentRating;
    setRating(current?.rating??null);setSource(current?.sourceKind??null);setRevision(current?.expectedRevision??0);}
  useEffect(()=>{if(!hasProjectionRating)void load().catch((cause)=>setError(cause instanceof Error?cause.message:'评分读取失败。'));},[targetType,targetId,hasProjectionRating]);
  async function choose(value:number|null){setPending(true);setError('');try{const accepted=await helixAdminApi.rate(targetType,targetId,revision,value);setRating(value);setSource('pending');
      const deadline=Date.now()+30_000;while(Date.now()<deadline){const result=await helixAdminApi.listPerceptionRecords({targetType,targetId,limit:1});const current=result.currentRating;
        if(current?.state==='ready'&&current.expectedRevision>=accepted.expectedResultRevision){setRating(current.rating);setSource(current.sourceKind);setRevision(current.expectedRevision);return;}
        await new Promise((resolve)=>window.setTimeout(resolve,300));}throw new Error('评分已进入后台处理，但30秒内尚未形成可读取结果。');
    }catch(cause){setError(cause instanceof Error?cause.message:'评分提交失败。');await load().catch(()=>undefined);}finally{setPending(false);}}
  return <div className="rating-control" aria-label={`${label}评分`}>
    <div className="rating-stars" role="group" aria-label="1至5星">
      {[1,2,3,4,5].map((value)=><button key={value} type="button" className={rating!==null&&value<=rating?'selected':''}
        aria-label={`${value}星`} aria-pressed={rating===value} disabled={pending} onClick={()=>void choose(value)}>★</button>)}
    </div>
    {source==='shelfdeck_direct'&&<button type="button" className="rating-clear" disabled={pending} onClick={()=>void choose(null)}>清除我的评分</button>}
    <small>{rating===null?'暂无评分':`${rating} 星 · ${source==='douban'?'豆瓣':source==='shelfdeck_direct'?'我的评分':source==='pending'?'提交处理中':'已解析'}`}</small>
    {error&&<span className="rating-error" role="alert">{error}</span>}
  </div>;
}
