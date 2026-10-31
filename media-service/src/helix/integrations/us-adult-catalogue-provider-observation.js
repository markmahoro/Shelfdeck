'use strict';

const {canonicalDigest}=require('../contracts/canonical-json');
const {normalizeName,queryNames,compare}=require('../contracts/us-adult-name-query');
const {fetchJson,fetchBytes}=require('./h1-provider-adapters');

const QUERY='query ShelfDeckCataloguePerformers($term: String!, $limit: Int!) { searchPerformer(term: $term, limit: $limit) { id name aliases images { id url width height } } }';
const LIMIT=25;
const ENDPOINT='https://api.theporndb.net/graphql';

function imageUrl(value){
  let url;
  try{url=new URL(value);}catch{return null;}
  if(url.protocol!=='https:'||url.username||url.password||url.hash||url.href.length>4096)return null;
  return url.href;
}

function createCatalogueProviderObservationPort(options){
  if(typeof options?.fetchImpl!=='function'||typeof options.readStashBoxConfiguration!=='function'||
    typeof options.withStashBoxCredential!=='function')
    throw new TypeError('Catalogue provider observation requires ThePornDB transport and credentials.');
  const cache=new Map(),urls=new Map(),bytes=new Map(),inflight=new Set();
  function init(){
    return {redirect:'manual',signal:AbortSignal.timeout(15000),headers:{'User-Agent':'ShelfDeck/1.0 (catalogue registration)','accept':'application/json'}};
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
    const names=queryNames(name,aliases);
    const display=new Map();
    for(const value of [name,...(aliases||[])]){
      const term=normalizeName(value);
      if(!display.has(term))display.set(term,value.trim());
    }
    return names.map(term=>({term,display:display.get(term)||term}));
  }
  async function load(terms){
    const configuration=options.readStashBoxConfiguration();
    if(!configuration||configuration.endpoint!==ENDPOINT)
      throw Object.assign(new Error('ThePornDB is not configured for catalogue registration.'),{code:'PEOPLE_CATALOGUE_PROVIDER_UNCONFIGURED'});
    const rowsByTerm=new Map();
    for(const {term,display} of terms){
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
      rowsByTerm.set(term,rows);
    }
    return observationFor(terms.map(item=>item.term),rowsByTerm);
  }
  function observeProviderSearch({name,aliases=[]}){
    const terms=searchTerms(name,aliases||[]);
    const key=canonicalDigest({schema:'people.catalogue-provider-cache@1',names:terms.map(item=>item.term)});
    if(cache.has(key))return cache.get(key);
    if(!inflight.has(key)){
      inflight.add(key);
      load(terms).then(observation=>{cache.set(key,observation);options.wake?.();})
        .catch(()=>{}) // Failed searches stay uncached so the next reconcile retries.
        .finally(()=>inflight.delete(key));
    }
    return {kind:'waiting',pendingCode:'PEOPLE_CATALOGUE_PROVIDER_PENDING'};
  }
  function readImageBytes(request){
    if(request?.kind!=='provider'||typeof request.urlDigest!=='string')return null;
    if(bytes.has(request.urlDigest)){
      const cached=bytes.get(request.urlDigest);
      return Buffer.isBuffer(cached)?cached:null;
    }
    const url=urls.get(request.urlDigest);
    if(!url||inflight.has(request.urlDigest))return null;
    inflight.add(request.urlDigest);
    const requestInit=init();
    requestInit.headers={...requestInit.headers,accept:'image/jpeg,image/png,image/webp'};
    fetchBytes(options.fetchImpl,url,requestInit,10*1024*1024).then(result=>{
      bytes.set(request.urlDigest,result.bytes);
      options.wake?.();
    }).catch(()=>{
      // Failed image bytes stay uncached so the next reconcile retries.
    }).finally(()=>inflight.delete(request.urlDigest));
    return null;
  }
  return Object.freeze({observeProviderSearch,readImageBytes});
}

module.exports=Object.freeze({createCatalogueProviderObservationPort,QUERY,ENDPOINT,LIMIT});
