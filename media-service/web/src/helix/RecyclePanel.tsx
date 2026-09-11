import {useState} from 'react';
import {AdminApiError,helixAdminApi,type RecycleEntry,type RecyclePreview} from './api';
import {Button} from './chrome';
import {isUnauthorized,useSession} from './session';
import {recycleErrorLabel} from './error-labels';

const labels:Record<string,string>={pending:'等待移入',moving:'正在移入',archived:'已移入回收站',restoring:'正在恢复',restored:'已恢复',purging:'正在到期清理',purged:'已到期清理'};
export default function RecyclePanel({shelfEntryId}:{shelfEntryId?:string}){
  const [opened,setOpened]=useState(false),[items,setItems]=useState<RecycleEntry[]>([]),[sources,setSources]=useState<RecyclePreview[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const {expire}=useSession();
  async function load(){const [rows,previews]=await Promise.all([helixAdminApi.listRecycle(),shelfEntryId?helixAdminApi.previewRecycle(shelfEntryId):null]);setItems(rows.items.filter(row=>!shelfEntryId||row.shelfEntryId===shelfEntryId));setSources(previews?.items||[]);}
  async function run(action:()=>Promise<unknown>){if(busy)return;setBusy(true);setError('');try{await action();await load();}catch(cause){if(isUnauthorized(cause))expire();else setError(recycleErrorLabel(cause instanceof AdminApiError?cause.code:''));}finally{setBusy(false);}}
  return <details className="recycle-panel ui-card" onToggle={event=>{const next=event.currentTarget.open;setOpened(next);if(next)void run(async()=>{});}}>
    <summary>{shelfEntryId?'旧目录与回收站':'回收记录'}</summary>
    {opened&&<div className="stack"><div className="section-toolbar"><p className="recycle-retention">保留期 30 天 · 到期清理</p><Button type="button" disabled={busy} onClick={()=>void run(async()=>{})}>刷新回收站</Button></div>
      {error&&<p role="alert" className="form-error">{error}</p>}
      {sources.map(source=><section className="ui-card" key={source.sourceLocation}><p>{source.sourceLocation}</p>{source.errorCode?<p>暂不可移入：{recycleErrorLabel(source.errorCode)}</p>:<>
        <p>{source.manifest?.entries.filter(item=>item.kind==='file').length||0} 个文件 · {Math.ceil((source.manifest?.totalBytes||0)/1024)} KB</p>
        <ul>{source.manifest?.entries.map(item=><li key={item.relativePath}>{item.relativePath}</li>)}</ul>
        <Button type="button" disabled={busy||items.some(item=>item.sourceLocation===source.sourceLocation&&!['restored','purged'].includes(item.state))} onClick={()=>void run(()=>helixAdminApi.archiveRecycle(source))}>确认以上范围，移入回收站</Button>
      </>}</section>)}
      {items.map(item=><section className="ui-card" key={item.id}><p>{item.sourceLocation}</p><p className="ui-state" data-state={item.state}>{labels[item.state]||'状态暂不可用'}{item.expiresAtMs&&item.state==='archived'?` · ${new Date(item.expiresAtMs).toLocaleDateString()} 到期`:''}</p>
        {item.errorCode&&<p role="status">{recycleErrorLabel(item.errorCode)}</p>}
        {item.state==='archived'&&<Button type="button" disabled={busy} onClick={()=>void run(()=>helixAdminApi.restoreRecycle(item.id))}>恢复到原位置</Button>}
      </section>)}
      {!busy&&!sources.length&&!items.length&&<p>暂无旧目录或回收记录</p>}
    </div>}
  </details>;
}
