'use strict';

const {canonicalDigest, canonicalJson} = require('../../../contracts/canonical-json');
const {createRepositoryDefinition} = require('../../../foundation/persistence/owner-repository');
const {createCommandCommitCoordinator}=require('../../../foundation/persistence/commit-foundation');
const {relevantRecoveryConditions}=require('../model/failure-recovery-conditions');
const SCHEMA_REF = 'helix://contracts/application-types/LibraRunOutcome/v1';
const COLUMNS = ['libra_run_id','subject_id','outcome','reason_code','stable_input_digest','requirements_digest',
  'conditions_digest','outcome_schema_ref','outcome_json','outcome_digest','committed_at_ms'];
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};

function stableInputDigest(members) {
  const values=members.map(item=>({materialKey:item.materialKey || item.material_key,
    role:item.role}));
  if(!values.length || values.some(item=>!/^[a-f0-9]{64}$/.test(item.materialKey || '')))
    fail('LIBRA_OUTCOME_INPUT_INCOMPLETE','Terminal outcome requires exact physical input identities.');
  values.sort((a,b)=>a.materialKey.localeCompare(b.materialKey)||a.role.localeCompare(b.role));
  return canonicalDigest(values);
}

function createRunOutcomeStore(options) {
  function recoveryConditions(reasons) {
    const values=options.readFailureRecoveryConditions?.(relevantRecoveryConditions(reasons))||[];
    if(!Array.isArray(values)||values.length>8||values.some(value=>!['moviepilot','tmdb','media_compute'].includes(value.conditionKind)||
        !/^[a-f0-9]{64}$/.test(value.snapshotDigest||'')))fail('LIBRA_OUTCOME_CONDITIONS_INVALID','Failure recovery conditions must be bounded owner projections.');
    return values.map(value=>({conditionKind:value.conditionKind,snapshotDigest:value.snapshotDigest}))
      .sort((a,b)=>a.conditionKind.localeCompare(b.conditionKind));
  }
  const repository=createRepositoryDefinition({repositoryId:'libra_run_outcomes',owner:'libra',schemaManifest:options.schemaManifest,statements:{
    pending_committed:{kind:'select-joined-page',tableId:'libra_runs',maxItems:101,columns:['libra_run_id'],
      joins:[{tableId:'libra_run_outcomes',alias:'outcome',on:[{column:'libra_run_id',otherAlias:'base',otherColumn:'libra_run_id'}]}],
      filters:[{column:'state',kind:'equals',parameter:'state'},{column:'libra_run_id',kind:'greater_than',parameter:'cursor'},
        {alias:'outcome',column:'libra_run_id',kind:'is_null'}],orderBy:[{column:'libra_run_id',direction:'asc'}]},
    find:{kind:'select-one',tableId:'libra_run_outcomes',columns:COLUMNS,keyColumns:['libra_run_id'],safeIntegers:true},
    matching:{kind:'select-all',tableId:'libra_run_outcomes',columns:COLUMNS,keyColumns:['stable_input_digest','requirements_digest'],safeIntegers:true},
    input_history:{kind:'select-all',tableId:'libra_run_outcomes',columns:COLUMNS,keyColumns:['stable_input_digest'],safeIntegers:true},
    insert:{kind:'insert',tableId:'libra_run_outcomes',columns:COLUMNS},
    run:{kind:'select-one',tableId:'libra_runs',columns:['libra_run_id','subject_id','state','acceptance_spec_id','run_material_manifest_id'],keyColumns:['libra_run_id']},
    packages:{kind:'select-all',tableId:'libra_product_packages',columns:['on_deck_package_id','offer_id','package_digest','attestation_json','state'],keyColumns:['libra_run_id']},
    delivery_receipt:{kind:'select-one',tableId:'libra_delivery_receipts',columns:['receipt_id','offer_id','on_deck_package_id','package_digest','result','rejection_digest','closure_digest'],keyColumns:['offer_id']},
    members:{kind:'select-all',tableId:'libra_run_material_members',columns:['material_key','role','origin_intake_decision_id'],keyColumns:['run_material_manifest_id']},
    intake:{kind:'select-one',tableId:'libra_intake_decisions',columns:['source_field_id'],keyColumns:['intake_decision_id']},
    spec:{kind:'select-one',tableId:'libra_acceptance_specs',columns:['acceptance_spec_id','spec_json','record_digest'],keyColumns:['acceptance_spec_id']},
    revision:{kind:'select-one',tableId:'libra_run_revisions',columns:['transition_evidence_json','transition_evidence_digest'],keyColumns:['libra_run_id','state_revision']},
    intents:{kind:'select-all',tableId:'libra_reprocess_intents',columns:['intent_id','stable_input_digest','previous_outcome_digest','actor_id','idempotency_key','intent_digest','issued_at_ms'],keyColumns:['stable_input_digest'],safeIntegers:true},
    intent_key:{kind:'select-one',tableId:'libra_reprocess_intents',columns:['intent_id','intent_digest'],keyColumns:['actor_id','idempotency_key']},
    insert_intent:{kind:'insert',tableId:'libra_reprocess_intents',columns:['intent_id','stable_input_digest','previous_outcome_digest','actor_id','idempotency_key','intent_digest','issued_at_ms']},
  }});
  const read=execute=>options.unitOfWork.execute([{participantId:'libra_outcome_read',owner:'libra',repositories:[repository],execute}]).libra_outcome_read;
  function value(row){if(!row)return null;const result=JSON.parse(row.outcome_json);
    if(canonicalDigest(result)!==row.outcome_digest)fail('LIBRA_OUTCOME_CORRUPT','Terminal outcome digest is invalid.');
    return Object.freeze({...result,outcomeDigest:row.outcome_digest});}
  const get=libraRunId=>read(context=>value(context.repository(repository.repositoryId).invoke('find',{libra_run_id:libraRunId})));
  const listPendingCommitted=(cursor,limit)=>read(context=>context.repository(repository.repositoryId).invoke('pending_committed',{
    state:'completed',cursor:cursor||'',offset:0,limit}).map(row=>({libraRunId:row.libra_run_id})));
  function reconcileCommitted(libraRunId) {
    const previous=get(libraRunId);
    if(previous)return previous;
    const packages=read(context=>context.repository(repository.repositoryId).invoke('packages',{libra_run_id:libraRunId}));
    if(!packages.length || !options.readArcaFormationStatus)return null;
    const statuses=options.readArcaFormationStatus(packages.map(item=>item.offer_id));
    const committed=packages.map(pkg=>({pkg,receipt:statuses.get(pkg.offer_id)?.onDeckCommitReceipt})).filter(item=>item.receipt);
    if(!committed.length)return null;
    if(committed.length!==1)fail('LIBRA_OUTCOME_COMMIT_AMBIGUOUS','Movie outcome requires exactly one committed package.');
    const {pkg,receipt}=committed[0];
    if(receipt.receiptKind!=='on_deck_committed'||receipt.ownerDomain!=='arca'||receipt.onDeckPackageId!==pkg.on_deck_package_id||receipt.packageDigest!==pkg.package_digest)
      fail('LIBRA_OUTCOME_COMMIT_STALE','Arca completion does not match the delivered package.');
    return options.unitOfWork.execute([{participantId:'libra_success_outcome',owner:'libra',repositories:[repository],execute(context){
      const repo=context.repository(repository.repositoryId),existing=repo.invoke('find',{libra_run_id:libraRunId});
      if(existing)return value(existing);
      const run=repo.invoke('run',{libra_run_id:libraRunId});
      if(run?.state!=='completed')fail('LIBRA_OUTCOME_RUN_INCOMPLETE','Delivered Run has not completed its responsibility handoff.');
      const spec=repo.invoke('spec',{acceptance_spec_id:run.acceptance_spec_id});
      const attestation=JSON.parse(pkg.attestation_json);
      const manifest=attestation.authorizedDefectManifest;
      const body={schemaRef:SCHEMA_REF,schemaVersion:1,libraRunId,subjectId:run.subject_id,
        outcome:manifest?'on_deck_with_defects':'on_deck',reasonCode:manifest?'accepted_defects':'requirements_met',
        stableInputDigest:stableInputDigest(repo.invoke('members',{run_material_manifest_id:run.run_material_manifest_id})),
        requirementsDigest:canonicalDigest(JSON.parse(spec.spec_json).requirements),
        conditionsDigest:canonicalDigest({packageDigest:pkg.package_digest,attestationDigest:attestation.attestationDigest}),
        onDeckCommitReceipt:receipt,authorizedDefectManifest:manifest||null,committedAtMs:receipt.committedAtMs};
      const json=canonicalJson(body);
      if(Buffer.byteLength(json)>65536)fail('LIBRA_OUTCOME_TOO_LARGE','Terminal outcome exceeds 64 KiB.');
      repo.invoke('insert',{libra_run_id:libraRunId,subject_id:run.subject_id,outcome:body.outcome,reason_code:body.reasonCode,
        stable_input_digest:body.stableInputDigest,requirements_digest:body.requirementsDigest,conditions_digest:body.conditionsDigest,
        outcome_schema_ref:SCHEMA_REF,outcome_json:json,outcome_digest:canonicalDigest(body),committed_at_ms:body.committedAtMs});
      return Object.freeze({...body,outcomeDigest:canonicalDigest(body)});
    }}]).libra_success_outcome;
  }
  function failureParticipant(ready, receipt, reasonCode, productEvidence = null) {
    if(productEvidence && (productEvidence.libraRunId!==ready.run.libra_run_id ||
        productEvidence.runStateRevision!==Number(ready.run.state_revision) || productEvidence.runStateDigest!==ready.run.state_digest ||
        !/^[a-f0-9]{64}$/.test(productEvidence.verificationDigest||'') || !productEvidence.verificationId ||
        !Array.isArray(productEvidence.reasonCodes) || !productEvidence.reasonCodes.length || productEvidence.reasonCodes.length>32))
      fail('LIBRA_OUTCOME_EVIDENCE_STALE','Product verification must belong to the exact Run revision being closed.');
    const terminalRevision=read(context=>context.repository(repository.repositoryId).invoke('revision',{
      libra_run_id:ready.run.libra_run_id,state_revision:Number(ready.run.state_revision)}));
    if(!terminalRevision)fail('LIBRA_OUTCOME_EVIDENCE_MISSING','Terminal outcome requires the current Run revision.');
    const terminalEvidence=JSON.parse(terminalRevision.transition_evidence_json);
    const strategyReasons=terminalEvidence.availabilityId?[{failureClass:'strategy_unavailable',failureCode:terminalEvidence.reasonCode,
      capabilityRef:terminalEvidence.strategyKind==='tmdb'?'libra.product_metadata.fetch@1':'libra.external_material.search@1'}]:[];
    const rejectedDelivery=read(context=>{
      const repo=context.repository(repository.repositoryId);
      const receipts=repo.invoke('packages',{libra_run_id:ready.run.libra_run_id}).filter(pkg=>pkg.state==='published')
        .map(pkg=>({pkg,receipt:repo.invoke('delivery_receipt',{offer_id:pkg.offer_id})}))
        .filter(item=>item.receipt?.result==='rejected');
      if(!receipts.length)return null;
      const {pkg,receipt}=receipts.at(-1);
      if(receipt.on_deck_package_id!==pkg.on_deck_package_id||receipt.package_digest!==pkg.package_digest||
          !/^[a-f0-9]{64}$/.test(receipt.rejection_digest||'')||!/^[a-f0-9]{64}$/.test(receipt.closure_digest||''))
        fail('LIBRA_OUTCOME_EVIDENCE_STALE','Rejected delivery must match its immutable published package.');
      return receipt;
    });
    const deliveryReasons=rejectedDelivery?[{failureClass:'business_unachievable',failureCode:'handoff_b_rejected',
      capabilityRef:'libra.product_package.publish@1'}]:[];
    const conditions=recoveryConditions([...(terminalEvidence.blockedWorks||[]),...strategyReasons,...deliveryReasons]);
    return {participantId:'libra_run_outcome_commit',owner:'libra',repositories:[repository],execute(context){
      const repo=context.repository(repository.repositoryId),run=ready.run;
      const existing=repo.invoke('find',{libra_run_id:run.libra_run_id});
      if(existing)fail('LIBRA_OUTCOME_ALREADY_COMMITTED','A Run already has a terminal business result.');
      const spec=repo.invoke('spec',{acceptance_spec_id:run.acceptance_spec_id});
      const revision=repo.invoke('revision',{libra_run_id:run.libra_run_id,state_revision:Number(run.state_revision)});
      if(!spec || !revision)fail('LIBRA_OUTCOME_EVIDENCE_MISSING','Terminal outcome requires the original requirements and terminal evidence.');
      if(revision.transition_evidence_digest!==terminalRevision.transition_evidence_digest)
        fail('LIBRA_OUTCOME_EVIDENCE_STALE','Failure evidence changed before its terminal commit.');
      const terminal=JSON.parse(revision.transition_evidence_json),requirements=JSON.parse(spec.spec_json).requirements;
      const reasons=[...(productEvidence?.reasonCodes||[]).map(code=>({failureClass:'business_unachievable',failureCode:code,
        capabilityRef:'libra.product_media.verify@1'})),...(terminal.blockedWorks || []).map(item=>({failureClass:item.failureClass,failureCode:item.failureCode,
        capabilityRef:item.capabilityRef})),...strategyReasons,...deliveryReasons];
      if(reasonCode!=='user_cancelled' && !reasons.length && !terminal.assessmentId)
        fail('LIBRA_OUTCOME_EVIDENCE_MISSING','Automatic termination requires a persisted exhausted attempt.');
      const outcome={schemaRef:SCHEMA_REF,schemaVersion:1,libraRunId:run.libra_run_id,subjectId:run.subject_id,
        outcome:'unable_to_on_deck',reasonCode,stableInputDigest:stableInputDigest(ready.manifest.members),
        requirementsDigest:canonicalDigest(requirements),conditionsDigest:canonicalDigest({requirements,reasons,recoveryConditions:conditions}),
        recoveryConditions:conditions,
        terminalEvidenceDigest:rejectedDelivery?canonicalDigest({runEvidenceDigest:revision.transition_evidence_digest,rejectedDelivery}):revision.transition_evidence_digest,terminalReasons:reasons,terminalProductEvidence:productEvidence,
        responsibilityReceipt:receipt(),committedAtMs:context.commitTimeMs};
      if(!outcome.responsibilityReceipt || outcome.responsibilityReceipt.libraRunId!==run.libra_run_id)
        fail('LIBRA_OUTCOME_RECEIPT_MISSING','Terminal outcome requires its atomic responsibility closure receipt.');
      const json=canonicalJson(outcome);
      if(Buffer.byteLength(json)>65536)fail('LIBRA_OUTCOME_TOO_LARGE','Terminal outcome exceeds 64 KiB.');
      repo.invoke('insert',{libra_run_id:outcome.libraRunId,subject_id:outcome.subjectId,outcome:outcome.outcome,
        reason_code:reasonCode,stable_input_digest:outcome.stableInputDigest,requirements_digest:outcome.requirementsDigest,
        conditions_digest:outcome.conditionsDigest,outcome_schema_ref:SCHEMA_REF,outcome_json:json,
        outcome_digest:canonicalDigest(outcome),committed_at_ms:context.commitTimeMs});
      return Object.freeze(outcome);
    }};
  }
  function sourceFieldIds(libraRunId) {
    return read(context=>{
      const repo=context.repository(repository.repositoryId),run=repo.invoke('run',{libra_run_id:libraRunId});
      if(!run)fail('LIBRA_REPROCESS_SOURCE_MISSING','The original Run is unavailable.');
      const fields=repo.invoke('members',{run_material_manifest_id:run.run_material_manifest_id}).map(member=>
        repo.invoke('intake',{intake_decision_id:member.origin_intake_decision_id})?.source_field_id);
      if(!fields.length||fields.some(field=>!field))fail('LIBRA_REPROCESS_SOURCE_MISSING','The original Material Field is unavailable.');
      return Object.freeze([...new Set(fields)].sort());
    });
  }
  function requestReprocess(libraRunId,request) {
    const previous=get(libraRunId);
    if(!previous || previous.outcome!=='unable_to_on_deck' || request.expectedOutcomeDigest!==previous.outcomeDigest ||
        typeof request.actorId!=='string' || !request.actorId || request.actorId.length>256 ||
        typeof request.idempotencyKey!=='string' || !request.idempotencyKey || request.idempotencyKey.length>256)
      fail('LIBRA_REPROCESS_INTENT_STALE','Reprocessing requires the current terminal outcome and a new user intent.');
    const body={libraRunId,previousOutcomeDigest:previous.outcomeDigest,actorId:request.actorId,idempotencyKey:request.idempotencyKey};
    const intentDigest=canonicalDigest(body),commandContract='libra.reprocess-intent@1';
    const committed=createCommandCommitCoordinator(options).execute({
      command:{commandReceiptId:intentDigest,ownerDomain:'libra',commandContract,callerScope:request.actorId,
        idempotencyKey:request.idempotencyKey,requestDigest:intentDigest,targetType:'libra_run',targetId:libraRunId},
      domainParticipant:{participantId:'libra_reprocess_intent',owner:'libra',repositories:[repository],execute(context){
      const repo=context.repository(repository.repositoryId);
      const latest=repo.invoke('input_history',{stable_input_digest:previous.stableInputDigest})
        .sort((a,b)=>Number(b.committed_at_ms)-Number(a.committed_at_ms)||b.libra_run_id.localeCompare(a.libra_run_id))[0];
      if(latest?.outcome_digest!==previous.outcomeDigest)
        fail('LIBRA_REPROCESS_INTENT_STALE','A newer result already exists for these physical inputs.');
      if(repo.invoke('intents',{stable_input_digest:previous.stableInputDigest}).some(intent=>intent.previous_outcome_digest===previous.outcomeDigest))
        fail('LIBRA_REPROCESS_ALREADY_REQUESTED','A new attempt has already been requested for this result.');
      repo.invoke('insert_intent',{intent_id:intentDigest,stable_input_digest:previous.stableInputDigest,
        previous_outcome_digest:previous.outcomeDigest,actor_id:request.actorId,idempotency_key:request.idempotencyKey,
        intent_digest:intentDigest,issued_at_ms:context.commitTimeMs});
      return Object.freeze({intentId:intentDigest,libraRunId,previousOutcomeDigest:previous.outcomeDigest});
      }},
      commitMarker:{commitMarker:intentDigest,scopeType:'reprocess_intent',scopeId:intentDigest,commitDigest:intentDigest},
      auditRecords:[{auditId:intentDigest,actorType:'admin',actorId:request.actorId,action:'request_reprocessing_attempt',
        scopeType:'libra_run',scopeId:libraRunId,evidenceDigest:previous.outcomeDigest}],
      resultEnvelope:result=>({resultSchemaRef:'helix://contracts/application-types/LibraReprocessIntent/v1',resultRef:result}),
    });
    return Object.freeze({...committed.receipt.resultRef,replayed:committed.replayed});
  }
  function reserveAttempt(source,previous,intent) {
    const commandContract='libra.reprocess-intent-reservation@1',key=canonicalDigest({commandContract,intentId:intent.intent_id});
    const command=createCommandCommitCoordinator(options).execute({
      command:{commandReceiptId:key,ownerDomain:'libra',commandContract,callerScope:intent.actor_id,idempotencyKey:intent.intent_id,
        requestDigest:canonicalDigest({intentId:intent.intent_id}),targetType:'reprocess_intent',targetId:intent.intent_id},
      domainParticipant:{participantId:'libra_reprocess_reservation',owner:'libra',repositories:[repository],execute(context){
        const latest=context.repository(repository.repositoryId).invoke('input_history',{stable_input_digest:previous.stable_input_digest})
          .sort((a,b)=>Number(b.committed_at_ms)-Number(a.committed_at_ms)||b.libra_run_id.localeCompare(a.libra_run_id))[0];
        if(latest?.outcome_digest!==intent.previous_outcome_digest)
          fail('LIBRA_REPROCESS_INTENT_STALE','Reserved retry no longer matches the latest result.');
        return Object.freeze({intentId:intent.intent_id,offerId:source.offer.offerId});
      }},
      commitMarker:{commitMarker:key,scopeType:'reprocess_intent',scopeId:intent.intent_id,commitDigest:canonicalDigest({intentId:intent.intent_id})},
      auditRecords:[{auditId:key,actorType:intent.actor_type||'admin',actorId:intent.actor_id,action:'reserve_reprocessing_attempt',
        scopeType:'reprocess_intent',scopeId:intent.intent_id,evidenceDigest:previous.outcome_digest}],
      resultEnvelope:result=>({resultSchemaRef:'helix://contracts/application-types/LibraReprocessReservation/v1',resultRef:result}),
    });
    return command.receipt.resultRef.offerId===source.offer.offerId;
  }
  function checkReentry(source,readCurrentRequirements) {
    const input=stableInputDigest(source.snapshot.primaryMaterialDeliveries);
    const previous=read(context=>context.repository(repository.repositoryId).invoke('input_history',{stable_input_digest:input})
      .sort((a,b)=>Number(b.committed_at_ms)-Number(a.committed_at_ms)||b.libra_run_id.localeCompare(a.libra_run_id))[0]);
    if(!previous||previous.outcome!=='unable_to_on_deck')return null;
    const current=readCurrentRequirements(previous.subject_id);
    const previousOutcome=value(previous),conditions=recoveryConditions(previousOutcome.terminalReasons);
    const conditionsChanged=canonicalDigest(conditions)!==canonicalDigest(previousOutcome.recoveryConditions);
    if(current&&(canonicalDigest(current)!==previous.requirements_digest || conditionsChanged)) {
      const changeIntent={intent_id:canonicalDigest({schema:'libra.changed-requirement-attempt@1',
        previousOutcomeDigest:previous.outcome_digest,requirementsDigest:canonicalDigest(current),recoveryConditions:conditions}),
        previous_outcome_digest:previous.outcome_digest,actor_id:'system:failure-conditions-changed',actor_type:'system'};
      if(reserveAttempt(source,previous,changeIntent))return null;
    }
    const intents=read(context=>context.repository(repository.repositoryId).invoke('intents',{stable_input_digest:input}))
      .filter(intent=>intent.previous_outcome_digest===previous.outcome_digest).sort((a,b)=>Number(a.issued_at_ms)-Number(b.issued_at_ms)||a.intent_id.localeCompare(b.intent_id));
    for(const intent of intents) {
      if(reserveAttempt(source,previous,intent))return null;
    }
    return Object.freeze({kind:'reentry_suppressed',reasonCode:'LIBRA_FAILURE_CONDITIONS_UNCHANGED',previousRunId:previous.libra_run_id,
      previousOutcomeDigest:previous.outcome_digest});
  }
  return Object.freeze({get,listPendingCommitted,reconcileCommitted,failureParticipant,sourceFieldIds,requestReprocess,checkReentry});
}
module.exports=Object.freeze({SCHEMA_REF,stableInputDigest,createRunOutcomeStore});
