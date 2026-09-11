import { useEffect, useState } from 'react';
import { helixAdminApi, type SourceCleanupCheck } from './api';
import { Button } from './chrome';
import { isUnauthorized, useSession } from './session';
import { recycleErrorLabel } from './error-labels';

const labels:Record<string,string>={absent:'目录不存在',archived:'已移入回收站',purged:'已到期清理',recycle_pending:'回收未完成',awaiting_confirmation:'剩余文件待确认',retained_in_use:'仍在使用 · 已保留',retained_after_restore:'已请求恢复 · 保留',blocked:'检查未完成'};

export default function SourceCleanupChecks({onInspect}:{onInspect:(id:string)=>void}) {
  const {expire}=useSession();
  const [items,setItems]=useState<SourceCleanupCheck[]>([]),[cursors,setCursors]=useState<(string|undefined)[]>([undefined]);
  const [page,setPage]=useState(0),[next,setNext]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function load(index:number,cursor?:string){
    setBusy(true);setError('');
    try{const result=await helixAdminApi.listRecycle(cursor);setItems(result.cleanupChecks||[]);setNext(result.cleanupNextCursor||null);setPage(index);}
    catch(cause){if(isUnauthorized(cause))expire();else setError('上架收尾记录读取失败，请重试。');}
    finally{setBusy(false);}
  }
  useEffect(()=>{void load(0);},[]);
  return <section className="cleanup-checks ui-card stack">
    <h3>上架后的旧目录收尾</h3>
    <Button type="button" disabled={busy} onClick={()=>void load(page,cursors[page])}>刷新收尾记录</Button>
    {error&&<p className="form-error" role="alert">{error}</p>}
    {items.map(item=><section className="ui-card" key={item.onDeckRunId}>
      <p className="ui-state" data-state={item.state}>{item.state==='completed'?'检查已结束':item.state==='attention'?'需要确认':'等待收尾'}</p>
      {item.checks.map((check,index)=><div key={check.sourceLocation||index}>
        {check.sourceLocation&&<p style={{overflowWrap:'anywhere'}}>{check.sourceLocation}</p>}
        <p>{check.state==='blocked'&&check.errorCode?recycleErrorLabel(check.errorCode):labels[check.state]||'状态暂不可用'}</p>
      </div>)}
      {item.state!=='completed'&&<Button type="button" onClick={()=>onInspect(item.shelfEntryId)}>检查这部影片的具体清单</Button>}
    </section>)}
    {!busy&&!error&&!items.length&&<p>暂无收尾记录</p>}
    {(page>0||next)&&<nav aria-label="上架收尾分页">
      <Button type="button" disabled={busy||page===0} onClick={()=>void load(page-1,cursors[page-1])}>上一页</Button>
      <span>第 {page+1} 页</span>
      <Button type="button" disabled={busy||!next} onClick={()=>{if(next){setCursors(current=>[...current.slice(0,page+1),next]);void load(page+1,next);}}}>下一页</Button>
    </nav>}
  </section>;
}
