'use strict';
const {createRepositoryDefinition}=require('./owner-repository');
const {canonicalDigest:D,canonicalJson}=require('../../contracts/canonical-json');
function fail(message){throw Object.assign(new Error(message),{code:'ARTIFACT_REFERENCE_SOURCE_INVALID'});}
function contains(value,id,depth=0){if(depth>64)fail('Reference source nesting exceeds its bound.');
  if(typeof value==='string')return value===id;if(!value||typeof value!=='object')return false;
  return Object.values(value).some(child=>contains(child,id,depth+1));}
function referenceAssets(value,output=new Set(),depth=0){if(depth>64)fail('Reference source nesting exceeds its bound.');if(!value||typeof value!=='object')return output;
  for(const [key,child] of Object.entries(value)){if(key==='referenceAssetId'&&typeof child==='string')output.add(child);if(output.size>4096)fail('Reference page has too many asset references.');if(child&&typeof child==='object')referenceAssets(child,output,depth+1);}return output;}
function readJson(row,descriptor,validator){const value=row?.[descriptor.json];if(typeof value!=='string'||Buffer.byteLength(value)>1024*1024)fail('Reference source is missing or exceeds its declared bound.');
  let parsed;try{parsed=JSON.parse(value);}catch{fail('Reference source JSON is corrupt.');}
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))fail('Reference source must be its declared object.');
  const schemaRef=descriptor.schemaRef||row[descriptor.schemaColumn];
  validator.validate(schemaRef,parsed);
  const body={...parsed};if(descriptor.selfDigestProperty)delete body[descriptor.selfDigestProperty];for(const field of descriptor.digestExcludedProperties||[])delete body[field];
  if(canonicalJson(parsed)!==value||descriptor.schemaColumn&&row[descriptor.schemaColumn]!==schemaRef||
    descriptor.digestColumn&&row[descriptor.digestColumn]!==D(descriptor.digestProperty?body:parsed)||
    descriptor.selfDigestProperty&&parsed[descriptor.selfDigestProperty]!==D(body))fail('Reference source digest or schema header is corrupt.');
  return parsed;}
