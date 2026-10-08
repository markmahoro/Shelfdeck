'use strict';
const {resolveAcceptanceResult}=require('../persistence/acceptance-check-evidence-store');

const {settlementHandles,isSettlementAuthorityUnavailable}=require('../model/input-settlement-scope');
const {requiresInputSettlement}=require('../model/offload-settlement');
const { canonicalDigest } = require('../../../contracts/canonical-json');
const { createWorkAdmission } = require('../../../foundation/execution/work-admission');
const { createAcceptanceRecoveryStore } = require('../persistence/acceptance-recovery-store');

const LIMITS = Object.freeze({ globalOpenWorks:256, ownerOpenWorks:256, openEvents:256 });

function stable(prefix, value) { return prefix + canonicalDigest(value).slice(0, 40); }

function refsFromOffer(offer) {
  const ref = (objectType, objectId, revision = offer.packageRevision, digest = offer.packageDigest) => Object.freeze({
    ownerDomain: 'libra', objectType, objectId, revision,
    digest,
  });
  return Object.freeze([
    ref('handoff_b_offer', offer.offerId),
    ref('on_deck_package', offer.onDeckPackageId),
    ref('shelf', offer.shelfId),
    ref('libra_run', offer.libraRunId),
    ref('subject', offer.subjectId),
    ref('acceptance_spec', offer.acceptanceSpecId),
    ref('related_disposition_set', offer.onDeckPackageId + ':related-disposition',
      offer.packageRevision, offer.relatedDispositionSetDigest),
  ]);
}

function workDefinition({ processType, processId, workKind, basisDigest,
  dependencyRefs, dependsOn = [], priorityClass = 'normal_foreground' }) {
  const identity = { processType, processId, workKind, basisDigest };
  return Object.freeze({
    schemaRef:'helix://foundation/types/SupportingWorkDefinition/v1', schemaVersion:1,
    workId:stable('arca-' + workKind + '-work-', identity), ownerDomain:'arca',
    processType, processId, workKind,
    workObjectiveTypeRef:'helix://arca/work/' + workKind + '/v1', workObjectiveVersion:1,
    executionBasisId:stable('arca-' + workKind + '-basis-', identity),
    executionBasisDigest:basisDigest,
    dependencyRefs:Object.freeze([...dependencyRefs, ...dependsOn]),
    priorityClass, priorityRevision:1, capabilityCatalogScope:'arca',
    workspaceMaterialScope:Object.freeze([]),
    idempotencyKey:stable('arca-' + workKind + '-key-', identity),
    concurrencyScope:processType + '/' + processId + '/' + workKind,
    outputContractRef:workKind === 'acceptance_assessment'
      ? 'helix://contracts/types/AcceptanceCheckRecord/v1'
      : workKind === 'acceptance_commit'
        ? 'helix://contracts/types/CustodyAndTransferReceipt/v1'
        : workKind === 'acceptance_rejection'
          ? 'helix://contracts/types/RejectionReceipt/v1'
        : 'helix://contracts/types/OnDeckCommitResult/v1',
  });
}

function succeeded(status) {
  return status?.state === 'succeeded' || status?.latestAttempt?.state === 'succeeded';
}

function exactOffer(message) {
  if (!message || message.messageKind !== 'libra.product-offer.available@1' ||
      message.messageId !== message.dedupKey || !message.offerId ||
      !message.onDeckPackageId || !message.shelfId || !message.libraRunId ||
      !message.subjectId || !message.acceptanceSpecId ||
      !/^[0-9a-f]{64}$/.test(message.relatedDispositionSetDigest || '') ||
      !Number.isSafeInteger(message.packageRevision) || message.packageRevision < 1 ||
      !/^[0-9a-f]{64}$/.test(message.packageDigest || '')) {
    throw new TypeError('Arca accepts only an exact official Handoff B Offer message.');
  }
  return Object.freeze({ ...message });
}

