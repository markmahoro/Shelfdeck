import {useEffect,useRef,useState} from 'react';
import {helixAdminApi} from './api';
import {Button} from './chrome';

type Props={targetType:'subject'|'shelf_entry';targetId:string;label:string};
export default function WatchedControl({targetType,targetId,label}:Props){
  const [value,setValue]=useState<boolean|null>(null),[source,setSource]=useState<string|null>(null),[revision,setRevision]=useState(0);
  const [loading,setLoading]=useState(true),[pending,setPending]=useState(false),[error,setError]=useState('');
  const generation=useRef(0);
  function apply(current:NonNullable<Awaited<ReturnType<typeof helixAdminApi.listPerceptionRecords>>['currentWatched']>){setValue(current.watchedState);setSource(current.sourceKind);setRevision(current.expectedRevision);}
  useEffect(()=>{const token=++generation.current;setLoading(true);setPending(false);setError('');setValue(null);setSource(null);setRevision(0);
    void (async()=>{const deadline=Date.now()+30_000;while(token===generation.current){const result=await helixAdminApi.listPerceptionRecords({targetType,targetId,limit:1});
      if(token!==generation.current)return;if(result.currentWatched?.state==='ready'){apply(result.currentWatched);return;}
      if(result.currentWatched?.state==='failed'||result.currentWatched?.state==='cancelled')
        throw new Error(result.currentWatched.state==='failed'?'已看状态匹配失败。':'已看状态匹配已取消。');
      if(Date.now()>=deadline)throw new Error('暂未读取到已看状态，请重新打开影片。');
      await new Promise(resolve=>window.setTimeout(resolve,300));
    }})()
      .catch(cause=>{if(token===generation.current)setError(cause instanceof Error?cause.message:'已看状态读取失败。');})
      .finally(()=>{if(token===generation.current)setLoading(false);});return()=>{generation.current++;};
  },[targetType,targetId]);
  async function choose(watched:boolean|null){const token=generation.current;setPending(true);setError('');try{
    const accepted=await helixAdminApi.setWatched(targetType,targetId,revision,watched),deadline=Date.now()+30_000;
    while(token===generation.current&&Date.now()<deadline){const result=await helixAdminApi.listPerceptionRecords({targetType,targetId,limit:1});
      if(token!==generation.current)return;const current=result.currentWatched;
      if(current?.state==='ready'&&current.expectedRevision>=accepted.expectedResultRevision){apply(current);return;}
      if((current?.state==='failed'||current?.state==='cancelled')&&current.expectedRevision>=accepted.expectedResultRevision)
        throw new Error(current.state==='failed'?'已看状态匹配失败。':'已看状态匹配已取消。');
      await new Promise(resolve=>window.setTimeout(resolve,300));
    }
    if(token===generation.current)throw new Error('已提交，暂未读取到已看结果。');
  }catch(cause){if(token===generation.current){setError(cause instanceof Error?cause.message:'已看状态提交失败。');
    await helixAdminApi.listPerceptionRecords({targetType,targetId,limit:1}).then(result=>{if(token===generation.current&&result.currentWatched)apply(result.currentWatched);}).catch(()=>undefined);
  }}finally{if(token===generation.current)setPending(false);}}
  return <div className="rating-control" aria-label={`${label}已看状态`}>
    <small aria-live="polite">{pending?'提交处理中':loading?'读取中':value===null?'未标记':value?'已看':'未看'}</small>
    <div className="watched-actions" role="group" aria-label="已看标记">
      <Button type="button" disabled={loading||pending||!!error&&revision===0} aria-pressed={value===true} onClick={()=>void choose(true)}>已看</Button>
      <Button type="button" disabled={loading||pending||!!error&&revision===0} aria-pressed={value===false} onClick={()=>void choose(false)}>未看</Button>
      {source==='shelfdeck_direct'&&revision>0&&<Button type="button" variant="text" disabled={loading||pending} onClick={()=>void choose(null)}>清除我的标记</Button>}
    </div>
    {error&&<span className="rating-error" role="alert">{error}</span>}
  </div>;
}
