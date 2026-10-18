import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { helixAdminApi, type IntegrationState } from './api';
import { Button } from './chrome';
import { newOpaqueId } from './id';
import { isUnauthorized, useSession } from './session';

export default function StashBoxSettings() {
  const {expire}=useSession();
  const [state,setState]=useState<IntegrationState|null>(null),[endpoint,setEndpoint]=useState(''),[key,setKey]=useState('');
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const mounted=useRef(true);
  const load=useCallback(async()=>{
    setLoading(true);setError('');
    try {const value=await helixAdminApi.getIntegration('stashbox');if(mounted.current){setState(value);setEndpoint(value.endpoint||'');}}
    catch(cause){if(mounted.current){if(isUnauthorized(cause))expire();else setError('StashBox 配置读取失败，请重试。');}}
    finally{if(mounted.current)setLoading(false);}
  },[expire]);
  useEffect(()=>{mounted.current=true;void load();return()=>{mounted.current=false;};},[load]);
  async function connect(event:FormEvent) {
    event.preventDefault();if(!state)return;
    setBusy(true);setError('');setNotice('');
    try {
      const proof=await helixAdminApi.testIntegration('stashbox',{kind:'stashbox',endpoint:endpoint.trim(),
        credential:{kind:'api_key',value:key},idempotencyKey:newOpaqueId('stashbox-test-')});
      if(!mounted.current)return;
      const next=await helixAdminApi.configureIntegration('stashbox',{kind:'stashbox',expectedConfigRevision:state.configRevision,
        connectionProofId:proof.connectionProofId,idempotencyKey:`stashbox-configure:${proof.connectionProofId}`});
      if(mounted.current){setState(next);setKey('');setNotice('StashBox 已验证并启用。');}
    }catch(cause){if(mounted.current){if(isUnauthorized(cause))expire();else setError(cause instanceof Error?cause.message:'连接失败，请重试。');}}
    finally{if(mounted.current)setBusy(false);}
  }
  async function disconnect() {
    if(!state)return;setBusy(true);setError('');setNotice('');
    try{const next=await helixAdminApi.disconnectIntegration('stashbox',{kind:'stashbox',expectedConfigRevision:state.configRevision,idempotencyKey:newOpaqueId('stashbox-disconnect-')});
      if(mounted.current){setState(next);setNotice('StashBox 已停用。');}}
    catch(cause){if(mounted.current){if(isUnauthorized(cause))expire();else setError(cause instanceof Error?cause.message:'停用失败。');}}
    finally{if(mounted.current)setBusy(false);}
  }
  return <section className="settings-card" aria-labelledby="stashbox-title">
    <header className="settings-card-head"><h2 id="stashbox-title">US Adult 演员图片来源</h2><span>{loading?'正在读取…':!state?'状态未知':state.configured?'StashBox 已启用':'StashBox 未启用'}</span></header>
    <div className="settings-card-body"><p>Wikimedia Commons 可直接搜索。连接 StashBox 后，可按姓名搜索其中的演员图片；搜索遵守全站网络设置。</p>
      <form onSubmit={event=>void connect(event)}><div className="source-form-grid">
        <label><span>StashBox GraphQL 地址</span><input type="url" value={endpoint} disabled={loading||busy} required placeholder="https://example.com/graphql" onChange={event=>setEndpoint(event.target.value)}/></label>
        <label><span>StashBox API Key</span><input type="password" autoComplete="off" value={key} disabled={loading||busy} required onChange={event=>setKey(event.target.value)}/></label>
      </div><div className="settings-card-actions">
        <Button variant="primary" type="submit" disabled={loading||busy||!state||!endpoint.trim()||!key.trim()}>{busy?'正在处理…':'测试并启用 StashBox'}</Button>
        {state?.configured&&<Button type="button" disabled={loading||busy} onClick={()=>void disconnect()}>停用 StashBox</Button>}
        <Button type="button" disabled={loading||busy} onClick={()=>void load()}>重新读取</Button>
      </div></form>
      {error&&<p role="alert" className="form-error">{error}</p>}{notice&&<p role="status" className="form-notice">{notice}</p>}
    </div>
  </section>;
}
