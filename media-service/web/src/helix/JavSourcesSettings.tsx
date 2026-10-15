import {useEffect,useRef,useState} from 'react';
import {AdminApiError,helixAdminApi,type IntegrationState} from './api';
import {Button} from './chrome';
import {newOpaqueId} from './id';
import {javSourceLabel} from './jav-source-display';

const SOURCES=[
  {id:'javdb',label:'JavDB',endpoint:'https://javdb.com',scope:'常规番号、T38'},
  {id:'javmenu',label:'JavMenu',endpoint:'https://javmenu.com',scope:'常规、FC2、日期型及特殊系列'},
  {id:'fc2_official',label:'FC2 官方',endpoint:'https://adult.contents.fc2.com',scope:'FC2'},
  {id:'heydouga_official',label:'Heydouga 官方',endpoint:'https://www.heydouga.com',scope:'HEYDOUGA'},
  {id:'caribbeancom_official',label:'Caribbeancom 官方',endpoint:'https://www.caribbeancom.com',scope:'日期型'},
  {id:'avwiki',label:'AvWiki',endpoint:'https://av-wiki.net',scope:'数字前缀番号'},
  {id:'dl_getchu',label:'DL Getchu',endpoint:'https://dl.getchu.com',scope:'GETCHU'},
  {id:'gyutto',label:'Gyutto',endpoint:'https://gyutto.com',scope:'GYUTTO'},
] as const;
export default function JavSourcesSettings({onUnauthorized}:{onUnauthorized:()=>void}) {
  const [site,setSite]=useState<string>('javdb'),[states,setStates]=useState<Record<string,IntegrationState>>({});
  const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [mode,setMode]=useState<'direct'|'http_proxy'>('direct'),[proxy,setProxy]=useState('');
  const generation=useRef(0),selected=SOURCES.find(source=>source.id===site)!,current=states[site];
  useEffect(()=>{
    let active=true;
    void Promise.all(SOURCES.map(async source=>[source.id,await helixAdminApi.getIntegration('jav-'+source.id)] as const))
      .then(values=>{if(active)setStates(Object.fromEntries(values));})
      .catch(cause=>{if(active){if(cause instanceof AdminApiError&&cause.status===401)onUnauthorized();else setError('资料来源状态读取失败，请刷新页面重试。');}})
      .finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;generation.current++;};
  },[onUnauthorized]);
  useEffect(()=>{generation.current++;const route=current?.settings?.networkRoute;setMode(route?.mode||'direct');setProxy(route?.proxyEndpoint||'');},[site,current]);
  const routeValid=mode==='direct'||(()=>{try{const value=new URL(proxy.trim());return ['http:','https:'].includes(value.protocol)&&!value.username&&!value.password&&!value.search&&!value.hash&&value.pathname==='/';}catch{return false;}})();
  const change=async(disconnect=false)=>{
    if(!current||saving||(!disconnect&&!routeValid))return;
    const revision=current.configRevision,kind='jav-'+site,token=++generation.current;setSaving(true);setError('');setNotice('');
    try{
      if(disconnect)await helixAdminApi.disconnectIntegration(kind,{kind,expectedConfigRevision:revision,idempotencyKey:`${kind}:disconnect:${revision}:${newOpaqueId()}`});
      else {
        const proof=await helixAdminApi.testIntegration(kind,{kind,endpoint:current.endpoint||selected.endpoint,credential:{kind:'anonymous'},
          settings:{networkRoute:{mode,proxyEndpoint:mode==='direct'?null:proxy.trim()}},idempotencyKey:`${kind}:test:${newOpaqueId()}`});
        await helixAdminApi.configureIntegration(kind,{kind,expectedConfigRevision:revision,connectionProofId:proof.connectionProofId,idempotencyKey:`${kind}:configure:${proof.connectionProofId}`});
      }
      const next=await helixAdminApi.getIntegration(kind);
      if(token===generation.current){setStates(value=>({...value,[site]:next}));setNotice(disconnect?'已断开该来源。':'来源验证通过，已保存连接。');}
    }catch(cause){if(token===generation.current){
      if(cause instanceof AdminApiError&&cause.status===401){onUnauthorized();return;}
      setError(disconnect?'断开未完成，请重试。':'来源未通过影片和封面验证，请核对网络方式后重试。');
    }}finally{setSaving(false);}
  };
  return <section className="settings-card" aria-labelledby="jav-sources-title">
    <header className="settings-card-head"><h2 id="jav-sources-title">JAV 资料来源</h2></header>
    <div className="settings-card-body"><form className="source-form" onSubmit={event=>{event.preventDefault();void change();}}>
      <div className="source-form-grid"><label><span>资料站</span><select value={site} disabled={loading||saving} onChange={event=>{setSite(event.target.value);setError('');setNotice('');}}>
        {SOURCES.map(source=><option key={source.id} value={source.id}>{javSourceLabel(source.id)} · {loading?'正在读取…':states[source.id]?.configured?'已连接':'未连接'}</option>)}</select></label>
      <dl><dt>适用番号</dt><dd>{selected.scope}</dd></dl>
      <label><span>网络方式</span><select value={mode} disabled={loading||saving} onChange={event=>setMode(event.target.value as typeof mode)}><option value="direct">直接连接</option><option value="http_proxy">HTTP 代理</option></select></label>
      {mode==='http_proxy'&&<label><span>代理地址</span><input type="url" value={proxy} disabled={saving} onChange={event=>setProxy(event.target.value)} required aria-label="代理地址" aria-invalid={!routeValid} aria-describedby={!routeValid?'jav-proxy-error':undefined}/>
        {!routeValid&&<small id="jav-proxy-error">请输入不含账号密码的 HTTP 或 HTTPS 代理地址。</small>}</label>}</div>
      {error&&<p role="alert" className="form-error">{error}</p>}{notice&&<p role="status" className="form-notice">{notice}</p>}
      <div className="settings-card-actions"><Button variant="primary" disabled={loading||saving||!current||!routeValid}>{saving?'正在验证…':current?.configured?'测试并保存':'测试并连接'}</Button>
      {current?.configured&&<Button variant="danger" type="button" disabled={saving} onClick={()=>void change(true)}>断开该来源</Button>}</div>
    </form></div>
  </section>;
}
