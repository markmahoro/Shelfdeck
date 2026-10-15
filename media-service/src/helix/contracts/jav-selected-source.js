'use strict';

const {canonicalDigest,canonicalJson}=require('./canonical-json');
const {assertJavSourceSelectionSnapshot,assertJavQueryAnchor,javQueryAnchorSchema,JAV_SITES_BY_CLASS}=require('./jav-source-contracts');
const fields=['schema','siteRef','integrationId','configRevision','authMode','endpointProfileDigest','networkRouteDigest','queryAnchor',
  'resourceKey','title','coverDigest','qualificationDigest','bindingDigest'];
function fail(){throw Object.assign(new TypeError('JAV source binding is invalid or differs from its exact qualification.'),{code:'JAV_SOURCE_BINDING_INVALID'});}
function assertJavSelectedSource(value) {
  if(!value || Object.getPrototypeOf(value)!==Object.prototype || canonicalJson(Object.keys(value).sort())!==canonicalJson([...fields].sort()) ||
      value.schema!=='libra.jav-selected-source@1' || !Number.isSafeInteger(value.configRevision)||value.configRevision<1 || value.authMode!=='anonymous' ||
      ['siteRef','integrationId','resourceKey','title'].some(key=>typeof value[key]!=='string'||!value[key].trim()||value[key].trim()!==value[key]) ||
      value.siteRef.length>64 || value.integrationId.length>256 || value.resourceKey.length>128 || value.title.length>16384 ||
      ['endpointProfileDigest','networkRouteDigest','coverDigest','qualificationDigest','bindingDigest'].some(key=>!/^[a-f0-9]{64}$/.test(value[key]||'')) ||
      value.bindingDigest!==canonicalDigest(Object.fromEntries(Object.entries(value).filter(([key])=>key!=='bindingDigest'))) ||
      Buffer.byteLength(canonicalJson(value),'utf8')>16*1024)fail();
  const anchor=assertJavQueryAnchor(value.queryAnchor);
  if(anchor.queryKind!=='jav_code'||!JAV_SITES_BY_CLASS[anchor.codeClass].includes(value.siteRef))fail();
  return value;
}
function buildJavSelectedSource(qualification) {
  const snapshot=assertJavSourceSelectionSnapshot(qualification?.sourceSnapshot),source=snapshot.sources[qualification?.sourceOrdinal],observation=qualification?.observation;
  if(!source || observation?.result!=='qualified' || observation.siteRef!==source.siteRef || observation.queryAnchorDigest!==snapshot.queryAnchor.anchorDigest ||
      observation.endpointProfileDigest!==source.endpointProfileDigest || observation.networkRouteDigest!==source.networkRouteDigest ||
      observation.observationDigest!==canonicalDigest(Object.fromEntries(Object.entries(observation).filter(([key])=>key!=='observationDigest'))))fail();
  const value={schema:'libra.jav-selected-source@1',siteRef:source.siteRef,integrationId:source.integrationId,configRevision:source.configRevision,
    authMode:source.authMode,endpointProfileDigest:source.endpointProfileDigest,networkRouteDigest:source.networkRouteDigest,
    queryAnchor:snapshot.queryAnchor,resourceKey:observation.resourceKey,title:observation.descriptiveEntries.find(entry=>entry.key==='title')?.value,
    coverDigest:observation.cover?.byteDigest,qualificationDigest:observation.observationDigest};
  return Object.freeze(assertJavSelectedSource({...value,bindingDigest:canonicalDigest(value)}));
}
function javSelectedSourceSchema() {
  const text=maxLength=>({type:'string',minLength:1,maxLength}),digest={type:'string',pattern:'^[a-f0-9]{64}$'};
  const properties={schema:{const:'libra.jav-selected-source@1'},siteRef:text(64),integrationId:text(256),configRevision:{type:'integer',minimum:1},authMode:{const:'anonymous'},
    endpointProfileDigest:digest,networkRouteDigest:digest,queryAnchor:javQueryAnchorSchema(),resourceKey:text(128),title:text(16384),coverDigest:digest,qualificationDigest:digest,bindingDigest:digest};
  return {type:'object',additionalProperties:false,properties,required:Object.keys(properties)};
}
module.exports=Object.freeze({buildJavSelectedSource,assertJavSelectedSource,javSelectedSourceSchema});
