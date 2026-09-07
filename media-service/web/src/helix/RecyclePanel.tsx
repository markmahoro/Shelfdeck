import {useState} from 'react';
import {helixAdminApi,type RecycleEntry,type RecyclePreview} from './api';
import {Button} from './chrome';
import {isUnauthorized,useSession} from './session';

const labels:Record<string,string>={pending:'等待移入',moving:'正在移入',archived:'已移入回收站',restoring:'正在恢复',restored:'已恢复',purging:'正在到期清理',purged:'已到期清理'};
export default function RecyclePanel({shelfEntryId}:{shelfEntryId?:string}){
  const [opened,setOpened]=useState(false),[items,setItems]=useState<RecycleEntry[]>([]),[sources,setSources]=useState<RecyclePreview[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const {expire}=useSession();
  async function load(){const [rows,previews]=await Promise.all([helixAdminApi.listRecycle(),shelfEntryId?helixAdminApi.previewRecycle(shelfEntryId):null]);setItems(rows.items.filter(row=>!shelfEntryId||row.shelfEntryId===shelfEntryId));setSources(previews?.items||[]);}
  async function run(action:()=>Promise<unknown>){if(busy)return;setBusy(true);setError('');try{await action();await load();}catch(cause){if(isUnauthorized(cause))expire();else setError(cause instanceof Error?cause.message:'回收站操作失败。');}finally{setBusy(false);}}
  return <details onToggle={event=>{const next=event.currentTarget.open;setOpened(next);if(next)void run(async()=>{});}}>
    <summary>{shelfEntryId?'旧目录与回收站':'回收站'}</summary>
    {opened&&<div><p>移入后保留30天，到期自动清理。到期前可恢复到原位置。</p>
      <Button type="button" disabled={busy} onClick={()=>void run(async()=>{})}>刷新回收站</Button>
      {error&&<p role="alert" className="form-error">{error}</p>}
      {sources.map(source=><section key={source.sourceLocation}><p>{source.sourceLocation}</p>{source.errorCode?<p>暂不可移入：{source.errorCode}</p>:<>
        <p>{source.manifest?.entries.filter(item=>item.kind==='file').length||0} 个文件 · {Math.ceil((source.manifest?.totalBytes||0)/1024)} KB</p>
        <ul>{source.manifest?.entries.map(item=><li key={item.relativePath}>{item.relativePath}</li>)}</ul>
        <Button type="button" disabled={busy||items.some(item=>item.sourceLocation===source.sourceLocation&&!['restored','purged'].includes(item.state))} onClick={()=>void run(()=>helixAdminApi.archiveRecycle(source))}>确认以上范围，移入回收站</Button>
      </>}</section>)}
      {items.map(item=><section key={item.id}><p>{item.sourceLocation}</p><p>{labels[item.state]||item.state}{item.expiresAtMs&&item.state==='archived'?` · ${new Date(item.expiresAtMs).toLocaleDateString()} 到期`:''}</p>
        {item.errorCode&&<p role="status">等待处理：{item.errorCode}</p>}
        {item.state==='archived'&&<Button type="button" disabled={busy} onClick={()=>void run(()=>helixAdminApi.restoreRecycle(item.id))}>恢复到原位置</Button>}
      </section>)}
      {!busy&&!sources.length&&!items.length&&<p>没有可处理的旧目录或回收记录。</p>}
    </div>}
  </details>;
}
