import {useEffect,useState} from 'react';
import {helixAdminApi,type IntegrationState} from './api';
import {Button} from './chrome';
import {newOpaqueId} from './id';
import {isUnauthorized} from './session';

export default function NetworkSettings({onUnauthorized}:{onUnauthorized:()=>void}) {
  const [current,setCurrent]=useState<IntegrationState|null>(null),[proxy,setProxy]=useState('');
  const [mode,setMode]=useState<'direct'|'http_proxy'>('direct'),[busy,setBusy]=useState(false);
  const [error,setError]=useState(''),[notice,setNotice]=useState('');
  const [readState,setReadState]=useState<'loading'|'ready'|'failed'>('loading');
  async function load() {
    setBusy(true);setError('');setNotice('');setCurrent(null);setReadState('loading');
    try {
      const [network,tmdb]=await Promise.all([helixAdminApi.getIntegration('network'),helixAdminApi.getIntegration('tmdb')]);
      // Existing TMDB settings only prefill an explicit draft; GET never writes.
      const value=network.configured?network.settings?.proxyServer:tmdb.settings?.proxyServer;
      setCurrent(network);setProxy(value||'');setMode(value?'http_proxy':'direct');setReadState('ready');
    } catch(cause) {setReadState('failed');if(isUnauthorized(cause))onUnauthorized();else setError('网络设置读取失败。');}
    finally {setBusy(false);}
  }
  useEffect(()=>{void load();},[onUnauthorized]);
  const valid=mode==='direct'||(()=>{try{const u=new URL(proxy.trim());return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password&&!u.search&&!u.hash&&u.pathname==='/';}catch{return false;}})();
  async function save() {
    if(!current||!valid||busy)return;
    setBusy(true);setError('');setNotice('');
    try {
      const next=await helixAdminApi.configureIntegration('network',{kind:'network',expectedConfigRevision:current.configRevision,
        idempotencyKey:`network:${newOpaqueId()}`,settings:{proxyServer:mode==='direct'?'':proxy.trim()}});
      setCurrent(next);setNotice('全站网络设置已保存。');
    }catch(cause){if(isUnauthorized(cause))onUnauthorized();else setError('网络设置保存失败，请重试；配置有变化时请重新读取。');}
    finally{setBusy(false);}
  }
  return <section className="settings-card" aria-labelledby="network-title">
    <header className="settings-card-head"><h2 id="network-title">网络代理</h2><span className="integration-state" data-state={readState==='failed'?'failed':readState==='ready'&&current?.configured?'active':'unknown'}>{readState==='loading'?'正在读取…':readState==='failed'?'读取失败':current?.configured?(current.settings?.proxyServer?'全站使用代理':'全站直连'):'未配置'}</span></header>
    <div className="settings-card-body"><form className="source-form" onSubmit={e=>{e.preventDefault();void save();}}>
      <div className="source-form-grid">
        <label><span>网络方式</span><select value={mode} disabled={busy||!current} onChange={e=>{setMode(e.target.value as typeof mode);setNotice('');setError('');}}><option value="direct">直接连接</option><option value="http_proxy">HTTP 代理</option></select></label>
        {mode==='http_proxy'&&<label><span>代理服务器</span><input type="url" aria-label="代理服务器" value={proxy} onChange={e=>{setProxy(e.target.value);setNotice('');setError('');}} disabled={busy||!current} required aria-invalid={!valid} aria-describedby={!valid?'network-proxy-error':undefined}/>
          {!valid&&<small id="network-proxy-error" className="form-error">请输入不含账号密码和路径的 HTTP 或 HTTPS 地址。</small>}</label>}
      </div>
      {error&&<p className="form-error" role="alert">{error}</p>}{notice&&<p className="form-notice" role="status">{notice}</p>}
      <div className="settings-card-actions"><Button variant="primary" disabled={busy||!current||!valid}>{busy?'正在处理…':'保存网络设置'}</Button><Button type="button" disabled={busy} onClick={()=>void load()}>重新读取</Button></div>
    </form></div>
  </section>;
}