function createOnDeckProcessCoordinator(options) {
  const recovery = createAcceptanceRecoveryStore(options);
  const executionContractRevision = options.acceptanceExecutionContractRevision || 'arca.acceptance.executor@2';
  function recoveryTriggerDigest() {
    return canonicalDigest({ schema:'arca.acceptance-recovery-trigger@1', executionContractRevision,
      connectionRevision:options.readAcceptanceConnectionRevision?.() || 'none' });
  }
  const admission = createWorkAdmission({
    schemaManifest:options.schemaManifest, unitOfWork:options.unitOfWork,
    limits:LIMITS,
    eligibilityProvider:{ check:(request)=>Object.freeze({
      eligible:request.ownerDomain === 'arca' &&
        ['arca_acceptance','arca_ondeck_run'].includes(request.processType),
      basisDigest:request.executionBasisDigest,
      reasonCode:'ARCA_PROCESS_BASIS_STALE',
    }) },
  });
  function submit(work) {
    const result = admission.replay(work) || admission.submit(work);
    if (result?.kind === 'invalid_contract') {
      const error = new Error('Arca Supporting Work violates the Foundation contract.');
      error.code = result.reasonCode || 'ARCA_WORK_INVALID';
      throw error;
    }
    return result;
  }
  function assessmentWork(processId, dependencyRefs, generation = 1, triggerDigest = recoveryTriggerDigest()) {
    const basisDigest = canonicalDigest({ schema:'arca.acceptance-assessment-basis@2', dependencyRefs,
      recoveryGeneration:generation, recoveryTriggerDigest:triggerDigest });
    return workDefinition({ processType:'arca_acceptance', processId,
      workKind:'acceptance_assessment', basisDigest, dependencyRefs,
      priorityClass:'handoff_acceptance' });
  }
  function commitWork(processId, dependencyRefs, assessment) {
    const results = options.workResultReader.read(assessment.workId)
      .filter((item)=>item.outcomeKind === 'succeeded').map((item)=>resolveAcceptanceResult(options,item.result));
    const basisDigest = canonicalDigest({ schema:'arca.acceptance-commit-basis@1',
      dependencyRefs, acceptanceChecks:results.map((item)=>canonicalDigest(item)).sort() });
    return workDefinition({ processType:'arca_acceptance', processId,
      workKind:'acceptance_commit', basisDigest, dependencyRefs,
      dependsOn:[Object.freeze({ ownerDomain:'arca', objectType:'supporting_work',
        objectId:assessment.workId, revision:1, digest:assessment.executionBasisDigest })],
      priorityClass:'handoff_acceptance' });
  }
  function rejectionWork(processId, dependencyRefs, assessment) {
    const results = options.workResultReader.read(assessment.workId)
      .filter((item)=>item.outcomeKind === 'succeeded').map((item)=>resolveAcceptanceResult(options,item.result));
    const basisDigest = canonicalDigest({ schema:'arca.acceptance-rejection-basis@1',
      dependencyRefs, acceptanceChecks:results.map((item)=>canonicalDigest(item)).sort() });
    return workDefinition({ processType:'arca_acceptance', processId,
      workKind:'acceptance_rejection', basisDigest, dependencyRefs,
      dependsOn:[Object.freeze({ ownerDomain:'arca', objectType:'supporting_work',
        objectId:assessment.workId, revision:1, digest:assessment.executionBasisDigest })],
      priorityClass:'handoff_acceptance' });
  }
  function assessmentDisposition(assessment) {
    const results=options.workResultReader.read(assessment.workId)
      .filter((item)=>item.outcomeKind==='succeeded').map((item)=>resolveAcceptanceResult(options,item.result));
    const checks=results.filter((item)=>item?.schemaRef==='helix://contracts/types/AcceptanceCheck/v1');
    const feasibility=results.filter((item)=>item?.schemaRef==='helix://contracts/types/InventoryFeasibilityEvidence/v1');
    if(checks.length!==5||feasibility.length!==1)throw new Error('Arca Acceptance Assessment terminal Result set is incomplete.');
    return checks.some((item)=>item.result!=='passed')||feasibility[0].availableBytes<feasibility[0].requiredBytes?'rejected':'accepted';
  }
  function onDeckWork(onDeckRunId, dependencyRefs, acceptanceWork, recoveryGeneration = 1) {
    const basisDigest = recoveryGeneration === 1
      ? canonicalDigest({ schema:'arca.on-deck-execution-basis@1', onDeckRunId, dependencyRefs,
        acceptanceWorkId:acceptanceWork.workId })
      : canonicalDigest({ schema:'arca.on-deck-execution-basis@2', onDeckRunId, dependencyRefs,
        acceptanceWorkId:acceptanceWork.workId, recoveryGeneration });
    return workDefinition({ processType:'arca_ondeck_run', processId:onDeckRunId,
      workKind:'on_deck_execution', basisDigest, dependencyRefs,
      dependsOn:[Object.freeze({ ownerDomain:'arca', objectType:'supporting_work',
        objectId:acceptanceWork.workId, revision:1, digest:acceptanceWork.executionBasisDigest })] });
  }
  function refsFromWorkDefinition(workId) {
    const definition = options.workResultReader.readDefinition?.(workId)?.definition;
    if (!Array.isArray(definition?.dependencyRefs)) {
      throw new Error('Arca Work lost its immutable Handoff B dependency references.');
    }
    return Object.freeze(definition.dependencyRefs.filter((item)=>item.ownerDomain==='libra'));
  }
  function orderedOnDeckWorks(onDeckRunId) {
    return options.workResultReader.listWorks({ ownerDomain:'arca', processType:'arca_ondeck_run',
      processId:onDeckRunId, workKind:'on_deck_execution' })
      .slice().sort((left,right)=>Number(left.created_at_ms)-Number(right.created_at_ms) ||
        String(left.work_id).localeCompare(String(right.work_id)));
  }
  function acceptedWorkForRecovery(workId) {
    const definition = options.workResultReader.readDefinition?.(workId)?.definition;
    const ref = definition?.dependencyRefs?.find((item)=>item.ownerDomain === 'arca' &&
      item.objectType === 'supporting_work');
    if (!ref?.objectId || !ref.digest) {
      throw Object.assign(new Error('On-deck recovery lost its accepted Handoff B Work reference.'), {
        code:'ARCA_ONDECK_RECOVERY_ACCEPTANCE_REF_MISSING',
      });
    }
    return Object.freeze({ workId:ref.objectId, executionBasisDigest:ref.digest });
  }
  function recordTerminalFailure(request) {
    const status = options.workResultReader.status(request.workId);
    const errorCode = request.errorCode || status?.latestAttempt?.failure_code || 'ARCA_ACCEPTANCE_EXECUTOR_FAILED';
    const incident=request.incidentRef||options.executorIncidentProjection?.projectionForWork({ownerDomain:'arca',processType:'arca_acceptance',
      workKind:request.workKind,workId:request.workId,workAttemptId:status?.latestAttempt?.attempt_id,
      workAttemptFailureCode:errorCode})?.[0]||null;
    return recovery.recordFailure(request.processId, { workId:request.workId, failurePhase:request.workKind,
      errorCode, terminalAttemptCount:Number(status?.latestAttempt?.ordinal || 1),
      incidentKey:incident?.incidentKey||incident?.incident_key||null });
  }
  function reconcileAcceptance(processId, dependencyRefs = null) {
    let refs = dependencyRefs;
    const recoveryCase = recovery.read(processId);
    let assessment = refs ? assessmentWork(processId, refs, recoveryCase?.recoveryGeneration || 1,
      recoveryCase?.recoveryTriggerDigest || recoveryTriggerDigest()) : null;
    if (!assessment) {
      const activeWorkId = recoveryCase?.activeWorkId;
      if (!activeWorkId) return Object.freeze({ kind:'not_found', processId });
      refs = refsFromWorkDefinition(activeWorkId);
      assessment = assessmentWork(processId, refs, recoveryCase.recoveryGeneration, recoveryCase.recoveryTriggerDigest);
    }
    submit(assessment);
    const assessmentStatus = options.workResultReader.status(assessment.workId);
    if (assessmentStatus?.state === 'failed' || assessmentStatus?.latestAttempt?.state === 'failed') {
      const current = recovery.read(processId);
      if (current?.recoveryState !== 'attention_required') {
        recordTerminalFailure({ processId, workId:assessment.workId, workKind:'acceptance_assessment' });
      }
      return Object.freeze({ kind:'attention_required', processId, workId:assessment.workId,
        recovery:recovery.read(processId) });
    }
    if (!succeeded(assessmentStatus)) {
      return Object.freeze({ kind:'assessment_pending', processId, workId:assessment.workId });
    }
    const disposition=assessmentDisposition(assessment);
    const commit = disposition==='rejected'?rejectionWork(processId,refs,assessment):commitWork(processId, refs, assessment);
    submit(commit);
    if (!succeeded(options.workResultReader.status(commit.workId))) {
      return Object.freeze({ kind:'commit_pending', processId, workId:commit.workId });
    }
    const offerContext = options.contextReader.readOffer(refs);
    const committedRun = disposition === 'rejected' ? null :
      options.contextReader.onDeck.findRunByOffer(offerContext.offer.offerId);
    const frozen = committedRun && options.contextReader.acceptance.readRunResponsibility(committedRun.onDeckRunId);
    if (disposition !== 'rejected' && (!frozen || frozen.offerId !== offerContext.offer.offerId ||
        frozen.onDeckPackageId !== offerContext.offer.onDeckPackageId ||
        frozen.packageDigest !== offerContext.offer.packageDigest)) {
      throw new Error('Accepted Handoff B responsibility is unavailable or stale.');
    }
    const attemptId = frozen?.acceptanceAttemptId || canonicalDigest({schema:'arca.acceptance-attempt-id@1',offerId:offerContext.offer.offerId,
      onDeckPackageId:offerContext.offer.onDeckPackageId,packageDigest:offerContext.offer.packageDigest,
      standardRevision:offerContext.shelf.currentStandardRevision,placementRevision:offerContext.shelf.currentPlacementRevision});
    const resolved = recovery.resolve(processId, attemptId, canonicalDigest({ assessmentWorkId:assessment.workId, commitWorkId:commit.workId }));
    if(disposition==='rejected')return Object.freeze({kind:'rejected',processId,workId:commit.workId,
      result:options.workResultReader.read(commit.workId).find((item)=>item.outcomeKind==='succeeded')?.result||null});
    const accepted = options.workResultReader.read(commit.workId).find((item)=>
      item.outcomeKind === 'succeeded' && item.result?.receiptKind === 'handoff_b_accepted');
    if (!accepted) return Object.freeze({ kind:'rejected', processId, workId:commit.workId });
    const assessmentFact = options.contextReader.acceptance.readAssessment(attemptId);
    const responsibility = options.contextReader.acceptance.deriveAcceptedResponsibility(assessmentFact);
    if (responsibility.onDeckRunId !== frozen.onDeckRunId) {
      throw new Error('Accepted Handoff B Run no longer matches its frozen Decision.');
    }
    const onDeck = onDeckWork(responsibility.onDeckRunId, refs, commit);
    submit(onDeck);
    return Object.freeze({ kind:succeeded(options.workResultReader.status(onDeck.workId)) ? 'terminal' : 'on_deck_pending',
      processId, onDeckRunId:responsibility.onDeckRunId, workId:onDeck.workId });
  }
  function recoverOnDeck(onDeckRunId, maxGenerations = 3, mode = 'automatic') {
    if (!['automatic','user'].includes(mode)) throw new TypeError('On-deck recovery mode is invalid.');
    const rows = orderedOnDeckWorks(onDeckRunId);
    if (!rows.length) return Object.freeze({ kind:'not_found', onDeckRunId });
    const latest = rows.at(-1);
    if (!['failed','cancelled'].includes(latest.state)) {
      return Object.freeze({ kind:'not_recoverable', onDeckRunId, workId:latest.work_id, state:latest.state });
    }
    let eligibility = mode === 'user'
      ? options.contextReader.onDeck.attentionRetryEligibility(onDeckRunId)
      : options.contextReader.onDeck.recoveryEligibility(onDeckRunId);
    if (mode === 'automatic' && !eligibility.eligible && eligibility.reasonCode === 'on_deck_run_not_blocked' &&
        ['ready','offloading'].includes(eligibility.state)) {
      // A Work can fail while its input projections or Plan are being built,
      // before an Event terminal callback exists to block the Run.  The
      // durable failed Work is still the exact recovery trigger, so close
      // that callback gap here before evaluating the same Run again.
      const context = options.contextReader.readAccepted(onDeckRunId,
        refsFromWorkDefinition(latest.work_id));
      options.contextReader.onDeck.block(onDeckRunId,
        context.finalInventoryDecision.decisionDigest);
      eligibility = options.contextReader.onDeck.recoveryEligibility(onDeckRunId);
    }
    if (!eligibility.eligible) {
      return Object.freeze({ kind:'not_recoverable', onDeckRunId, workId:latest.work_id,
        reasonCode:eligibility.reasonCode, state:eligibility.state || null });
    }
    const refs = refsFromWorkDefinition(latest.work_id);
    const context = options.contextReader.readAccepted(onDeckRunId, refs);
    if (mode === 'automatic' && rows.length >= maxGenerations) {
      const attention=options.contextReader.onDeck.requireAttention(onDeckRunId,
        context.finalInventoryDecision.decisionDigest);
      return Object.freeze({ kind:'attention_required', reasonCode:'ARCA_ONDECK_RECOVERY_EXHAUSTED',
        onDeckRunId, subjectId:context.offer.subjectId, workId:latest.work_id,
        recoveryGeneration:rows.length, replayed:attention.replayed });
    }
    const acceptedWork = acceptedWorkForRecovery(latest.work_id);
    options.contextReader.onDeck.resume(onDeckRunId, context.finalInventoryDecision.decisionDigest,'blocked');
    const work = onDeckWork(onDeckRunId, refs, acceptedWork, rows.length + 1);
    return Object.freeze({ kind:'recovering', mode, onDeckRunId, subjectId:context.offer.subjectId,
      recoveryGeneration:rows.length + 1, work, result:submit(work) });
  }
  function listRecoverableOnDeck(limit = 100, cursor = null) {
    if (typeof options.workResultReader.listOwnerWorks !== 'function') return Object.freeze([]);
    const processIds=[...new Set(options.workResultReader.listOwnerWorks({ownerDomain:'arca',workKind:'on_deck_execution'})
      .map((item)=>item.process_id).filter((item)=>typeof item==='string'&&item&&(cursor===null||item>cursor)))].sort();
    const result=[];
    for(const onDeckRunId of processIds){
      const rows=orderedOnDeckWorks(onDeckRunId),latest=rows.at(-1);
      if(!latest||!['failed','cancelled'].includes(latest.state))continue;
      const eligibility=options.contextReader.onDeck.recoveryEligibility(onDeckRunId);
      const closesPlanningGap=!eligibility.eligible&&eligibility.reasonCode==='on_deck_run_not_blocked'&&
        ['ready','offloading'].includes(eligibility.state);
      if(rows.length>=3&&eligibility.eligible)continue;
      if(!eligibility.eligible&&!closesPlanningGap)continue;
      result.push(Object.freeze({cursor:onDeckRunId,scope:Object.freeze({onDeckRunId})}));
      if(result.length>=limit)break;
    }
    return Object.freeze(result);
  }
  function listPendingSettlementApprovals(cursor=null,limit=100){
    return options.workResultReader.listOwnerWorksPage({ownerDomain:'arca',workKind:'on_deck_execution',state:'running'},cursor,limit)
      .map(row=>Object.freeze({cursor:row.work_id,scope:{workId:row.work_id,onDeckRunId:row.process_id}}));
  }
  function reconcileSettlementApprovals({workId,onDeckRunId}){
    const results=options.workResultReader.read(workId);
    const verification=results.find(row=>row.capabilityRef==='arca.inventory.final_product.verify@1'&&row.outcomeKind==='succeeded')?.result;
    if(!verification)return {kind:'awaiting_final_verification'};
    const refs=refsFromWorkDefinition(workId),context=options.contextReader.readAccepted(onDeckRunId,refs);
    const authorization=options.contextReader.settlementAuthorizations.current();
    let issued=0;
    for(const member of context.packageValue.offloadContextManifest.members.filter(requiresInputSettlement)){
      if(results.some(row=>row.capabilityRef==='arca.ondeck.input_settlement.delete@1'&&row.outcomeKind==='succeeded'&&row.result?.materialKey===member.materialKey))continue;
      try{
        const bounded=options.contextReader.readSettlement(onDeckRunId,refs,member.materialKey);
        const scope=settlementHandles(bounded,member.materialKey,verification,authorization);
        options.contextReader.settlementApprovals.issue(scope,authorization);issued++;
      }catch(error){if(isSettlementAuthorityUnavailable(error))return {kind:'awaiting_authorization',issued};throw error;}
    }
    return {kind:'approvals_ready',issued};
  }
  return Object.freeze({
    admitOffer(message) {
      const offer = exactOffer(message), refs = refsFromOffer(offer);
      const triggerDigest = recoveryTriggerDigest();
      const provisional = assessmentWork(offer.offerId, refs, 1, triggerDigest);
      const recoveryCase = recovery.admit({ offerId:offer.offerId, onDeckPackageId:offer.onDeckPackageId,
        packageDigest:offer.packageDigest, workId:provisional.workId, workKind:'acceptance_assessment', recoveryTriggerDigest:triggerDigest });
      const work = assessmentWork(offer.offerId, refs, recoveryCase.recoveryGeneration, recoveryCase.recoveryTriggerDigest);
      return Object.freeze({ processId:offer.offerId, dependencyRefs:refs, work, recovery:recoveryCase,
        result:submit(work),
        admissionParticipant:recovery.admissionParticipant({ offerId:offer.offerId, workId:work.workId, packageDigest:offer.packageDigest }) });
    },
    recordTerminalFailure,
    recoverAttentionCases(limit = 100) {
      const triggerDigest = recoveryTriggerDigest(), results = [];
      for (const item of recovery.listAttention(limit)) {
        if (item.automaticRecoveryUsed || item.failedTriggerDigest === triggerDigest) continue;
        const refs = refsFromWorkDefinition(item.activeWorkId);
        const nextWork = assessmentWork(item.offerId, refs, item.recoveryGeneration + 1, triggerDigest);
        const next = recovery.startGeneration(item.offerId, { mode:'automatic', workId:nextWork.workId, recoveryTriggerDigest:triggerDigest });
        if (next.activeWorkId === nextWork.workId) results.push(Object.freeze({ offerId:item.offerId, work:nextWork, result:submit(nextWork) }));
      }
      return Object.freeze(results);
    },
    retryAcceptance(offerId) {
      const item = recovery.read(offerId);
      if (!item) throw Object.assign(new Error('Acceptance Recovery Case was not found.'), { code:'ARCA_ACCEPTANCE_RECOVERY_NOT_FOUND' });
      if (item.recoveryState === 'resolved') {
        const run=options.contextReader.onDeck.findRunByOffer(offerId);
        if(!run)throw Object.assign(new Error('Accepted On-deck Run was not found.'),{code:'ARCA_ONDECK_RUN_NOT_FOUND'});
        return recoverOnDeck(run.onDeckRunId,3,'user');
      }
      const refs = refsFromWorkDefinition(item.activeWorkId), triggerDigest = recoveryTriggerDigest();
      const nextWork = assessmentWork(offerId, refs, item.recoveryGeneration + 1, triggerDigest);
      const next = recovery.startGeneration(offerId, { mode:'user', workId:nextWork.workId, recoveryTriggerDigest:triggerDigest });
      return Object.freeze({ recovery:next, work:nextWork, result:submit(nextWork) });
    },
    readAcceptanceRecovery: recovery.read,
    listAcceptanceAttention: recovery.listAttention,
    listRecoverableOnDeck, listPendingSettlementApprovals, reconcileSettlementApprovals,
    reconcileAcceptance,
    reconcileOnDeck(onDeckRunId) {
      const rows = orderedOnDeckWorks(onDeckRunId);
      if (!rows.length) return Object.freeze({ kind:'not_found', onDeckRunId });
      const row = rows.slice().reverse().find((item)=>succeeded(options.workResultReader.status(item.work_id)));
      if (!row) return Object.freeze({ kind:'pending', onDeckRunId, workId:rows.at(-1).work_id });
      const results = options.workResultReader.read(row.work_id);
      const commit = results.find((item)=>item.capabilityRef === 'arca.ondeck.commit@1' && item.outcomeKind === 'succeeded');
      if (!commit) return Object.freeze({ kind:'invalid_terminal_result', onDeckRunId });
      const context = options.contextReader.readAccepted(onDeckRunId, refsFromWorkDefinition(row.work_id));
      options.contextReader.onDeck.finalize(onDeckRunId, context.finalInventoryDecision.decisionDigest);
      return Object.freeze({ kind:'terminal', onDeckRunId, subjectId:context.offer.subjectId, result:commit.result });
    },
    blockOnDeck(onDeckRunId) {
      const rows = orderedOnDeckWorks(onDeckRunId);
      if (!rows.length) return Object.freeze({ kind:'not_found', onDeckRunId });
      const latest = rows.at(-1), refs = refsFromWorkDefinition(latest.work_id);
      const context = options.contextReader.readAccepted(onDeckRunId, refs);
      const blocked = options.contextReader.onDeck.block(onDeckRunId,
        context.finalInventoryDecision.decisionDigest);
      return Object.freeze({ kind:'blocked', onDeckRunId, subjectId:context.offer.subjectId,
        workId:latest.work_id, replayed:blocked.replayed });
    },
    recoverOnDeck,
  });
}

module.exports = Object.freeze({ createOnDeckProcessCoordinator, refsFromOffer });
