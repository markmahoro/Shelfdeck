'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');
const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');

const COMMAND = 'libra.choose-product-identity@1';
const RESULT_SCHEMA = 'helix://libra/admin-results/ProductIdentitySelectionIntentReceipt/v1';

class ProductIdentitySelectionError extends Error {
  constructor(code, message, details = {}) { super(message); this.name='ProductIdentitySelectionError'; this.code=code; this.details=details; }
}
function fail(code,message,details){throw new ProductIdentitySelectionError(code,message,details);}
function stable(prefix,value){return prefix+canonicalDigest(value).slice(0,40);}

function createProductIdentitySelectionService(options) {
  if(!options?.schemaManifest||!options.unitOfWork)fail('LIBRA_IDENTITY_SELECTION_DEPENDENCIES','Product Identity selection requires Owner persistence.');
  const owner=createRepositoryDefinition({repositoryId:'libra_product_identity_selection',owner:'libra',schemaManifest:options.schemaManifest,statements:{
    find_run:{kind:'select-one',tableId:'libra_runs',columns:['libra_run_id','subject_id','state','state_revision'],keyColumns:['libra_run_id'],safeIntegers:true},
    list_identity:{kind:'select-all',tableId:'libra_product_identity_revisions',columns:['subject_id','revision','identity_digest'],keyColumns:['subject_id'],safeIntegers:true},
    list_intents:{kind:'select-all',tableId:'libra_product_identity_selection_intents',columns:['selection_intent_id','libra_run_id','intent_revision','selection_kind','provider','namespace','provider_key','candidate_set_digest','expected_run_state_revision','expected_identity_revision','idempotency_key','intent_digest','created_at_ms'],keyColumns:['libra_run_id'],safeIntegers:true},
    insert_intent:{kind:'insert',tableId:'libra_product_identity_selection_intents',columns:['selection_intent_id','libra_run_id','intent_revision','selection_kind','provider','namespace','provider_key','candidate_set_digest','expected_run_state_revision','expected_identity_revision','idempotency_key','intent_digest','created_at_ms']},
  }});
  const foundation=createRepositoryDefinition({repositoryId:'libra_product_identity_selection_receipt',owner:'execution-foundation',schemaManifest:options.schemaManifest,statements:{
    find_receipt:{kind:'select-one',tableId:'fx_command_receipts',columns:['command_receipt_id','request_digest','target_id','result_ref_json','result_digest'],keyColumns:['owner_domain','command_contract','caller_scope','idempotency_key']},
    insert_receipt:{kind:'insert',tableId:'fx_command_receipts',columns:['command_receipt_id','owner_domain','command_contract','caller_scope','idempotency_key','request_digest','target_type','target_id','result_schema_ref','result_ref_json','result_digest','committed_at_ms']},
  }});
  function read(libraRunId){return options.unitOfWork.execute([{participantId:'identity_selection_read',owner:'libra',repositories:[owner],execute(context){
    const rows=context.repository(owner.repositoryId).invoke('list_intents',{libra_run_id:libraRunId}).sort((a,b)=>Number(a.intent_revision)-Number(b.intent_revision));
    const row=rows.at(-1);return row?Object.freeze({...row,intent_revision:Number(row.intent_revision),expected_run_state_revision:Number(row.expected_run_state_revision),
      expected_identity_revision:row.expected_identity_revision===null?null:Number(row.expected_identity_revision),created_at_ms:Number(row.created_at_ms)}):null;
  }}]).identity_selection_read;}
  function choose(libraRunId, body) {
    if(!body||typeof body.idempotencyKey!=='string'||!body.idempotencyKey||!Number.isSafeInteger(body.expectedRunStateRevision)||
        !(body.expectedIdentityRevision===null||Number.isSafeInteger(body.expectedIdentityRevision))||
        typeof body.tmdbMovieId!=='string'||!/^\d+$/.test(body.tmdbMovieId))
      fail('LIBRA_IDENTITY_SELECTION_INPUT','Identity selection requires an exact Run/Identity fence, idempotency key, and TMDB Movie ID.');
    const request={libraRunId,idempotencyKey:body.idempotencyKey,expectedRunStateRevision:body.expectedRunStateRevision,
      expectedIdentityRevision:body.expectedIdentityRevision,tmdbMovieId:body.tmdbMovieId,candidateSetDigest:body.candidateSetDigest||null};
    const requestDigest=canonicalDigest(request),callerScope='libra_run:'+libraRunId;
    let committedResult;
    return options.unitOfWork.execute([{
      participantId:'identity_selection_owner',owner:'libra',repositories:[owner],execute(context){const repo=context.repository(owner.repositoryId),run=repo.invoke('find_run',{libra_run_id:libraRunId});
        if(!run)fail('LIBRA_RUN_NOT_FOUND','Libra Run was not found.');
        if(!['active','suspended'].includes(run.state))fail('LIBRA_IDENTITY_SELECTION_RUN_STATE','Only a current unfinished Libra Run accepts Product Identity selection.');
        if(Number(run.state_revision)!==body.expectedRunStateRevision)fail('LIBRA_IDENTITY_SELECTION_STALE','Libra Run changed before identity selection.');
        const identities=repo.invoke('list_identity',{subject_id:run.subject_id}),currentRevision=identities.reduce((max,row)=>Math.max(max,Number(row.revision)),0);
        const expected=body.expectedIdentityRevision===null?0:body.expectedIdentityRevision;
        if(currentRevision!==expected)fail('LIBRA_IDENTITY_SELECTION_IDENTITY_STALE','Product Identity head changed before selection.');
        const intents=repo.invoke('list_intents',{libra_run_id:libraRunId}),existing=intents.find((item)=>item.idempotency_key===body.idempotencyKey);
        if(existing){if(existing.intent_digest!==requestDigest)fail('LIBRA_IDENTITY_SELECTION_REPLAY_CONFLICT','Identity selection idempotency key belongs to another request.');
          committedResult=Object.freeze({selectionIntentId:existing.selection_intent_id,libraRunId,provider:'tmdb',namespace:'tmdb_movie',providerKey:existing.provider_key,intentRevision:Number(existing.intent_revision),replayed:true});return committedResult;}
        const intentRevision=intents.reduce((max,row)=>Math.max(max,Number(row.intent_revision)),0)+1,
          selectionIntentId=stable('libra-product-identity-selection-',{libraRunId,intentRevision,requestDigest});
        repo.invoke('insert_intent',{selection_intent_id:selectionIntentId,libra_run_id:libraRunId,intent_revision:intentRevision,selection_kind:'provider_id',provider:'tmdb',namespace:'tmdb_movie',provider_key:body.tmdbMovieId,
          candidate_set_digest:body.candidateSetDigest||null,expected_run_state_revision:body.expectedRunStateRevision,expected_identity_revision:body.expectedIdentityRevision,
          idempotency_key:body.idempotencyKey,intent_digest:requestDigest,created_at_ms:context.commitTimeMs});
        committedResult=Object.freeze({selectionIntentId,libraRunId,provider:'tmdb',namespace:'tmdb_movie',providerKey:body.tmdbMovieId,intentRevision,replayed:false});return committedResult;
      }},{participantId:'identity_selection_receipt',owner:'execution-foundation',boundBusinessOwner:'libra',repositories:[foundation],execute(context){const repo=context.repository(foundation.repositoryId),found=repo.invoke('find_receipt',{owner_domain:'libra',command_contract:COMMAND,caller_scope:callerScope,idempotency_key:body.idempotencyKey});
        const result=committedResult;if(found){if(found.request_digest!==requestDigest||found.target_id!==result.selectionIntentId)fail('LIBRA_IDENTITY_SELECTION_REPLAY_CONFLICT','Identity selection receipt conflicts with the request.');return result;}
        const resultDigest=canonicalDigest(result);repo.invoke('insert_receipt',{command_receipt_id:stable('libra-product-identity-selection-receipt-',{callerScope,idempotencyKey:body.idempotencyKey}),owner_domain:'libra',command_contract:COMMAND,caller_scope:callerScope,idempotency_key:body.idempotencyKey,
          request_digest:requestDigest,target_type:'product_identity_selection_intent',target_id:result.selectionIntentId,result_schema_ref:RESULT_SCHEMA,result_ref_json:canonicalJson(result),result_digest:resultDigest,committed_at_ms:context.commitTimeMs});return result;
      }}]).identity_selection_receipt;
  }
  return Object.freeze({choose,readCurrent:read});
}

module.exports=Object.freeze({ProductIdentitySelectionError,createProductIdentitySelectionService});
