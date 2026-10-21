'use strict';
const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {createRepositoryDefinition}=require('../../../foundation/persistence/owner-repository');
const CONTRACT='arca.series-presentation.retry@1',SCHEMA='helix://arca/commands/series-retry-result/v1';
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
function createSeriesRetryCommandStore(options){
  const repository=createRepositoryDefinition({repositoryId:'arca_series_retry_commands',owner:'execution-foundation',schemaManifest:options.schemaManifest,statements:{
    find:{kind:'select-one',tableId:'fx_command_receipts',columns:['request_digest','caller_scope','target_id','result_schema_ref','result_ref_json','result_digest'],keyColumns:['owner_domain','command_contract','idempotency_key']},
    build:{kind:'select-all',tableId:'fx_command_receipts',columns:['result_schema_ref','result_ref_json','result_digest'],keyColumns:['owner_domain','command_contract','target_id']},
    insert:{kind:'insert',tableId:'fx_command_receipts',columns:['command_receipt_id','owner_domain','command_contract','caller_scope','idempotency_key','request_digest','target_type','target_id','result_schema_ref','result_ref_json','result_digest','committed_at_ms']},
  }});
  const participant=(id,execute)=>({participantId:id,owner:'execution-foundation',boundBusinessOwner:'arca',repositories:[repository],execute:c=>execute(c.repository(repository.repositoryId),c)});
  function decode(row){if(!row)return null;const result=JSON.parse(row.result_ref_json);
    if(Object.keys(result).sort().join(',')!=='buildId,generation,scopeDigest,scopeId,workId,workKind'||!['series_presentation','series_presentation_reclaim'].includes(result.workKind)||row.result_schema_ref!==SCHEMA||row.result_digest!==canonicalDigest(result)||
        !/^arca-series-build-[a-f0-9]{40}$/.test(result.buildId)||!/^arca-series-work-[a-f0-9]{40}$/.test(result.workId)||!/^arca-series-[a-f0-9]{40}$/.test(result.scopeId)||!/^[a-f0-9]{64}$/.test(result.scopeDigest)||!Number.isSafeInteger(result.generation)||result.generation<1)
      fail('ARCA_SERIES_RETRY_RECEIPT_INVALID','Stored shared retry command is invalid.');return result;}
  function command(targetKind,targetId,body){
    if(!body?.idempotencyKey)return null;
    if(!['acceptance','entry'].includes(targetKind)||typeof targetId!=='string'||!targetId||typeof body.idempotencyKey!=='string'||body.idempotencyKey.length>256)
      fail('ARCA_SERIES_RETRY_COMMAND_INVALID','Shared retry requires its exact target and command identity.');
    const callerScope=targetKind+':'+targetId,key=body.idempotencyKey,requestDigest=canonicalDigest({targetKind,targetId,supplementalImages:body.supplementalImages||[]}),
      args={owner_domain:'arca',command_contract:CONTRACT,caller_scope:callerScope,idempotency_key:key};
    function readRow(r){const row=r.invoke('find',{owner_domain:'arca',command_contract:CONTRACT,idempotency_key:key});if(row&&(row.request_digest!==requestDigest||row.caller_scope!==callerScope))fail('ARCA_SERIES_RETRY_KEY_CONFLICT','Retry command identity was reused with different images.');return row;}
    return {read:()=>options.unitOfWork.execute([participant('arca_series_retry_read',r=>decode(readRow(r)))]).arca_series_retry_read,
      participant:resultProvider=>participant('arca_series_retry_receipt',(r,c)=>{const prior=readRow(r),result=resultProvider();
        decode({result_schema_ref:SCHEMA,result_ref_json:canonicalJson(result),result_digest:canonicalDigest(result)});
        if(prior){if(canonicalJson(decode(prior))!==canonicalJson(result))fail('ARCA_SERIES_RETRY_KEY_CONFLICT','Retry command already records another Work.');return result;}
        r.invoke('insert',{...args,command_receipt_id:'arca-series-retry-'+canonicalDigest({callerScope,key}).slice(0,40),request_digest:requestDigest,
          target_type:'series_presentation_build',target_id:result.buildId,result_schema_ref:SCHEMA,result_ref_json:canonicalJson(result),result_digest:canonicalDigest(result),committed_at_ms:c.commitTimeMs});return result;
      })};
  }
  function latestForBuild(buildId){const values=options.unitOfWork.execute([participant('arca_series_retry_build',r=>r.invoke('build',{owner_domain:'arca',command_contract:CONTRACT,target_id:buildId}).map(decode))]).arca_series_retry_build;
    return values.sort((a,b)=>b.generation-a.generation)[0]||null;}
  return Object.freeze({command,latestForBuild});
}
module.exports=Object.freeze({createSeriesRetryCommandStore});
