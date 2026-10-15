'use strict';

const { randomUUID,validateProductIntegrationHandle } = require('../../../platform/public/integration-adapter-support');
const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');
const { buildJavQueryAnchor, buildJavSourceSelectionSnapshot, JAV_SITES_BY_CLASS } = require('../../../contracts/jav-source-contracts');
const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');
const { SCHEMA_REF,assertJavIdentitySelectionRecord } = require('../model/jav-identity-selection-record');

const COMMAND = 'libra.choose-product-identity@1';
const RESULT_SCHEMA = 'helix://libra/admin-results/ProductIdentitySelectionIntentReceipt/v1';
const RULE = Object.freeze({ ruleRef:'libra.jav-single-source@1', ruleRevision:1,
  sourcesByClass:JAV_SITES_BY_CLASS, t38First:'javdb', requiredFields:['title'], requiredSourceArtifacts:['cover'] });
const RULE_DIGEST = canonicalDigest(RULE);
const columns = ['selection_intent_id','libra_run_id','intent_revision','selection_kind','provider','namespace','provider_key',
  'candidate_set_digest','expected_run_state_revision','expected_identity_revision','selection_record_schema_ref','selection_record_json',
  'idempotency_key','intent_digest','created_at_ms'];
function fail(code, message) { throw Object.assign(new Error(message), { code }); }
function exact(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key)))
    fail('LIBRA_IDENTITY_SELECTION_INPUT', 'JAV identity input contains unsupported fields.');
}
function stable(prefix, value) { return prefix + canonicalDigest(value).slice(0,40); }

