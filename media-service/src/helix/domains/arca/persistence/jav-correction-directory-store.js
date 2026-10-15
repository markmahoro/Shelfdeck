'use strict';
const {canonicalJson,canonicalDigest}=require('../../../contracts/canonical-json');
const {createRepositoryDefinition}=require('../../../foundation/persistence/owner-repository');
const {SCHEMA,CHECKS_SCHEMA}=require('../model/jav-correction-directory-scope');
const COLUMNS=['correction_id','shelf_entry_id','committed_context_digest','cleanup_receipt_digest','state','check_revision','checks_schema_ref','checks_json','checks_scope_digest','last_error_code','created_at_ms','updated_at_ms','next_check_at_ms'];
const seedStatement=Object.freeze({kind:'insert',tableId:'arca_jav_correction_directory_checks',columns:COLUMNS});
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
function createJavCorrectionDirectoryStore(options){
  const definition=createRepositoryDefinition({repositoryId:'arca_jav_directory_checks',owner:'arca',schemaManifest:options.schemaManifest,statements:{
    find:{kind:'select-one',tableId:'arca_jav_correction_directory_checks',columns:COLUMNS,keyColumns:['correction_id'],safeIntegers:true},
    due:{kind:'select-before-page',tableId:'arca_jav_correction_directory_checks',columns:COLUMNS,upperBoundColumn:'next_check_at_ms',orderBy:['next_check_at_ms','correction_id'],maxItems:1,safeIntegers:true},
    page:{kind:'select-page-after',tableId:'arca_jav_correction_directory_checks',columns:COLUMNS,keyColumn:'correction_id',maxItems:100,safeIntegers:true},
    entry:{kind:'select-filtered-page',tableId:'arca_jav_correction_directory_checks',columns:COLUMNS,fixedKeyColumns:['shelf_entry_id'],orderBy:[{column:'correction_id',direction:'asc'}],maxItems:33,safeIntegers:true},
    correction:{kind:'select-one',tableId:'arca_jav_identity_corrections',columns:['shelf_entry_id','state','cleanup_state','committed_context_digest','cleanup_receipt_digest'],keyColumns:['correction_id']},
    update:{kind:'update',tableId:'arca_jav_correction_directory_checks',setColumns:['state','check_revision','checks_json','checks_scope_digest','last_error_code','updated_at_ms','next_check_at_ms'],keyColumns:['correction_id'],compareColumns:[{column:'check_revision',parameter:'expected_revision'},{column:'committed_context_digest',parameter:'expected_context_digest'},{column:'cleanup_receipt_digest',parameter:'expected_receipt_digest'}]},
  }});
  const execute=body=>options.unitOfWork.execute([{participantId:'arca_jav_directory_checks',owner:'arca',repositories:[definition],execute:c=>body(c.repository(definition.repositoryId),c.commitTimeMs)}]).arca_jav_directory_checks;
  function decode(row){if(!row)return null;let checks;try{checks=JSON.parse(row.checks_json);}catch{fail('ARCA_JAV_DIRECTORY_CHECK_CORRUPT','Directory checks JSON is corrupt.');}
    options.contractValidator.validate(CHECKS_SCHEMA,checks);if(row.checks_schema_ref!==CHECKS_SCHEMA||canonicalJson(checks)!==row.checks_json)fail('ARCA_JAV_DIRECTORY_CHECK_CORRUPT','Directory checks nominal shape changed.');
    return Object.freeze({...row,check_revision:Number(row.check_revision),created_at_ms:Number(row.created_at_ms),updated_at_ms:Number(row.updated_at_ms),next_check_at_ms:Number(row.next_check_at_ms),checks});}
  return Object.freeze({get:id=>execute(repo=>decode(repo.invoke('find',{correction_id:id}))),
    next:at=>execute(repo=>decode(repo.invoke('due',{upperBound:at+1,offset:0,limit:1})[0])),
    page:(cursor=null,limit=50)=>execute(repo=>repo.invoke('page',{cursor,limit}).map(decode)),
    forEntry:shelfEntryId=>execute(repo=>{const rows=repo.invoke('entry',{shelf_entry_id:shelfEntryId,offset:0,limit:33});if(rows.length>32)fail('ARCA_RECYCLE_SCOPE_TOO_LARGE','Correction directory history exceeds the bounded Entry scope.');return rows.map(decode);}),
    record(row,{scope,checks,state,nextAt,errorCode=null}){
      options.contractValidator.validate(CHECKS_SCHEMA,checks);
      if(!['pending','attention','completed'].includes(state)||!Number.isSafeInteger(nextAt)||nextAt<0||errorCode!==null&&(typeof errorCode!=='string'||!errorCode||errorCode.length>256))fail('ARCA_JAV_DIRECTORY_CHECK_INVALID','Directory check result is invalid.');
      if(scope){options.contractValidator.validate(SCHEMA,scope);const {scopeDigest,...body}=scope;
        if(scopeDigest!==canonicalDigest(body)||scope.correctionId!==row.correction_id||scope.shelfEntryId!==row.shelf_entry_id||scope.committedContextDigest!==row.committed_context_digest||scope.cleanupReceiptDigest!==row.cleanup_receipt_digest||
          checks.length!==scope.directories.length||new Set(checks.map(item=>item.sourceLocation)).size!==checks.length||checks.some(item=>!scope.directories.some(dir=>dir.sourceLocation===item.sourceLocation)))fail('ARCA_JAV_DIRECTORY_CHECK_SCOPE_CHANGED','Directory check does not cover the exact completed correction scope.');
        if(scope.directories.some(dir=>dir.eligibility!=='eligible'&&checks.find(item=>item.sourceLocation===dir.sourceLocation).state!==dir.eligibility))fail('ARCA_JAV_DIRECTORY_CHECK_INVALID','Protected directories must retain their declared reason.');
        const expectedState=errorCode||checks.some(item=>['awaiting_confirmation','blocked'].includes(item.state)||item.errorCode&&item.state!=='retained_in_use')?'attention':checks.some(item=>item.state==='recycle_pending')?'pending':'completed';
        if(state!==expectedState)fail('ARCA_JAV_DIRECTORY_CHECK_INVALID','Directory responsibility state contradicts its complete observations.');
      }else if(state!=='attention'||!errorCode||checks.length)fail('ARCA_JAV_DIRECTORY_CHECK_INVALID','Missing scope can only record an explicit preparation failure.');
      const json=canonicalJson(checks);if(Buffer.byteLength(json)>65536)fail('ARCA_JAV_DIRECTORY_CHECK_INVALID','Directory check exceeds its canonical budget.');
      return execute((repo,at)=>{const correction=repo.invoke('correction',{correction_id:row.correction_id});
        if(correction?.state!=='committed'||correction.cleanup_state!=='completed'||correction.shelf_entry_id!==row.shelf_entry_id||correction.committed_context_digest!==row.committed_context_digest||correction.cleanup_receipt_digest!==row.cleanup_receipt_digest)fail('ARCA_JAV_DIRECTORY_CHECK_SCOPE_CHANGED','Completed correction provenance changed.');
        const result=repo.invoke('update',{correction_id:row.correction_id,expected_revision:row.check_revision,expected_context_digest:row.committed_context_digest,expected_receipt_digest:row.cleanup_receipt_digest,
          state,check_revision:row.check_revision+1,checks_json:json,checks_scope_digest:scope?.scopeDigest||null,last_error_code:errorCode,updated_at_ms:at,next_check_at_ms:nextAt});
        if(result.changes!==1)fail('ARCA_JAV_DIRECTORY_CHECK_CHANGED','Directory check revision changed.');return decode(repo.invoke('find',{correction_id:row.correction_id}));});
    },
  });
}
module.exports=Object.freeze({COLUMNS,seedStatement,createJavCorrectionDirectoryStore});
