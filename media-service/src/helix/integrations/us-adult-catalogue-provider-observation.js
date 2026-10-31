'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {canonicalDigest}=require('../contracts/canonical-json');
const {normalizeName,queryNames,compare}=require('../contracts/us-adult-name-query');
const {fetchJson,fetchBytes}=require('./h1-provider-adapters');

const QUERY='query ShelfDeckCataloguePerformers($term: String!, $limit: Int!) { searchPerformer(term: $term, limit: $limit) { id name aliases images { id url width height } } }';
const LIMIT=25;
const ENDPOINT='https://api.theporndb.net/graphql';
// Clash/TPDB dial recovery often exceeds the old 15s abort / 20s waitingBound.
// waitingBound must cover maxAttempts × requestTimeout for a single-term search.
const DEFAULT_WAITING_BOUND_MS=180_000;
const DEFAULT_REQUEST_TIMEOUT_MS=45_000;
const DEFAULT_MAX_ATTEMPTS=3;
const DEFAULT_RETRY_BACKOFF_MS=Object.freeze([2_000,5_000]);

function imageUrl(value){
  let url;
  try{url=new URL(value);}catch{return null;}
  if(url.protocol!=='https:'||url.username||url.password||url.hash||url.href.length>4096)return null;
  return url.href;
}

function providerFailure(error){
  const code=typeof error?.code==='string'&&error.code.startsWith('PEOPLE_CATALOGUE_PROVIDER_')
    ?error.code:'PEOPLE_CATALOGUE_PROVIDER_FAILED';
  return Object.freeze({
    kind:'failed',
    code,
    message:String(error?.message||'ThePornDB catalogue provider search failed.').slice(0,500),
  });
}

function imageFailure(message){
  return Object.freeze({
    kind:'failed',
    code:'PEOPLE_CATALOGUE_IMAGE_FAILED',
    message:String(message||'Provider image bytes are exhausted.').slice(0,500),
  });
}

function isRetryableProviderError(error){
  const code=typeof error?.code==='string'?error.code:'';
  if(code==='PEOPLE_CATALOGUE_PROVIDER_UNCONFIGURED')return false;
  if(code==='PEOPLE_CATALOGUE_PROVIDER_INVALID')return false;
  return true;
}

