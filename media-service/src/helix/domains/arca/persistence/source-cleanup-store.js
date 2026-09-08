'use strict';

const {canonicalJson}=require('../../../contracts/canonical-json');
const {createRepositoryDefinition}=require('../../../foundation/persistence/owner-repository');
const COLUMNS=['cleanup_id','on_deck_run_id','shelf_entry_id','state','check_revision','checks_schema_ref','checks_json','created_at_ms','updated_at_ms','next_check_at_ms'];
const seedStatement=Object.freeze({kind:'insert',tableId:'arca_source_cleanup_checks',columns:COLUMNS});

function createSourceCleanupStore(options){
  const repo=createRepositoryDefinition({repositoryId:'arca_source_cleanup',owner:'arca',schemaManifest:options.schemaManifest,statements:{
    find:{kind:'select-one',tableId:'arca_source_cleanup_checks',columns:COLUMNS,keyColumns:['on_deck_run_id'],safeIntegers:true},
    due:{kind:'select-before-page',tableId:'arca_source_cleanup_checks',columns:COLUMNS,upperBoundColumn:'next_check_at_ms',orderBy:['next_check_at_ms','on_deck_run_id'],maxItems:1,safeIntegers:true},
    page:{kind:'select-page-after',tableId:'arca_source_cleanup_checks',columns:COLUMNS,keyColumn:'on_deck_run_id',maxItems:100,safeIntegers:true},
    update:{kind:'update',tableId:'arca_source_cleanup_checks',setColumns:['state','check_revision','checks_json','updated_at_ms','next_check_at_ms'],keyColumns:['on_deck_run_id'],compareColumns:[{column:'check_revision',parameter:'expected_revision'}]},
  }});
  const execute=body=>options.unitOfWork.execute([{participantId:'arca_source_cleanup',owner:'arca',repositories:[repo],execute:c=>body(c.repository(repo.repositoryId),c.commitTimeMs)}]).arca_source_cleanup;
  function decode(row){if(!row)return null;return {...row,check_revision:Number(row.check_revision),created_at_ms:Number(row.created_at_ms),updated_at_ms:Number(row.updated_at_ms),next_check_at_ms:Number(row.next_check_at_ms),checks:JSON.parse(row.checks_json)};}
  return Object.freeze({
    next(at){return execute(r=>decode(r.invoke('due',{upperBound:at+1,offset:0,limit:1})[0]));},
    page(cursor=null,limit=50){return execute(r=>r.invoke('page',{cursor,limit}).map(decode));},
    record(row,checks,state,nextAt){
      const json=canonicalJson(checks);if(Buffer.byteLength(json)>65536||checks.length>32)throw Object.assign(new Error('Cleanup scope is too large.'),{code:'ARCA_RECYCLE_SCOPE_TOO_LARGE'});
      return execute((r,at)=>{
        const result=r.invoke('update',{on_deck_run_id:row.on_deck_run_id,state,check_revision:row.check_revision+1,checks_json:json,updated_at_ms:at,next_check_at_ms:nextAt,expected_revision:row.check_revision});
        if(result.changes!==1)throw Object.assign(new Error('Cleanup check changed.'),{code:'ARCA_RECYCLE_CHECK_CHANGED'});
        return decode(r.invoke('find',{on_deck_run_id:row.on_deck_run_id}));
      });
    },
  });
}
module.exports=Object.freeze({createSourceCleanupStore,seedStatement});