function jsonColumns(part){return part.json?[part.json,part.schemaColumn,part.digestColumn].filter(Boolean):[];}
function createReferenceAuditSource(options){
  const {owner,sourceId,partitions=[],epochs=[],points=[]}=options,statements={};
  if(partitions.some(part=>part.schemaRef||part.child?.schemaRef||part.child?.fact)&&typeof options.contractValidator?.validate!=='function')
    throw new TypeError('Reference sources require their closed Owner schema validator.');
  for(const [i,part] of partitions.entries()){
    statements['parent_'+i]={kind:'select-page-after',tableId:part.table,keyColumn:part.key,columns:[part.key,...jsonColumns(part)],maxItems:1};
    if(part.child?.countProperty)statements['parent_exact_'+i]={kind:'select-one',tableId:part.table,keyColumns:[part.key],columns:[part.key,...jsonColumns(part)]};
    if(part.child)statements['child_'+i]={kind:'select-page-after',tableId:part.child.table,keyColumn:part.child.key,
      fixedKeyColumns:[part.child.parentKey],columns:[part.child.key,...jsonColumns(part.child)],maxItems:1,safeIntegers:true};
    if(part.child?.fact)statements['fact_'+i]={kind:'select-one',tableId:part.child.fact.table,columns:jsonColumns(part.child.fact),
      keyColumns:[part.child.fact.parentKey,part.child.fact.revisionKey,'fact_kind']};
  }
  for(const [i,item] of epochs.entries())statements['epoch_'+i]={kind:'select-summary',tableId:item.table,summaries:[{operator:'count',output:'rows'},
    ...item.columns.map((column,index)=>({operator:'sum',column,output:'sum_'+index}))]};
  for(const [i,item] of points.entries())statements['point_'+i]={kind:'select-summary',tableId:item.table,keyColumns:[item.column,'state'],summaries:[{operator:'count',output:'rows'}]};
  Object.assign(statements,options.extraStatements||{});
  const definition=createRepositoryDefinition({repositoryId:sourceId+'_reference_audit',owner,schemaManifest:options.schemaManifest,readOnly:true,statements});
  function epoch(repo){return D(epochs.map((_,i)=>Object.fromEntries(Object.entries(repo.invoke('epoch_'+i)).map(([key,value])=>[key,typeof value==='bigint'?value.toString():value]))));}
  function execute(body){return options.unitOfWork.execute([{participantId:sourceId,owner,readOnly:true,repositories:[definition],execute:tx=>body(tx.repository(definition.repositoryId))}])[sourceId];}
  function participant(expected,artifactHandle=null,atMs=null){return {participantId:sourceId+'_guard',owner,readOnly:true,repositories:[definition],execute(tx){
    const repo=tx.repository(definition.repositoryId);if(epoch(repo)!==expected||artifactHandle&&(options.pointGuard?.(repo,artifactHandle,atMs)||points.some((item,i)=>repo.invoke('point_'+i,{[item.column]:artifactHandle.artifactHandleId,state:'active'}).rows>0n)))fail('Reference source changed after the frozen audit.');return true;}};}
  function page({artifactHandle,cursor=null,atMs}){return execute(repo=>{
    const id=artifactHandle.artifactHandleId;
    if(points.some((item,i)=>repo.invoke('point_'+i,{[item.column]:id,state:'active'}).rows>0n))return {referenced:true,done:true,nextCursor:null,pageDigest:D({id,current:true})};
    if(options.pointGuard?.(repo,artifactHandle,atMs))return {referenced:true,referenceAssetIds:[],done:true,nextCursor:null,pageDigest:D({id,ownerGuard:true})};
    let state={partition:0,parent:null,outer:null,child:null};if(cursor!==null){try{state=JSON.parse(cursor);}catch{fail('Reference source cursor is invalid.');}
      if(!state||Object.keys(state).sort().join(',')!=='child,outer,parent,partition'||!Number.isInteger(state.partition)||state.partition<0||state.partition>partitions.length||
        [state.parent,state.outer].some(value=>value!==null&&typeof value!=='string')||state.child!==null&&!Number.isSafeInteger(state.child))fail('Reference source cursor is not a declared page position.');}
    const part=partitions[state.partition];if(!part)return {referenced:false,done:true,nextCursor:null,pageDigest:D({id,end:true})};
    let row=null,referenced=false;const assets=new Set();
    if(state.parent===null){row=repo.invoke('parent_'+state.partition,{cursor:state.outer,limit:1})[0];
      if(!row)state={partition:state.partition+1,parent:null,outer:null,child:null};
      else{if(part.json){const value=readJson(row,part,options.contractValidator);referenced=contains(value,id);referenceAssets(value,assets);}const key=String(row[part.key]);
        state=part.child?{...state,parent:key,child:-1}:{...state,outer:key};}}
    else{let count=null;if(part.child.countProperty){const parent=readJson(repo.invoke('parent_exact_'+state.partition,{[part.key]:state.parent}),part,options.contractValidator);count=parent[part.child.countProperty];
        if(!Number.isSafeInteger(count)||count<0||state.child>=count)fail('Reference source page count is invalid.');}
      row=repo.invoke('child_'+state.partition,{[part.child.parentKey]:state.parent,cursor:state.child,limit:1})[0];
      if(count!==null&&(row?Number(row[part.child.key])!==state.child+1||Number(row[part.child.key])>=count:state.child+1!==count))fail('Frozen reference source pages are missing or noncontiguous.');
      if(!row)state={...state,outer:state.parent,parent:null,child:null};
      else{if(part.child.json){const value=readJson(row,part.child,options.contractValidator);referenced=contains(value,id);referenceAssets(value,assets);}
        if(part.child.fact){const fact=part.child.fact,rowValue=repo.invoke('fact_'+state.partition,{[fact.parentKey]:state.parent,[fact.revisionKey]:row[part.child.key],fact_kind:'media_cast'});
          if(rowValue){const value=readJson(rowValue,fact,options.contractValidator);referenced=contains(value,id);referenceAssets(value,assets);}
          else{const identity=repo.invoke('fact_'+state.partition,{[fact.parentKey]:state.parent,[fact.revisionKey]:row[part.child.key],fact_kind:'resolved_identity'});
            const value=readJson(identity,fact,options.contractValidator);if((value.resolvedProductIdentity?.contentProfile||value.contentProfile)==='western_adult')fail('US Adult retained inventory has lost its actor Fact.');}}
        state={...state,child:Number(row[part.child.key])};}}
    const done=state.partition===partitions.length;
    return {referenced,referenceAssetIds:[...assets].sort(),done,nextCursor:done?null:canonicalJson(state),pageDigest:D({id,cursor,row:row?D(Object.fromEntries(Object.entries(row).map(([key,value])=>[key,typeof value==='bigint'?value.toString():value]))):null,state,referenced})};
  });}
  return Object.freeze({sourceId,epoch:()=>execute(epoch),page,participant,definition});
}
module.exports=Object.freeze({createReferenceAuditSource});
