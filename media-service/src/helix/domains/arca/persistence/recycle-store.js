'use strict';

const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {createRepositoryDefinition}=require('../../../foundation/persistence/owner-repository');
const COLUMNS=['recycle_entry_id','shelf_entry_id','source_location','archive_location','manifest_schema_ref','manifest_json','manifest_digest','reason_code','state','operation_revision','created_at_ms','archived_at_ms','expires_at_ms','updated_at_ms','last_error'];
const RETENTION_MS=30*24*60*60*1000;
function fail(code){throw Object.assign(new Error(code),{code});}

function createRecycleStore(options){
  const repo=createRepositoryDefinition({repositoryId:'arca_recycle',owner:'arca',schemaManifest:options.schemaManifest,statements:{
    list:{kind:'select-all',tableId:'arca_recycle_entries',columns:COLUMNS,keyColumns:[],safeIntegers:true},
    find:{kind:'select-one',tableId:'arca_recycle_entries',columns:COLUMNS,keyColumns:['recycle_entry_id'],safeIntegers:true},
    insert:{kind:'insert',tableId:'arca_recycle_entries',columns:COLUMNS},
    update:{kind:'update',tableId:'arca_recycle_entries',setColumns:['state','operation_revision','archived_at_ms','expires_at_ms','updated_at_ms','last_error'],keyColumns:['recycle_entry_id'],compareColumns:[{column:'state',parameter:'expected_state'},{column:'operation_revision',parameter:'expected_revision'}]},
  }});
  const execute=body=>options.unitOfWork.execute([{participantId:'arca_recycle',owner:'arca',repositories:[repo],execute:ctx=>body(ctx.repository(repo.repositoryId),ctx.commitTimeMs)}]).arca_recycle;
  function decode(row){if(!row)return null;const value={...row,manifest:JSON.parse(row.manifest_json)};
    for(const key of ['operation_revision','created_at_ms','archived_at_ms','expires_at_ms','updated_at_ms'])if(value[key]!==null)value[key]=Number(value[key]);
    return Object.freeze(value);
  }
  function get(id){return execute(r=>decode(r.invoke('find',{recycle_entry_id:id})));}
  function update(row,state,extra={}){
    return execute((r,at)=>{
      const change=r.invoke('update',{...row,state,operation_revision:Number(row.operation_revision)+1,updated_at_ms:at,last_error:null,...extra,expected_state:row.state,expected_revision:row.operation_revision});
      if(change.changes!==1)fail('ARCA_RECYCLE_STATE_CHANGED');
      return decode(r.invoke('find',{recycle_entry_id:row.recycle_entry_id}));
    });
  }
  return Object.freeze({get,list:()=>execute(r=>r.invoke('list',{}).map(decode)),
    create(value){return execute((r,at)=>{
      const existing=r.invoke('find',{recycle_entry_id:value.recycle_entry_id});
      if(existing){if(existing.manifest_digest!==value.manifest_digest||existing.source_location!==value.source_location)fail('ARCA_RECYCLE_KEY_CONFLICT');return decode(existing);}
      if(canonicalDigest(value.manifest)!==value.manifest_digest)fail('ARCA_RECYCLE_MANIFEST_INVALID');
      const json=canonicalJson(value.manifest);if(Buffer.byteLength(json)>65536)fail('ARCA_RECYCLE_SCOPE_TOO_LARGE');
      r.invoke('insert',{...value,manifest_schema_ref:'helix://contracts/application-types/RecycleManifest/v1',manifest_json:json,state:'pending',operation_revision:1,created_at_ms:at,updated_at_ms:at,archived_at_ms:null,expires_at_ms:null,last_error:null});
      return decode(r.invoke('find',{recycle_entry_id:value.recycle_entry_id}));
    });},
    start(row){if(row.state!=='pending')return row;return update(row,'moving');},
    requestRestore(id){const row=get(id);if(!row)fail('ARCA_RECYCLE_NOT_FOUND');if(['restoring','restored'].includes(row.state))return row;if(row.state!=='archived')fail('ARCA_RECYCLE_NOT_ARCHIVED');return update(row,'restoring');},
    requestPurge(row,at){if(row.state!=='archived'||row.expires_at_ms===null||Number(row.expires_at_ms)>at)fail('ARCA_RECYCLE_NOT_EXPIRED');return update(row,'purging');},
    finish(row){const state={moving:'archived',restoring:'restored',purging:'purged'}[row.state];if(!state)fail('ARCA_RECYCLE_OPERATION_INVALID');const at=(options.now||Date.now)();return update(row,state,row.state==='moving'?{archived_at_ms:at,expires_at_ms:at+RETENTION_MS}:{});},
    recordError(row,code){return update(row,row.state,{operation_revision:row.operation_revision,last_error:String(code).slice(0,256)});},
  });
}
module.exports=Object.freeze({createRecycleStore,RETENTION_MS});
