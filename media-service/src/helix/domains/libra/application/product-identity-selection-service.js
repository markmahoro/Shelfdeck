'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');
const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');

const { frozenSeriesSeasonNumber } = require('../model/series-identity-contracts');
const { createJavIdentitySelection } = require('./jav-identity-selection');
const { SCHEMA_REF:JAV_SELECTION_SCHEMA,assertJavIdentitySelectionRecord } = require('../model/jav-identity-selection-record');

const COMMAND = 'libra.choose-product-identity@1';
const RESULT_SCHEMA = 'helix://libra/admin-results/ProductIdentitySelectionIntentReceipt/v1';

class ProductIdentitySelectionError extends Error {
  constructor(code, message, details = {}) { super(message); this.name='ProductIdentitySelectionError'; this.code=code; this.details=details; }
}
function fail(code,message,details){throw new ProductIdentitySelectionError(code,message,details);}
function stable(prefix,value){return prefix+canonicalDigest(value).slice(0,40);}
function validMovieId(value) { return typeof value === 'string' && /^[1-9]\d{0,14}$/.test(value) && Number.isSafeInteger(Number(value)); }

function createProductIdentitySelectionService(options) {
  if(!options?.schemaManifest||!options.unitOfWork)fail('LIBRA_IDENTITY_SELECTION_DEPENDENCIES','Product Identity selection requires Owner persistence.');
  const jav = createJavIdentitySelection(options);
  const owner=createRepositoryDefinition({repositoryId:'libra_product_identity_selection',owner:'libra',schemaManifest:options.schemaManifest,statements:{
    find_run:{kind:'select-one',tableId:'libra_runs',columns:['libra_run_id','subject_id','state','state_revision','execution_basis_digest'],keyColumns:['libra_run_id'],safeIntegers:true},
    find_subject:{kind:'select-one',tableId:'libra_subjects',columns:['subject_id','content_profile'],keyColumns:['subject_id']},
    list_identity:{kind:'select-all',tableId:'libra_product_identity_revisions',columns:['subject_id','revision','identity_digest'],keyColumns:['subject_id'],safeIntegers:true},
    list_intents:{kind:'select-all',tableId:'libra_product_identity_selection_intents',columns:['selection_intent_id','libra_run_id','intent_revision','selection_kind','provider','namespace','provider_key','candidate_set_digest','expected_run_state_revision','expected_identity_revision','selection_record_schema_ref','selection_record_json','idempotency_key','intent_digest','created_at_ms'],keyColumns:['libra_run_id'],safeIntegers:true},
    insert_intent:{kind:'insert',tableId:'libra_product_identity_selection_intents',columns:['selection_intent_id','libra_run_id','intent_revision','selection_kind','provider','namespace','provider_key','candidate_set_digest','expected_run_state_revision','expected_identity_revision','idempotency_key','intent_digest','created_at_ms']},
  }});
  const foundation=createRepositoryDefinition({repositoryId:'libra_product_identity_selection_receipt',owner:'execution-foundation',schemaManifest:options.schemaManifest,statements:{
    find_receipt:{kind:'select-one',tableId:'fx_command_receipts',columns:['command_receipt_id','request_digest','target_id','result_ref_json','result_digest'],keyColumns:['owner_domain','command_contract','caller_scope','idempotency_key']},
    insert_receipt:{kind:'insert',tableId:'fx_command_receipts',columns:['command_receipt_id','owner_domain','command_contract','caller_scope','idempotency_key','request_digest','target_type','target_id','result_schema_ref','result_ref_json','result_digest','committed_at_ms']},
  }});
  function read(libraRunId){return options.unitOfWork.execute([{participantId:'identity_selection_read',owner:'libra',repositories:[owner],execute(context){
    const rows=context.repository(owner.repositoryId).invoke('list_intents',{libra_run_id:libraRunId}).sort((a,b)=>Number(a.intent_revision)-Number(b.intent_revision));
    const row=rows.at(-1);
    if(row?.provider==='jav') {
      if(row.selection_record_schema_ref!==JAV_SELECTION_SCHEMA)fail('LIBRA_JAV_SELECTION_RECORD_INVALID','JAV selection record schema is invalid.');
      const record=assertJavIdentitySelectionRecord(JSON.parse(row.selection_record_json));
      const requestDigest=canonicalDigest({libraRunId:record.libraRunId,javCode:record.sourceSnapshot.queryAnchor.javCode,
        previewId:record.previewId,candidateSetDigest:record.candidateSetDigest,expectedRunStateRevision:record.expectedRunStateRevision,
        expectedIdentityRevision:0,expectedSelectionIntentRevision:record.expectedSelectionIntentRevision,idempotencyKey:record.idempotencyKey});
      if(record.libraRunId!==row.libra_run_id || record.intentRevision!==Number(row.intent_revision) ||
          record.sourceSnapshot.queryAnchor.javCode!==row.provider_key || record.candidateSetDigest!==row.candidate_set_digest ||
          record.expectedRunStateRevision!==Number(row.expected_run_state_revision) || record.idempotencyKey!==row.idempotency_key ||
          requestDigest!==row.intent_digest || row.expected_identity_revision!==null || row.selection_kind!=='provider_id' ||
          row.namespace!=='jav_code')fail('LIBRA_JAV_SELECTION_RECORD_INVALID','JAV selection index differs from its immutable record.');
    }
    return row?Object.freeze({...row,intent_revision:Number(row.intent_revision),expected_run_state_revision:Number(row.expected_run_state_revision),
      expected_identity_revision:row.expected_identity_revision===null?null:Number(row.expected_identity_revision),created_at_ms:Number(row.created_at_ms)}):null;
  }}]).identity_selection_read;}
  function selectionTarget(libraRunId, body) {
    const allowed = ['tmdbMovieId','tmdbSeriesId','idempotencyKey','expectedRunStateRevision','expectedIdentityRevision','candidateSetDigest'];
    if (!body || typeof body !== 'object' || Object.keys(body).some(key => !allowed.includes(key)))
      fail('LIBRA_IDENTITY_SELECTION_INPUT', 'Identity selection contains unsupported fields.');
    const series = Object.hasOwn(body || {}, 'tmdbSeriesId');
    if (Object.hasOwn(body || {}, 'seasonNumber') || Object.hasOwn(body || {}, 'episodeNumbers') ||
        (series && Object.hasOwn(body, 'tmdbMovieId')) || !validMovieId(series ? body.tmdbSeriesId : body?.tmdbMovieId))
      fail('LIBRA_IDENTITY_SELECTION_INPUT', 'Choose exactly one positive TMDB ID; Season and Episodes remain frozen.');
    if (!series) return { contentProfile:'movie', namespace:'tmdb_movie', providerKey:body.tmdbMovieId };
    const snapshot = options.movieProductionReader?.readRunSnapshot(libraRunId);
    if (!snapshot || snapshot.run?.libraRunId !== libraRunId)
      fail('LIBRA_IDENTITY_SELECTION_INPUT', 'Series selection requires the current frozen Run.');
    let seasonNumber;
    try { seasonNumber = frozenSeriesSeasonNumber(snapshot); }
    catch { fail('LIBRA_IDENTITY_SELECTION_INPUT', 'Series selection requires a verified frozen Season claim.'); }
    return { contentProfile:'series', namespace:'tmdb_series', providerKey:body.tmdbSeriesId,
      seasonNumber, executionBasisDigest:snapshot.run.executionBasisDigest };
  }
  function assertTarget(repo, run, target) {
    const subject = repo.invoke('find_subject', {subject_id:run.subject_id});
    if (subject?.content_profile !== target.contentProfile ||
        (target.contentProfile === 'series' && run.execution_basis_digest !== target.executionBasisDigest))
      fail('LIBRA_IDENTITY_SELECTION_INPUT', 'Identity selection must match the frozen Run profile and basis.');
  }
  function choose(libraRunId, body, actor) {
    if (Object.hasOwn(body || {}, 'javCode')) return jav.choose(libraRunId,body,actor);
    const target = selectionTarget(libraRunId, body);
    if(!body||typeof body.idempotencyKey!=='string'||!body.idempotencyKey||!Number.isSafeInteger(body.expectedRunStateRevision)||
        !(body.expectedIdentityRevision===null||Number.isSafeInteger(body.expectedIdentityRevision))||
        !validMovieId(target.providerKey))
      fail('LIBRA_IDENTITY_SELECTION_INPUT','Identity selection requires an exact Run/Identity fence, idempotency key, and TMDB Movie ID.');
    const request={libraRunId,idempotencyKey:body.idempotencyKey,expectedRunStateRevision:body.expectedRunStateRevision,
      expectedIdentityRevision:body.expectedIdentityRevision,...(target.contentProfile==='series'?{tmdbSeriesId:target.providerKey,seasonNumber:target.seasonNumber,executionBasisDigest:target.executionBasisDigest}:{tmdbMovieId:target.providerKey}),candidateSetDigest:body.candidateSetDigest||null};
    const requestDigest=canonicalDigest(request),callerScope='libra_run:'+libraRunId;
    let committedResult;
    return options.unitOfWork.execute([{
      participantId:'identity_selection_owner',owner:'libra',repositories:[owner],execute(context){const repo=context.repository(owner.repositoryId),run=repo.invoke('find_run',{libra_run_id:libraRunId});
        if(!run)fail('LIBRA_RUN_NOT_FOUND','Libra Run was not found.');
        assertTarget(repo, run, target);
        if(!['active','suspended'].includes(run.state))fail('LIBRA_IDENTITY_SELECTION_RUN_STATE','Only a current unfinished Libra Run accepts Product Identity selection.');
        if(Number(run.state_revision)!==body.expectedRunStateRevision)fail('LIBRA_IDENTITY_SELECTION_STALE','Libra Run changed before identity selection.');
        const identities=repo.invoke('list_identity',{subject_id:run.subject_id}),currentRevision=identities.reduce((max,row)=>Math.max(max,Number(row.revision)),0);
        const expected=body.expectedIdentityRevision===null?0:body.expectedIdentityRevision;
        if(currentRevision!==expected)fail('LIBRA_IDENTITY_SELECTION_IDENTITY_STALE','Product Identity head changed before selection.');
        const intents=repo.invoke('list_intents',{libra_run_id:libraRunId}),existing=intents.find((item)=>item.idempotency_key===body.idempotencyKey);
        if(existing){if(existing.intent_digest!==requestDigest)fail('LIBRA_IDENTITY_SELECTION_REPLAY_CONFLICT','Identity selection idempotency key belongs to another request.');
          committedResult=Object.freeze({selectionIntentId:existing.selection_intent_id,libraRunId,provider:'tmdb',namespace:target.namespace,providerKey:existing.provider_key,...(target.contentProfile==='series'?{seasonNumber:target.seasonNumber}:{}),intentRevision:Number(existing.intent_revision),replayed:true});return committedResult;}
        const intentRevision=intents.reduce((max,row)=>Math.max(max,Number(row.intent_revision)),0)+1,
          selectionIntentId=stable('libra-product-identity-selection-',{libraRunId,intentRevision,requestDigest});
        repo.invoke('insert_intent',{selection_intent_id:selectionIntentId,libra_run_id:libraRunId,intent_revision:intentRevision,selection_kind:'provider_id',provider:'tmdb',namespace:target.namespace,provider_key:target.providerKey,
          candidate_set_digest:body.candidateSetDigest||null,expected_run_state_revision:body.expectedRunStateRevision,expected_identity_revision:body.expectedIdentityRevision,
          idempotency_key:body.idempotencyKey,intent_digest:requestDigest,created_at_ms:context.commitTimeMs});
        committedResult=Object.freeze({selectionIntentId,libraRunId,provider:'tmdb',namespace:target.namespace,providerKey:target.providerKey,...(target.contentProfile==='series'?{seasonNumber:target.seasonNumber}:{}),intentRevision,replayed:false});return committedResult;
      }},{participantId:'identity_selection_receipt',owner:'execution-foundation',boundBusinessOwner:'libra',repositories:[foundation],execute(context){const repo=context.repository(foundation.repositoryId),found=repo.invoke('find_receipt',{owner_domain:'libra',command_contract:COMMAND,caller_scope:callerScope,idempotency_key:body.idempotencyKey});
        const result=committedResult;if(found){if(found.request_digest!==requestDigest||found.target_id!==result.selectionIntentId)fail('LIBRA_IDENTITY_SELECTION_REPLAY_CONFLICT','Identity selection receipt conflicts with the request.');return result;}
        const resultDigest=canonicalDigest(result);repo.invoke('insert_receipt',{command_receipt_id:stable('libra-product-identity-selection-receipt-',{callerScope,idempotencyKey:body.idempotencyKey}),owner_domain:'libra',command_contract:COMMAND,caller_scope:callerScope,idempotency_key:body.idempotencyKey,
          request_digest:requestDigest,target_type:'product_identity_selection_intent',target_id:result.selectionIntentId,result_schema_ref:RESULT_SCHEMA,result_ref_json:canonicalJson(result),result_digest:resultDigest,committed_at_ms:context.commitTimeMs});return result;
      }}]).identity_selection_receipt;
  }
  async function preview(libraRunId, id) {
    if (Object.hasOwn(id || {}, 'javCode')) return jav.preview(libraRunId,id);
    const target = selectionTarget(libraRunId, typeof id === 'string' ? {tmdbMovieId:id} : id);
    options.unitOfWork.execute([{ participantId:'identity_preview_read', owner:'libra', repositories:[owner], execute(context) {
      const run = context.repository(owner.repositoryId).invoke('find_run', {libra_run_id:libraRunId});
      if (!run) fail('LIBRA_RUN_NOT_FOUND', 'Libra Run was not found.');
      assertTarget(context.repository(owner.repositoryId), run, target);
      if (!['active','suspended'].includes(run.state)) fail('LIBRA_IDENTITY_SELECTION_RUN_STATE', 'Only an unfinished Run accepts identity selection.');
    }}]);
    const handle = options.resolveRoutingIntegrationHandle?.({providerKind:'tmdb',integrationId:'tmdb-main',operationId:'libra.product_identity.evidence.observe@1'});
    if (!handle) fail('PLATFORM_INTEGRATION_NOT_CONFIGURED', 'TMDB integration is not configured.');
    const candidates = await options.observeRoutingProvider({integrationHandle:handle, operationId:'libra.product_identity.evidence.observe@1',
      intent:{contentProfile:target.contentProfile,candidateDisplayTitle:target.providerKey,yearHint:null,strongProviderAnchor:{providerKey:target.providerKey},...(target.contentProfile==='series'?{seasonNumber:target.seasonNumber}:{})}});
    const movie = candidates.find(candidate => candidate.providerKey === target.providerKey && (target.contentProfile !== 'series' || (candidate.namespace === 'tmdb_series' && candidate.seasonNumber === target.seasonNumber)));
    if (!movie) fail('LIBRA_IDENTITY_PREVIEW_NOT_FOUND', 'TMDB Movie was not found.');
    return Object.freeze({... (target.contentProfile==='series'?{tmdbSeriesId:target.providerKey,seasonNumber:target.seasonNumber}:{tmdbMovieId:target.providerKey}),displayTitle:movie.title,originalTitle:movie.originalTitle || null,releaseYear:movie.releaseYear,
      posterUrl:movie.posterUrl || null});
  }
  return Object.freeze({choose,preview,readCurrent:read,snapshotJavSources:jav.snapshotSources,resolveJavSourceHandle:jav.resolveSourceHandle,
    validateJavSourceHandleEvidence:jav.validateSourceHandleEvidence});
}

module.exports=Object.freeze({ProductIdentitySelectionError,createProductIdentitySelectionService});