function createCatalogueProviderObservationPort(options){
  if(typeof options?.fetchImpl!=='function'||typeof options.readStashBoxConfiguration!=='function'||
    typeof options.withStashBoxCredential!=='function')
    throw new TypeError('Catalogue provider observation requires ThePornDB transport and credentials.');
  const cache=new Map(),urls=new Map(),bytes=new Map(),inflight=new Map();
  const now=typeof options.now==='function'?options.now:Date.now;
  const waitingBoundMs=Number.isSafeInteger(options.waitingBoundMs)&&options.waitingBoundMs>0
    ?options.waitingBoundMs:DEFAULT_WAITING_BOUND_MS;
  const requestTimeoutMs=Number.isSafeInteger(options.requestTimeoutMs)&&options.requestTimeoutMs>0
    ?options.requestTimeoutMs:DEFAULT_REQUEST_TIMEOUT_MS;
  const maxAttempts=Number.isSafeInteger(options.maxAttempts)&&options.maxAttempts>0
    ?options.maxAttempts:DEFAULT_MAX_ATTEMPTS;
  const retryBackoffMs=Array.isArray(options.retryBackoffMs)&&options.retryBackoffMs.length
    ?options.retryBackoffMs.map(value=>Number.isSafeInteger(value)&&value>=0?value:0)
    :DEFAULT_RETRY_BACKOFF_MS;
  const delay=typeof options.delay==='function'?options.delay
    :(ms)=>new Promise(resolve=>setTimeout(resolve,ms));
  const cacheRoot=typeof options.cacheRoot==='string'&&options.cacheRoot?path.resolve(options.cacheRoot):null;

  function cacheFile(key){
    return cacheRoot?path.join(cacheRoot,key+'.json'):null;
  }
  function readDurable(key){
    const file=cacheFile(key);
    if(!file)return null;
    let raw;
    try{raw=fs.readFileSync(file,'utf8');}catch(error){if(error.code==='ENOENT')return null;throw error;}
    let parsed;
    try{parsed=JSON.parse(raw);}catch{return null;}
    // Failures only — success observations keep live URL maps in-process.
    if(parsed?.kind==='failed'&&typeof parsed.code==='string')
      return Object.freeze({kind:'failed',code:parsed.code,message:String(parsed.message||'').slice(0,500)});
    return null;
  }
  function writeDurable(key,value){
    const file=cacheFile(key);
    if(!file||value?.kind!=='failed')return;
    fs.mkdirSync(cacheRoot,{recursive:true});
    const temporary=file+'.'+process.pid+'.tmp';
    fs.writeFileSync(temporary,JSON.stringify({kind:'failed',code:value.code,message:value.message}),
      {encoding:'utf8',mode:0o600});
    fs.renameSync(temporary,file);
  }
  function remember(key,value){
    cache.set(key,value);
    writeDurable(key,value);
  }
  function cached(key){
    if(cache.has(key))return cache.get(key);
    const durable=readDurable(key);
    if(durable){cache.set(key,durable);return durable;}
    return null;
  }

  function init(){
    return {redirect:'manual',signal:AbortSignal.timeout(requestTimeoutMs),headers:{'User-Agent':'ShelfDeck/1.0 (catalogue registration)','accept':'application/json'}};
  }
  async function waitBeforeRetry(attempt){
    const ms=retryBackoffMs[Math.min(attempt-1,retryBackoffMs.length-1)]||0;
    if(ms>0)await delay(ms);
  }
  async function withRetries(run){
    let lastError;
    for(let attempt=1;attempt<=maxAttempts;attempt+=1){
      try{return await run();}
      catch(error){
        lastError=error;
        if(!isRetryableProviderError(error)||attempt>=maxAttempts)throw error;
        await waitBeforeRetry(attempt);
      }
    }
    throw lastError;
  }
  function candidate(person){
    if(typeof person?.id!=='string'||!person.id||typeof person.name!=='string'||!person.name)return null;
    const images=[];
    for(const image of person.images||[]){
      const href=imageUrl(image?.url);
      if(typeof image?.id!=='string'||!image.id||!href||!Number.isSafeInteger(image.width)||image.width<1||
        !Number.isSafeInteger(image.height)||image.height<1)continue;
      const urlDigest=canonicalDigest(href);
      urls.set(urlDigest,href);
      images.push({imageId:image.id,urlDigest,width:image.width,height:image.height});
    }
    images.sort((left,right)=>compare(left.imageId,right.imageId));
    const aliases=[...new Set((person.aliases||[]).filter(alias=>typeof alias==='string'&&alias))].sort(compare);
    return {providerKey:person.id,canonicalName:person.name,aliases,images:images.slice(0,8)};
  }
  function observationFor(names,rowsByTerm){
    const queries=names.map(term=>{
      const rows=rowsByTerm.get(term)||[];
      const people=rows.map(candidate).filter(Boolean);
      const saturated=rows.length>=LIMIT;
      if(saturated&&people.length<LIMIT)
        throw Object.assign(new Error('ThePornDB performer page was not a complete projection.'),{code:'PEOPLE_CATALOGUE_PROVIDER_INVALID'});
      const listed=people.slice(0,LIMIT);
      const limit=saturated?LIMIT:Math.max(listed.length+1,1);
      return {term,limit,completion:saturated?'saturated':'complete',responseDigest:canonicalDigest(listed),candidates:listed};
    });
    const body={schema:'people.us-adult-provider-search-observation@1',provider:'theporndb',queries};
    return {...body,observationDigest:canonicalDigest(body)};
  }
  function searchTerms(name,aliases){
    const names=queryNames(name,aliases||[]);
    const display=new Map();
    for(const value of [name,...(aliases||[])]){
      const term=normalizeName(value);
      if(!display.has(term))display.set(term,value.trim());
    }
    return names.map(term=>({term,display:display.get(term)||term}));
  }
  async function fetchTerm(configuration,display){
    const result=await options.withStashBoxCredential(configuration.configRevision,async credential=>{
      const request=init();
      request.method='POST';
      request.headers={...request.headers,'Content-Type':'application/json',ApiKey:credential.toString('utf8')};
      request.body=JSON.stringify({query:QUERY,variables:{term:display,limit:LIMIT}});
      return fetchJson(options.fetchImpl,configuration.endpoint,request,512*1024);
    });
    const rows=result?.data?.searchPerformer;
    if(result?.errors?.length||!Array.isArray(rows))
      throw Object.assign(new Error('ThePornDB did not return a performer search.'),{code:'PEOPLE_CATALOGUE_PROVIDER_INVALID'});
    return rows;
  }
  async function load(terms){
    const configuration=options.readStashBoxConfiguration();
    if(!configuration||configuration.endpoint!==ENDPOINT)
      throw Object.assign(new Error('ThePornDB is not configured for catalogue registration.'),{code:'PEOPLE_CATALOGUE_PROVIDER_UNCONFIGURED'});
    const rowsByTerm=new Map();
    for(const {term,display} of terms){
      // Per-term bounded retry: transient Clash/TPDB dial fails recover without sticky Attention.
      const rows=await withRetries(()=>fetchTerm(configuration,display));
      rowsByTerm.set(term,rows);
    }
    return observationFor(terms.map(item=>item.term),rowsByTerm);
  }
  function observeProviderSearch({name,aliases=[]}){
    const terms=searchTerms(name,aliases||[]);
    const key=canonicalDigest({schema:'people.catalogue-provider-cache@1',names:terms.map(item=>item.term)});
    const hit=cached(key);
    if(hit)return hit;
    const started=inflight.get(key);
    if(started!=null){
      if(now()-started>=waitingBoundMs){
        const failure=providerFailure(Object.assign(new Error('ThePornDB catalogue provider search waited too long.'),
          {code:'PEOPLE_CATALOGUE_PROVIDER_FAILED'}));
        remember(key,failure);
        inflight.delete(key);
        options.wake?.();
        return failure;
      }
      return {kind:'waiting',pendingCode:'PEOPLE_CATALOGUE_PROVIDER_PENDING'};
    }
    inflight.set(key,now());
    load(terms).then(observation=>{
      remember(key,observation);
      options.wake?.();
    }).catch(error=>{
      remember(key,providerFailure(error));
      options.wake?.();
    }).finally(()=>inflight.delete(key));
    return {kind:'waiting',pendingCode:'PEOPLE_CATALOGUE_PROVIDER_PENDING'};
  }
  function readImageBytes(request){
    if(request?.kind!=='provider'||typeof request.urlDigest!=='string')return null;
    if(bytes.has(request.urlDigest)){
      const cachedBytes=bytes.get(request.urlDigest);
      if(Buffer.isBuffer(cachedBytes)&&cachedBytes.length)return cachedBytes;
      return imageFailure('Provider image bytes are exhausted.');
    }
    const url=urls.get(request.urlDigest);
    if(!url)return null;
    if(inflight.has(request.urlDigest)){
      const started=inflight.get(request.urlDigest);
      if(typeof started==='number'&&now()-started>=waitingBoundMs){
        bytes.set(request.urlDigest,null);
        inflight.delete(request.urlDigest);
        options.wake?.();
        return imageFailure('Provider image byte fetch waited too long.');
      }
      return null;
    }
    inflight.set(request.urlDigest,now());
    const requestInit=init();
    requestInit.headers={...requestInit.headers,accept:'image/jpeg,image/png,image/webp'};
    withRetries(()=>fetchBytes(options.fetchImpl,url,requestInit,10*1024*1024)).then(result=>{
      bytes.set(request.urlDigest,result.bytes);
      options.wake?.();
    }).catch(()=>{
      // Mark exhausted so callers stop spinning on a dead URL and fail-closed.
      bytes.set(request.urlDigest,null);
      options.wake?.();
    }).finally(()=>inflight.delete(request.urlDigest));
    return null;
  }
  return Object.freeze({observeProviderSearch,readImageBytes});
}

module.exports=Object.freeze({
  createCatalogueProviderObservationPort,
  QUERY,
  ENDPOINT,
  LIMIT,
  DEFAULT_WAITING_BOUND_MS,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_RETRY_BACKOFF_MS,
});
