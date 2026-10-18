import {useEffect,useRef,useState} from 'react';
import {helixAdminApi,type IntegrationState} from './api';
import {Button} from './chrome';
import {newOpaqueId} from './id';
import {isUnauthorized} from './session';

export default function NetworkSettings({onUnauthorized}:{onUnauthorized:()=>void}) {
  const [current,setCurrent]=useState<IntegrationState|null>(null),[proxy,setProxy]=useState('');
  const [mode,setMode]=useState<'direct'|'http_proxy'>('direct'),[busy,setBusy]=useState(false);
  const [error,setError]=useState(''),[notice,setNotice]=useState('');
  const [readState,setReadState]=useState<'loading'|'ready'|'failed'>('loading');
  const generation=useRef(0);
  async function load() {
    const token=++generation.current;
    setBusy(true);setError('');setNotice('');setCurrent(null);setReadState('loading');
    try {
      const network=await helixAdminApi.getIntegration('network');
      if(token!==generation.current)return;
      const value=network.settings?.proxyServer||'';
      setCurrent(network);setProxy(value);setMode(value?'http_proxy':'direct');setReadState('ready');setBusy(false);
      // The old value is an optional draft. It never gates global settings and
      // cannot replace an edit, a save, or a newer read that has already begun.
      if(!network.configured) {
        try {
          const tmdb=await helixAdminApi.getIntegration('tmdb');
          if(token!==generation.current)return;
          const draft=tmdb.settings?.proxyServer||'';
          setProxy(draft);setMode(draft?'http_proxy':'direct');
        }catch(cause){if(token===generation.current){if(isUnauthorized(cause))onUnauthorized();else setError('旧 TMDB 代理读取失败，可手动填写。');}}
      }
    } catch(cause) {if(token===generation.current){setReadState('failed');if(isUnauthorized(cause))onUnauthorized();else setError('网络设置读取失败。');}}
    finally {if(token===generation.current)setBusy(false);}
  }
  useEffect(()=>{void load();return()=>{generation.current++;};},[onUnauthorized]);
  const valid=mode==='direct'||(()=>{try{const u=new URL(proxy.trim());return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password&&!u.search&&!u.hash&&u.pathname==='/';}catch{return false;}})();
  async function save() {
    if(!current||!valid||busy)return;
    const token=++generation.current;setBusy(true);setError('');setNotice('');
    try {
      const next=await helixAdminApi.configureIntegration('network',{kind:'network',expectedConfigRevision:current.configRevision,
        idempotencyKey:`network:${newOpaqueId()}`,settings:{proxyServer:mode==='direct'?'':proxy.trim()}});
      if(token===generation.current){setCurrent(next);setNotice('全站网络设置已保存。');}
    }catch(cause){if(token===generation.current){if(isUnauthorized(cause))onUnauthorized();else setError('网络设置保存失败，请重试；配置有变化时请重新读取。');}}
    finally{if(token===generation.current)setBusy(false);}
  }
  return <section className="settings-card" aria-labelledby="network-title">
    <header className="settings-card-head"><h2 id="network-title">网络代理</h2><span className="integration-state" data-state={readState==='failed'?'failed':readState==='ready'&&current?.configured?'active':'unknown'}>{readState==='loading'?'正在读取…':readState==='failed'?'读取失败':current?.configured?(current.settings?.proxyServer?'全站使用代理':'全站直连'):'未配置'}</span></header>
    <div className="settings-card-body"><form className="source-form" onSubmit={e=>{e.preventDefault();void save();}}>
      <div className="source-form-grid">
        <label><span>网络方式</span><select value={mode} disabled={busy||!current} onChange={e=>{generation.current++;setMode(e.target.value as typeof mode);setNotice('');setError('');}}><option value="direct">直接连接</option><option value="http_proxy">HTTP 代理</option></select></label>
        {mode==='http_proxy'&&<label><span>代理服务器</span><input type="url" aria-label="代理服务器" value={proxy} onChange={e=>{generation.current++;setProxy(e.target.value);setNotice('');setError('');}} disabled={busy||!current} required aria-invalid={!valid} aria-describedby={!valid?'network-proxy-error':undefined}/>
          {!valid&&<small id="network-proxy-error" className="form-error">请输入不含账号密码和路径的 HTTP 或 HTTPS 地址。</small>}</label>}
      </div>
      {error&&<p className="form-error" role="alert">{error}</p>}{notice&&<p className="form-notice" role="status">{notice}</p>}
      <div className="settings-card-actions"><Button variant="primary" disabled={busy||!current||!valid}>{busy?'正在处理…':'保存网络设置'}</Button><Button type="button" disabled={busy} onClick={()=>void load()}>重新读取</Button></div>
    </form></div>
  </section>;
}
