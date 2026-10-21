import {useState} from 'react';
import {helixAdminApi} from './api';
import {Button} from './chrome';
import {isUnauthorized,useSession} from './session';

type Page=Awaited<ReturnType<typeof helixAdminApi.listPreparationFailures>>;
export default function PreparationFailures({onChanged}:{onChanged:()=>void}){
  const {expire}=useSession();
  const [open,setOpen]=useState(false),[page,setPage]=useState<Page|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  async function load(cursor?:string){setBusy(true);setError('');
    try{const value=await helixAdminApi.listPreparationFailures(cursor);setPage(old=>({...value,items:cursor?[...(old?.items||[]),...value.items]:value.items}));}
    catch(cause){if(isUnauthorized(cause))expire();else setError('暂时无法读取准备异常。');}finally{setBusy(false);}}
  async function retry(workId:string){setBusy(true);setError('');setNotice('');
    try{const result=await helixAdminApi.retryPreparation(workId);
      if(result.kind==='deferred'){setNotice('当前资源忙，请稍后重试。');return;}
      setNotice('已提交重试');await load();onChanged();
    }catch(cause){if(isUnauthorized(cause))expire();else setError('未能提交重试，请刷新列表后再试。');}finally{setBusy(false);}}
  return <section className="source-flow-panel" aria-label="准备异常">
    <Button type="button" aria-expanded={open} onClick={()=>{setOpen(!open);if(!open)void load();}}>准备异常</Button>
    {open&&<div>
      <Button type="button" disabled={busy} onClick={()=>void load()}>刷新异常列表</Button>
      {busy&&<p role="status">正在读取…</p>}{error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
      {!busy&&!error&&page?.items.length===0&&!page.nextCursor&&<p>没有准备异常</p>}
      {page?.items.map(item=><div className="source-stop-confirm" key={item.workId}><span><strong>{item.title}</strong> · {item.phase}失败</span>
        <Button type="button" disabled={busy} onClick={()=>void retry(item.workId)}>重试准备</Button></div>)}
      {page?.nextCursor&&<Button type="button" disabled={busy} onClick={()=>void load(page.nextCursor!)}>继续查看</Button>}
    </div>}
  </section>;
}
