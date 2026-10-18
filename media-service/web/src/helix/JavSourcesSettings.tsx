import {useEffect,useRef,useState} from 'react';
import {AdminApiError,helixAdminApi,type IntegrationState} from './api';
import {Button} from './chrome';
import {newOpaqueId} from './id';
import {javSourceLabel} from './jav-source-display';

const SOURCES=[
  {id:'javdb',endpoint:'https://javdb.com',scope:'常规番号、T38'},
  {id:'javmenu',endpoint:'https://javmenu.com',scope:'常规、FC2、日期型及特殊系列'},
  {id:'fc2_official',endpoint:'https://adult.contents.fc2.com',scope:'FC2'},
  {id:'heydouga_official',endpoint:'https://www.heydouga.com',scope:'HEYDOUGA'},
  {id:'caribbeancom_official',endpoint:'https://www.caribbeancom.com',scope:'日期型'},
  {id:'avwiki',endpoint:'https://av-wiki.net',scope:'数字前缀番号'},
  {id:'dl_getchu',endpoint:'https://dl.getchu.com',scope:'GETCHU'},
  {id:'gyutto',endpoint:'https://gyutto.com',scope:'GYUTTO'},
] as const;
export function javConnectionError(cause:unknown) {
  if(!(cause instanceof AdminApiError))return '连接未完成，请重试';
  const code=String(cause.details.reasonCode||cause.code);
  const reasons:Record<string,string>={
    JAV_SOURCE_TIMEOUT:'连接超时，请检查全站代理',JAV_SOURCE_UNAVAILABLE:'无法连接，请检查全站代理或稍后重试',
    JAV_SOURCE_ACCESS_DENIED:'站点拒绝访问',JAV_SOURCE_RESPONSE_INVALID:'站点返回内容不符合预期',
    JAV_SOURCE_RESPONSE_TOO_LARGE:'站点返回内容超过限制',JAV_SOURCE_REDIRECT_DENIED:'站点跳转超出允许范围',
    JAV_SOURCE_URL_DENIED:'页面或封面地址超出允许范围',JAV_SOURCE_CHARSET_INVALID:'页面编码无法解析',
    challenge_required:'站点要求人机验证',not_found:'未找到连接测试影片',identity_mismatch:'测试影片番号不匹配',
    title_missing:'测试影片缺少标题',cover_missing:'测试影片缺少封面',cover_undecodable:'封面无法解码',
    PLATFORM_INTEGRATION_CONNECTION_PROOF_INVALID:'网络设置已变化，请重新测试',
    PLATFORM_INTEGRATION_CAS_CONFLICT:'来源配置已变化，请重新读取',
  };
  const status=typeof cause.details.status==='number'?`（HTTP ${cause.details.status}）`:'';
  return `${cause.details.stage==='cover'?'封面：':''}${reasons[code]||'验证未完成，请重试'}${status}`;
}
export default function JavSourcesSettings({onUnauthorized}:{onUnauthorized:()=>void}) {
  const [states,setStates]=useState<Record<string,IntegrationState>>({}),[results,setResults]=useState<Record<string,string>>({});
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const generation=useRef(0),mounted=useRef(true);
  async function load() {
    setLoading(true);setError('');setResults({});
    try {const values=await Promise.all(SOURCES.map(async s=>[s.id,await helixAdminApi.getIntegration('jav-'+s.id)] as const));
      if(mounted.current)setStates(Object.fromEntries(values));
    }catch(cause){if(mounted.current){if(cause instanceof AdminApiError&&cause.status===401)onUnauthorized();else setError('资料来源读取失败，请重新读取。');}}
    finally{if(mounted.current)setLoading(false);}
  }
  useEffect(()=>{mounted.current=true;void load();return()=>{mounted.current=false;generation.current++;};},[onUnauthorized]);
  async function connectAll() {
    if(busy||loading||SOURCES.some(s=>!states[s.id]))return;
    setBusy(true);setError('');setResults({});const token=++generation.current;
    let cursor=0,unauthorized=false;
    async function worker() {
      while(cursor<SOURCES.length&&mounted.current&&token===generation.current&&!unauthorized) {
        const source=SOURCES[cursor++],kind='jav-'+source.id,current=states[source.id];
        setResults(v=>({...v,[source.id]:'正在验证…'}));
        try {
          const proof=await helixAdminApi.testIntegration(kind,{kind,endpoint:current.endpoint||source.endpoint,
            credential:{kind:'anonymous'},idempotencyKey:`${kind}:test:${newOpaqueId()}`});
          if(!mounted.current||token!==generation.current||unauthorized)break;
          const next=await helixAdminApi.configureIntegration(kind,{kind,expectedConfigRevision:current.configRevision,
            connectionProofId:proof.connectionProofId,idempotencyKey:`${kind}:configure:${proof.connectionProofId}`});
          if(mounted.current&&token===generation.current){setStates(v=>({...v,[source.id]:next}));setResults(v=>({...v,[source.id]:'已验证并启用'}));}
        }catch(cause){if(mounted.current&&token===generation.current){if(cause instanceof AdminApiError&&cause.status===401){unauthorized=true;onUnauthorized();}
          else setResults(v=>({...v,[source.id]:javConnectionError(cause)}));}}
      }
    }
    try{await Promise.all([worker(),worker()]);}finally{if(mounted.current)setBusy(false);}
  }
  async function disconnect(site:string) {
    const current=states[site];if(!current||busy)return;setBusy(true);
    try {const next=await helixAdminApi.disconnectIntegration('jav-'+site,{kind:'jav-'+site,expectedConfigRevision:current.configRevision,
      idempotencyKey:`jav-${site}:disconnect:${newOpaqueId()}`});if(mounted.current){setStates(v=>({...v,[site]:next}));setResults(v=>({...v,[site]:'已停用'}));}}
    catch(cause){if(cause instanceof AdminApiError&&cause.status===401)onUnauthorized();else setResults(v=>({...v,[site]:'停用失败，请重试'}));}
    finally{if(mounted.current)setBusy(false);}
  }
  return <section className="settings-card" aria-labelledby="jav-sources-title">
    <header className="settings-card-head"><h2 id="jav-sources-title">JAV 资料来源</h2><span>{SOURCES.filter(s=>states[s.id]?.configured).length} / {SOURCES.length} 已启用</span></header>
    <div className="settings-card-body">
      <div className="settings-card-actions"><Button variant="primary" disabled={loading||busy||SOURCES.some(s=>!states[s.id])} onClick={()=>void connectAll()}>{busy?'正在处理…':'一键测试并启用'}</Button><Button disabled={loading||busy} onClick={()=>void load()}>重新读取</Button></div>
      {error&&<p role="alert">{error}</p>}
      <ul className="jav-source-list" aria-label="JAV 资料站">
        {SOURCES.map(source=><li key={source.id}>
          <div><strong>{javSourceLabel(source.id)}</strong><small>{source.scope}</small></div>
          <span role="status" className="ui-state" data-state={results[source.id]
            ?results[source.id]==='正在验证…'?'running':results[source.id]==='已验证并启用'?'completed':results[source.id]==='已停用'?'unknown':'failed'
            :states[source.id]?.configured?'completed':'unknown'}>{results[source.id]||(loading?'正在读取…':states[source.id]?.configured?'已启用':'未启用')}</span>
          {states[source.id]?.configured&&<Button disabled={busy||loading} aria-label={`停用 ${javSourceLabel(source.id)}`} onClick={()=>void disconnect(source.id)}>停用</Button>}
        </li>)}
      </ul>
    </div>
  </section>;
}
