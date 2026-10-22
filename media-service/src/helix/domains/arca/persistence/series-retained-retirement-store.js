'use strict';
const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {createRepositoryDefinition}=require('../../../foundation/persistence/owner-repository');
const {createMaterialControlParticipant,controlScopeDigest}=require('../../../foundation/persistence/material-control');
const {readControlProjections}=require('./read-control-projections');
const CONTRACT='arca.series-presentation.retained-retirement@1',SCHEMA='arca.series-retained-retirement@1';
const fail=message=>{throw Object.assign(new Error(message),{code:'ARCA_SERIES_RETIREMENT_STALE'});};
function createSeriesRetainedRetirementStore(options){
  const store=options.seriesStore,repo=createRepositoryDefinition({repositoryId:'arca_series_retained_retirement_execution',owner:'execution-foundation',schemaManifest:options.schemaManifest,statements:{
    works:{kind:'select-all',tableId:'fx_supporting_works',columns:['work_id','state'],keyColumns:['owner_domain','process_type','process_id']},
    events:{kind:'select-all',tableId:'fx_workflow_events',columns:['event_id','state'],keyColumns:['work_id']},
    attempts:{kind:'select-all',tableId:'fx_event_attempts',columns:['event_attempt_id','state'],keyColumns:['event_id']},
    effects:{kind:'select-all',tableId:'fx_effect_journal',columns:['state'],keyColumns:['event_attempt_id']},
    receipt:{kind:'select-one',tableId:'fx_command_receipts',columns:['result_ref_json','result_digest'],keyColumns:['owner_domain','command_contract','idempotency_key']},
    insert:{kind:'insert',tableId:'fx_command_receipts',columns:['command_receipt_id','owner_domain','command_contract','caller_scope','idempotency_key','request_digest','target_type','target_id','result_schema_ref','result_ref_json','result_digest','committed_at_ms']},
  }});
  const participant=(id,execute)=>({participantId:id,owner:'execution-foundation',boundBusinessOwner:'arca',repositories:[repo],execute:c=>execute(c.repository(repo.repositoryId),c)});
  function read(buildId, scopeId=null, headDigest=null){const key=buildId||scopeId+':'+headDigest;return options.unitOfWork.execute([participant('arca_series_retirement_read',r=>{const row=r.invoke('receipt',{owner_domain:'arca',command_contract:CONTRACT,idempotency_key:key});if(!row)return null;const value=JSON.parse(row.result_ref_json),{receiptDigest,...body}=value;if(Object.keys(value).sort().join(',')!=='buildId,controlSetDigest,headDigest,receiptDigest,retainedRootLocation,schema,scopeDigest,scopeId,sharedVersion'||receiptDigest!==canonicalDigest(body)||canonicalDigest(value)!==row.result_digest||value.buildId!==buildId||!buildId&&(value.scopeId!==scopeId||value.headDigest!==headDigest)||value.schema!==SCHEMA)fail('Retained retirement receipt changed.');return value;})]).arca_series_retirement_read;}
  function receiptParticipant(value){return participant('arca_series_retirement_receipt',(r,c)=>{
    const buildId=value.buildId;
    if(buildId)for(const work of r.invoke('works',{owner_domain:'arca',process_type:'arca_series_presentation',process_id:buildId})){
      if(!['succeeded','failed','cancelled'].includes(work.state))fail('Shared Work has not reached its terminal boundary.');
      for(const event of r.invoke('events',{work_id:work.work_id})){
        if(event.state==='executing')fail('Shared Event is still executing.');
        for(const attempt of r.invoke('attempts',{event_id:event.event_id}))if(attempt.state!=='completed'||r.invoke('effects',{event_attempt_id:attempt.event_attempt_id}).some(row=>!['failed','committed'].includes(row.state)))fail('Shared Effect has not been reconciled.');
      }
    }
    const key=buildId||value.scopeId+':'+value.headDigest,prior=r.invoke('receipt',{owner_domain:'arca',command_contract:CONTRACT,idempotency_key:key});if(prior)fail('Retained retirement was already committed.');
    r.invoke('insert',{command_receipt_id:'arca-series-retirement-'+canonicalDigest(key).slice(0,40),owner_domain:'arca',command_contract:CONTRACT,caller_scope:'series_presentation:'+value.scopeId,idempotency_key:key,request_digest:value.headDigest,target_type:buildId?'series_presentation_build':'series_presentation',target_id:buildId||value.scopeId,result_schema_ref:SCHEMA,result_ref_json:canonicalJson(value),result_digest:canonicalDigest(value),committed_at_ms:c.commitTimeMs});return value;
  });}
  function retire(current){if(!store.unused(current.scope_id))return null;
    const manifest=Number(current.current_version)?store.manifest(current.scope_id,Number(current.current_version)).value:null,owner={ownerDomain:'arca',scopeType:'series_presentation',scopeId:current.scope_id},changes=[];
    if(manifest){const projections=readControlProjections(options.materialControlProjectionPort,manifest.members.map(row=>row.physicalIdentity.materialKey));for(const member of manifest.members){const projection=projections.find(row=>row.materialKey===member.physicalIdentity.materialKey);if(projection?.controlState==='released')continue;if(projection?.controlState!=='controlled'||projection.ownerDomain!=='arca'||projection.ownerScopeType!==owner.scopeType||projection.ownerScopeId!==owner.scopeId)fail('Shared retained root lost its exact Control.');changes.push({identity:member.physicalIdentity,action:'release',fromScope:owner,expectedRevision:projection.controlRevision,expectedProjectionDigest:projection.projectionDigest});}}
    if(!current.active_build_id&&!changes.length)return null;
    const body={schema:SCHEMA,scopeId:current.scope_id,buildId:current.active_build_id||null,scopeDigest:current.active_build_id?store.build(current.active_build_id).digest:null,headDigest:current.state_digest,sharedVersion:Number(current.current_version),retainedRootLocation:current.root_location,controlSetDigest:controlScopeDigest(changes)},receipt={...body,receiptDigest:canonicalDigest(body)},participants=[store.retainedRetirementParticipant(current),receiptParticipant(receipt)];
    if(changes.length){const handle={schemaRef:'helix://contracts/types/ResponsibilityControlCommitHandle/v1',schemaVersion:1,handleId:'arca-series-retained-'+receipt.receiptDigest.slice(0,40),operationKind:'replace_control_set',ownerDomain:'arca',processType:'arca_series_retirement',processId:current.scope_id,basisRef:{objectType:'series_presentation',objectId:current.scope_id,revision:Number(current.state_revision),digest:current.state_digest},basisDigest:current.state_digest,canonicalFactSetDigest:manifest.digest,bindingSetDigest:canonicalDigest(manifest.members),controlScopeDigest:body.controlSetDigest,expectedControlRevisions:changes.map(row=>({materialKey:row.identity.materialKey,revision:row.expectedRevision})),receiptContract:{receiptSchemaRef:SCHEMA,controlRevisionSetSchemaRef:SCHEMA},eventFenceDigest:receipt.receiptDigest};participants.push(createMaterialControlParticipant({...options,participantId:'arca_series_retained_controls',handle,changes,authorizedScopeDigest:body.controlSetDigest,commitMarker:'arca-series-retained-marker-'+receipt.receiptDigest.slice(0,40)}));}
    const contract=require('../../../contracts/transaction-contracts/helix.transaction.series-presentation-commit/v1/contract.json').contract.variants.find(row=>row.variantId==='retained_root_retirement@1'),declared=new Set([...contract.readTables,...contract.writeTables]);if(participants.some(p=>p.repositories.some(r=>r.tableIds.some(table=>!declared.has(table)))))fail('Retained retirement escaped its canonical transaction.');
    options.unitOfWork.execute(participants);return receipt;
  }
  return Object.freeze({read,retire});
}
module.exports=Object.freeze({createSeriesRetainedRetirementStore});