function createJavIdentitySelection(options) {
  const now = options.now || Date.now, previews = new Map();
  const owner = createRepositoryDefinition({ repositoryId:'libra_jav_identity_selection', owner:'libra', schemaManifest:options.schemaManifest, statements:{
    find_run:{kind:'select-one',tableId:'libra_runs',columns:['libra_run_id','subject_id','state','state_revision','execution_basis_digest'],keyColumns:['libra_run_id'],safeIntegers:true},
    find_subject:{kind:'select-one',tableId:'libra_subjects',columns:['subject_id','content_profile'],keyColumns:['subject_id']},
    list_identity:{kind:'select-all',tableId:'libra_product_identity_revisions',columns:['revision','identity_digest'],keyColumns:['subject_id'],safeIntegers:true},
    list_intents:{kind:'select-all',tableId:'libra_product_identity_selection_intents',columns,keyColumns:['libra_run_id'],safeIntegers:true},
    insert_intent:{kind:'insert',tableId:'libra_product_identity_selection_intents',columns},
  } });
  const foundation = createRepositoryDefinition({ repositoryId:'libra_jav_identity_selection_receipt', owner:'execution-foundation', schemaManifest:options.schemaManifest, statements:{
    find_receipt:{kind:'select-one',tableId:'fx_command_receipts',columns:['request_digest','result_ref_json','result_digest'],keyColumns:['owner_domain','command_contract','caller_scope','idempotency_key']},
    insert_receipt:{kind:'insert',tableId:'fx_command_receipts',columns:['command_receipt_id','owner_domain','command_contract','caller_scope','idempotency_key','request_digest','target_type','target_id','result_schema_ref','result_ref_json','result_digest','committed_at_ms']},
  } });
  function context(repo, libraRunId) {
    const run = repo.invoke('find_run',{libra_run_id:libraRunId});
    if (!run) fail('LIBRA_RUN_NOT_FOUND','Libra Run was not found.');
    if (repo.invoke('find_subject',{subject_id:run.subject_id})?.content_profile !== 'jav')
      fail('LIBRA_IDENTITY_SELECTION_INPUT','JAV selection requires a JAV Subject.');
    if (!['active','suspended'].includes(run.state)) fail('LIBRA_IDENTITY_SELECTION_RUN_STATE','JAV selection requires an unfinished Run.');
    if (repo.invoke('list_identity',{subject_id:run.subject_id}).length)
      fail('LIBRA_JAV_IDENTITY_LOCKED','The first formal JAV identity has already locked this Subject.');
    const intents = repo.invoke('list_intents',{libra_run_id:libraRunId});
    return { run, selectionRevision:intents.reduce((max,row)=>Math.max(max,Number(row.intent_revision)),0) };
  }
  function read(libraRunId) {
    return options.unitOfWork.execute([{ participantId:'jav_preview_context',owner:'libra',repositories:[owner],
      execute(ctx) { return context(ctx.repository(owner.repositoryId),libraRunId); } }]).jav_preview_context;
  }
  function assertFence(current, expected) {
    if (current.run.subject_id !== expected.subjectId || current.run.execution_basis_digest !== expected.runExecutionBasisDigest ||
        Number(current.run.state_revision) !== expected.expectedRunStateRevision)
      fail('LIBRA_IDENTITY_SELECTION_STALE','The Run changed after the JAV preview.');
    if (current.selectionRevision !== expected.expectedSelectionIntentRevision)
      fail('LIBRA_IDENTITY_SELECTION_HEAD_STALE','A newer JAV selection superseded this preview.');
  }
  function sourceSnapshot(anchor) {
    const sites = [...JAV_SITES_BY_CLASS[anchor.codeClass]];
    if (/^T38-/.test(anchor.javCode)) sites.sort((a,b)=>Number(b==='javdb')-Number(a==='javdb'));
    const sources = [];
    for (const siteRef of sites) {
      let handle;
      try { handle = options.resolveJavSourceHandle?.({siteRef,operationId:'libra.product_identity.evidence.observe@1'}); }
      catch (error) { if (error.code === 'PLATFORM_INTEGRATION_NOT_CONFIGURED') continue; throw error; }
      if (!handle) continue;
      if (handle.integrationType !== 'jav_source' || handle.siteRef !== siteRef || handle.authMode !== 'anonymous' ||
          handle.allowedOperation !== 'libra.product_identity.evidence.observe@1')
        fail('LIBRA_JAV_SOURCE_HANDLE_INVALID','Configured JAV source returned an incompatible Handle.');
      sources.push({ordinal:sources.length,siteRef,integrationId:handle.integrationId,configRevision:handle.configRevision,
        endpointProfileDigest:handle.endpointProfileDigest,networkRouteDigest:handle.networkRouteDigest,
        authMode:handle.authMode,queryKind:anchor.queryKind});
    }
    if (!sources.length) fail('PLATFORM_INTEGRATION_NOT_CONFIGURED','No eligible JAV source is configured for this code class.');
    return buildJavSourceSelectionSnapshot({ruleRef:RULE.ruleRef,ruleRevision:RULE.ruleRevision,ruleDigest:RULE_DIGEST,queryAnchor:anchor,sources});
  }
  function handleFor(source) {
    const handle = options.resolveJavSourceHandle({siteRef:source.siteRef,operationId:'libra.product_identity.evidence.observe@1'});
    if (!handle || ['integrationId','configRevision','siteRef','endpointProfileDigest','networkRouteDigest','authMode'].some(key=>handle[key]!==source[key]))
      fail('LIBRA_JAV_SOURCE_CONFIG_STALE','JAV source configuration changed after the preview.');
    return handle;
  }
  async function preview(libraRunId, input) {
    if(typeof options.observeJavSourceForPreview!=='function')fail('LIBRA_JAV_PREVIEW_UNAVAILABLE','JAV preview requires its bounded source-cover presentation port.');
    exact(input,['javCode','siteRef','resourceKey']);
    if ((input.siteRef === undefined) !== (input.resourceKey === undefined) ||
        (input.resourceKey !== undefined && (typeof input.resourceKey !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(input.resourceKey))))
      fail('LIBRA_IDENTITY_SELECTION_INPUT','A selected JAV resource requires its source and bounded native key.');
    let queryAnchor;
    try { queryAnchor = buildJavQueryAnchor('jav_code',input.javCode); }
    catch { fail('LIBRA_IDENTITY_SELECTION_INPUT','Enter one complete supported JAV code.'); }
    const initial = read(libraRunId), snapshot = sourceSnapshot(queryAnchor), attempts = [], deadline=now()+90000;
    if (input.siteRef && !snapshot.sources.some(source=>source.siteRef===input.siteRef))
      fail('LIBRA_IDENTITY_SELECTION_INPUT','Selected resource does not belong to an eligible configured source.');
    const fence = {subjectId:initial.run.subject_id,runExecutionBasisDigest:initial.run.execution_basis_digest,
      expectedRunStateRevision:Number(initial.run.state_revision),expectedIdentityRevision:0,expectedSelectionIntentRevision:initial.selectionRevision};
    for (const source of snapshot.sources.filter(item=>!input.siteRef || item.siteRef===input.siteRef)) {
      let observation,previewImage;
      for(let attemptOrdinal=0;attemptOrdinal<2;attemptOrdinal++) {
        const remaining=deadline-now();
        if(remaining<100)fail('LIBRA_JAV_PREVIEW_TIMEOUT','JAV preview exhausted its total source budget.');
        try {
          previewImage = await options.observeJavSourceForPreview({siteRef:source.siteRef,integrationHandle:handleFor(source),timeoutMs:Math.min(30000,remaining),
            input:{queryAnchor,...(input.resourceKey ? {resourceKey:input.resourceKey} : {})}});
          observation=previewImage?.observation;
          break;
        } catch (error) {
          if (!['JAV_SOURCE_UNAVAILABLE','JAV_SOURCE_TIMEOUT','JAV_SOURCE_ACCESS_DENIED','JAV_SOURCE_RESPONSE_TOO_LARGE',
            'JAV_SOURCE_REDIRECT_DENIED','JAV_SOURCE_URL_DENIED','JAV_SOURCE_RESPONSE_INVALID','JAV_SOURCE_CHARSET_INVALID'].includes(error.code)) throw error;
          attempts.push(Object.freeze({siteRef:source.siteRef,attemptOrdinal,result:'unavailable',reasonCode:error.code}));
          if(!['JAV_SOURCE_UNAVAILABLE','JAV_SOURCE_TIMEOUT'].includes(error.code))break;
        }
      }
      if(!observation)continue;
      const body = Object.fromEntries(Object.entries(observation || {}).filter(([key])=>key!=='observationDigest'));
      if (observation?.schema !== 'integration.jav-source-observation@1' || observation.observationDigest !== canonicalDigest(body) ||
          observation.siteRef !== source.siteRef || observation.queryAnchorDigest !== queryAnchor.anchorDigest ||
          observation.endpointProfileDigest !== source.endpointProfileDigest || observation.networkRouteDigest !== source.networkRouteDigest)
        fail('LIBRA_JAV_SOURCE_OBSERVATION_INVALID','JAV observation does not conserve the selected source.');
      attempts.push(Object.freeze({siteRef:source.siteRef,result:observation.result,observationDigest:observation.observationDigest}));
      if (observation.result === 'ambiguous') {
        assertFence(read(libraRunId),fence);
        return Object.freeze({result:'ambiguous',javCode:queryAnchor.javCode,candidates:observation.candidates,attempts:Object.freeze(attempts)});
      }
      if (observation.result !== 'qualified') continue;
      const identity = observation.resolvedProviderIdentity, title = observation.descriptiveEntries?.find(entry=>entry.key==='title')?.value;
      if (identity?.provider !== 'jav' || identity.namespace !== 'jav_code' || identity.providerKey !== queryAnchor.javCode ||
          typeof title !== 'string' || !title.trim() || !/^[a-f0-9]{64}$/.test(observation.cover?.byteDigest || '') ||
          !Number.isSafeInteger(observation.cover?.byteCount) || observation.cover.byteCount < 1)
        fail('LIBRA_JAV_SOURCE_OBSERVATION_INVALID','JAV preview requires exact identity, meaningful title and qualified cover.');
      if(previewImage.sourceCoverDigest!==observation.cover.byteDigest||typeof previewImage.posterUrl!=='string'||
          previewImage.posterUrl.length>65536||!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(previewImage.posterUrl))
        fail('LIBRA_JAV_SOURCE_OBSERVATION_INVALID','JAV preview image must bind the qualified same-site cover.');
      assertFence(read(libraRunId),fence);
      const candidateSetDigest = canonicalDigest({queryAnchor,sourceSnapshotDigest:snapshot.snapshotDigest,
        source,resourceKey:observation.resourceKey,title,coverDigest:observation.cover.byteDigest});
      const proof = {schema:'libra.jav-identity-selection-record@1',libraRunId,...fence,sourceSnapshot:snapshot,
        selectedSourceOrdinal:source.ordinal,resourceKey:observation.resourceKey,
        resourceLocatorDigest:canonicalDigest({siteRef:source.siteRef,resourceKey:observation.resourceKey}),
        candidateSetDigest,qualificationObservation:observation};
      if (Buffer.byteLength(canonicalJson(proof),'utf8') > 64*1024)
        fail('LIBRA_JAV_PREVIEW_TOO_LARGE','JAV preview proof exceeds its byte budget.');
      const clock = now();
      for (const [key,value] of previews) if(value.expiresAtMs <= clock) previews.delete(key);
      if (previews.size >= 256) previews.delete(previews.keys().next().value);
      const previewId = randomUUID(); previews.set(previewId,{proof,expiresAtMs:clock+600000});
      return Object.freeze({result:'qualified',javCode:queryAnchor.javCode,displayTitle:title,posterUrl:previewImage.posterUrl,
        siteRef:source.siteRef,resourceKey:observation.resourceKey,candidateSetDigest,previewId,...fence,attempts:Object.freeze(attempts)});
    }
    assertFence(read(libraRunId),fence);
    return Object.freeze({result:'not_qualified',javCode:queryAnchor.javCode,attempts:Object.freeze(attempts)});
  }
  function choose(libraRunId, body, actor) {
    exact(body,['javCode','previewId','candidateSetDigest','expectedRunStateRevision','expectedIdentityRevision',
      'expectedSelectionIntentRevision','idempotencyKey']);
    let anchor;
    try { anchor = buildJavQueryAnchor('jav_code',body.javCode); }
    catch { fail('LIBRA_IDENTITY_SELECTION_INPUT','JAV selection requires a complete canonical code.'); }
    if (typeof body.idempotencyKey !== 'string' || !body.idempotencyKey || body.idempotencyKey.length>256 ||
        typeof body.previewId !== 'string' || body.previewId.length>64 || !/^[a-f0-9]{64}$/.test(body.candidateSetDigest || '') ||
        !Number.isSafeInteger(body.expectedRunStateRevision) || body.expectedRunStateRevision<1 || body.expectedIdentityRevision!==0 ||
        !Number.isSafeInteger(body.expectedSelectionIntentRevision) || body.expectedSelectionIntentRevision<0)
      fail('LIBRA_IDENTITY_SELECTION_INPUT','JAV confirmation requires the exact preview and Run/selection fences.');
    const requestDigest = canonicalDigest({libraRunId,...body,javCode:anchor.javCode}), callerScope='libra_run:'+libraRunId;
    const receiptKey = {owner_domain:'libra',command_contract:COMMAND,caller_scope:callerScope,idempotency_key:body.idempotencyKey};
    // Replay is independent of preview expiry, current state and the identity lock.
    const replay = options.unitOfWork.execute([{participantId:'jav_selection_replay',owner:'execution-foundation',boundBusinessOwner:'libra',repositories:[foundation],execute(ctx){
      const row=ctx.repository(foundation.repositoryId).invoke('find_receipt',receiptKey);
      if(!row)return null;
      if(row.request_digest!==requestDigest)fail('LIBRA_IDENTITY_SELECTION_REPLAY_CONFLICT','JAV selection key belongs to another request.');
      const result=JSON.parse(row.result_ref_json);
      if(canonicalDigest(result)!==row.result_digest)fail('LIBRA_IDENTITY_SELECTION_RECEIPT_INVALID','JAV selection receipt digest is invalid.');
      return Object.freeze({...result,replayed:true});
    }}]).jav_selection_replay;
    if(replay)return replay;
    // A new command cannot reopen identity selection after formal confirmation.
    read(libraRunId);
    const preview=previews.get(body.previewId);
    if(!preview || preview.expiresAtMs<=now())fail('LIBRA_JAV_PREVIEW_EXPIRED','Query the JAV identity again before confirming.');
    const proof=preview.proof;
    if(proof.libraRunId!==libraRunId || proof.sourceSnapshot.queryAnchor.anchorDigest!==anchor.anchorDigest ||
        proof.candidateSetDigest!==body.candidateSetDigest || ['expectedRunStateRevision','expectedIdentityRevision','expectedSelectionIntentRevision'].some(key=>proof[key]!==body[key]))
      fail('LIBRA_JAV_PREVIEW_MISMATCH','JAV confirmation does not match the server preview.');
    handleFor(proof.sourceSnapshot.sources[proof.selectedSourceOrdinal]);
    let result;
    return options.unitOfWork.execute([{participantId:'jav_selection_owner',owner:'libra',repositories:[owner],execute(ctx){
      const repo=ctx.repository(owner.repositoryId),current=context(repo,libraRunId);assertFence(current,proof);
      const revision=current.selectionRevision+1,selectionIntentId=stable('libra-product-identity-selection-',{libraRunId,revision,requestDigest});
      const record={...proof,previewId:body.previewId,actorRef:typeof actor?.actorId==='string'?actor.actorId:'admin_web',intentRevision:revision,idempotencyKey:body.idempotencyKey};
      assertJavIdentitySelectionRecord(record);
      repo.invoke('insert_intent',{selection_intent_id:selectionIntentId,libra_run_id:libraRunId,intent_revision:revision,
        selection_kind:'provider_id',provider:'jav',namespace:'jav_code',provider_key:anchor.javCode,candidate_set_digest:proof.candidateSetDigest,
        expected_run_state_revision:body.expectedRunStateRevision,expected_identity_revision:null,
        selection_record_schema_ref:SCHEMA_REF,selection_record_json:canonicalJson(record),
        idempotency_key:body.idempotencyKey,intent_digest:requestDigest,created_at_ms:ctx.commitTimeMs});
      result=Object.freeze({selectionIntentId,libraRunId,provider:'jav',namespace:'jav_code',providerKey:anchor.javCode,intentRevision:revision,
        selectionRecordDigest:canonicalDigest(record),replayed:false});return result;
    }},{participantId:'jav_selection_receipt',owner:'execution-foundation',boundBusinessOwner:'libra',repositories:[foundation],execute(ctx){
      ctx.repository(foundation.repositoryId).invoke('insert_receipt',{...receiptKey,
        command_receipt_id:stable('libra-product-identity-selection-receipt-',{callerScope,idempotencyKey:body.idempotencyKey}),
        request_digest:requestDigest,target_type:'product_identity_selection_intent',target_id:result.selectionIntentId,
        result_schema_ref:RESULT_SCHEMA,result_ref_json:canonicalJson(result),result_digest:canonicalDigest(result),committed_at_ms:ctx.commitTimeMs});return result;
    }}]).jav_selection_receipt;
  }
  return Object.freeze({preview,choose,snapshotSources:sourceSnapshot,resolveSourceHandle:handleFor,
    validateSourceHandleEvidence(handle,binding,observedAtMs,operationId) {
      return validateProductIntegrationHandle(handle,{...binding,integrationType:'jav_source',secretRef:null,allowedOperation:operationId,artifactKind:null},observedAtMs);
    }});
}

module.exports=Object.freeze({createJavIdentitySelection});
