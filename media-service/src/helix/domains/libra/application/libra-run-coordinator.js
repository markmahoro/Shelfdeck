'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { createWorkAdmission } = require('../../../foundation/execution/work-admission');
const { createWorkspaceAdmissionStore } = require('../persistence/workspace-admission-store');
const { buildSpaceAdmissionRequest, buildWorkspaceAdmissionDecision, requiredFreeBytes, workspaceId } =
  require('../model/workspace-admission-contracts');
const { directMediaSelectionWork, remuxMediaSelectionWork, sourceMediaObservationWork,
  transcodeMediaSelectionWork,transcodeStrategyAssessmentWork } = require('../planning/media-production-work');
const { createProductStagingService } = require('./product-staging-service');
const { productConformanceWork, deliverablePromotionWork } =
  require('../planning/product-delivery-work');
const {
  externalAcquireVerificationWork,
  externalImportSelectionWork,
  externalSearchSelectionWork,
} = require('../planning/external-material-work');
const {
  identityCommitWork,
  identityObservationWork,
} = require('../planning/product-identity-work');
const {
  metadataObservationWork,
  nextMetadataStage,
} = require('../planning/product-metadata-work');
const { coversRequirementGaps } = require('../model/defect-admission-contracts');
const { sourceRequiresExternalSearch, sizeCapAdmissionForecast } = require('../model/media-production-contracts');
const { artifactVerificationContext } = require('../planning/libra-production-planners');

// Shared fx_supporting_works hard cap. 256 saturates a Movie Helix-beta Field
// (~300 active Runs) and starves later user identity confirmation.
const LIMITS=Object.freeze({globalOpenWorks:1000,ownerOpenWorks:1000,openEvents:256});
const ARTIFACT_RESULT='helix://contracts/capabilities/shared.artifact.manifest.verify/v1/result';
const PRODUCT_METADATA_RESULT='helix://contracts/capabilities/libra.product_metadata.commit/v1/result';
function stable(prefix,value){return prefix+canonicalDigest(value).slice(0,40);}
function priority(snapshot) { return snapshot.run.priorityClass === 'expedited'
  ? 'expedited_formation' : 'normal_foreground'; }
function artifactWork(snapshot,workspace) {
  const basis={libraRunId:snapshot.run.libraRunId,executionBasisDigest:snapshot.run.executionBasisDigest,
    workspaceId:workspace.workspaceId,
    artifactRequirementDigest:canonicalDigest({schema:'libra.artifact-requirement-set@1',
      items:snapshot.spec.requirements.metadata.requiredArtifactKinds})};
  return Object.freeze({schemaRef:'helix://foundation/types/SupportingWorkDefinition/v1',schemaVersion:1,
    workId:stable('libra-artifact-production-work-',basis),ownerDomain:'libra',processType:'libra_run',
    processId:snapshot.run.libraRunId,workKind:'artifact_production',
    workObjectiveTypeRef:'helix://libra/work/artifact-production/v1',workObjectiveVersion:1,
    executionBasisId:stable('libra-artifact-production-basis-',basis),executionBasisDigest:snapshot.run.executionBasisDigest,
    dependencyRefs:Object.freeze([]),priorityClass:priority(snapshot),priorityRevision:snapshot.run.priorityRevision||1,
    capabilityCatalogScope:'libra',
    workspaceMaterialScope:Object.freeze([]),idempotencyKey:stable('libra-artifact-production-key-',basis),
    concurrencyScope:snapshot.run.libraRunId+'/artifact-production',outputContractRef:ARTIFACT_RESULT});
}
function productFactWork(snapshot,workspace,artifact) {
  const basis={libraRunId:snapshot.run.libraRunId,executionBasisDigest:snapshot.run.executionBasisDigest,
    workspaceId:workspace.workspaceId,artifactWorkId:artifact.workId};
  const artifactDependency=Object.freeze({ownerDomain:'libra',objectType:'supporting_work',objectId:artifact.workId,
    revision:1,digest:artifact.executionBasisDigest});
  return Object.freeze({schemaRef:'helix://foundation/types/SupportingWorkDefinition/v1',schemaVersion:1,
    workId:stable('libra-product-fact-work-',basis),ownerDomain:'libra',processType:'libra_run',
    processId:snapshot.run.libraRunId,workKind:'product_fact_assembly',
    workObjectiveTypeRef:'helix://libra/work/product-fact-assembly/v1',workObjectiveVersion:1,
    executionBasisId:stable('libra-product-fact-basis-',basis),executionBasisDigest:snapshot.run.executionBasisDigest,
    dependencyRefs:Object.freeze([artifactDependency]),priorityClass:priority(snapshot),
    priorityRevision:snapshot.run.priorityRevision||1,
    capabilityCatalogScope:'libra',workspaceMaterialScope:Object.freeze([]),
    idempotencyKey:stable('libra-product-fact-key-',basis),concurrencyScope:snapshot.run.libraRunId+'/product-fact',
    outputContractRef:PRODUCT_METADATA_RESULT});
}

function definitionForReplay(work, existing) {
  if (!existing) return work;
  const candidate = Object.freeze({
    ...work,
    priorityClass: existing.definition.priorityClass,
    priorityRevision: existing.definition.priorityRevision,
  });
  return canonicalDigest(candidate) === existing.definitionDigest
    ? candidate
    : work;
}

function unresolvedMetadataTerminal(metadataStage) {
  if (metadataStage?.kind !== 'unresolved') {
    throw new TypeError('Product Metadata terminal selection requires an unresolved stage.');
  }
  const providerResults = (metadataStage.results || []).filter((item) =>
    item?.result?.sourceKind === 'provider');
  if (providerResults.length !== 1) {
    throw new Error('Unresolved Product Metadata must bind exactly one durable Provider Result.');
  }
  const resultRecord = providerResults[0];
  if (typeof resultRecord.sourceWorkId !== 'string' || !resultRecord.sourceWorkId) {
    throw new Error('Unresolved Product Metadata Provider Result lacks its durable Work identity.');
  }
  return Object.freeze({
    work: Object.freeze({ workId:resultRecord.sourceWorkId }),
    resultRecord,
    failureCode: metadataStage.reasonCode,
  });
}

function createLibraRunCoordinator(options){
  if(!options?.movieProductionReader||!options.workResultReader||!options.workspaceProductPort)
    throw new TypeError('Libra Run Coordinator requires Owner facts, Foundation results, and Workspace projection.');
  const workspaceAdmission=createWorkspaceAdmissionStore(options);
  const productStaging=options.productStagingService||createProductStagingService(options);
  const admission=createWorkAdmission({schemaManifest:options.schemaManifest,unitOfWork:options.unitOfWork,limits:LIMITS,
    eligibilityProvider:{check:(request)=>Object.freeze({eligible:request.ownerDomain==='libra'&&request.processType==='libra_run',
      basisDigest:request.executionBasisDigest,reasonCode:'LIBRA_RUN_BASIS_STALE'})}});
  function submit(work){
    const existing=options.workResultReader.readDefinition?.(work.workId)||null;
    const replayDefinition=definitionForReplay(work,existing);
    return admission.replay(replayDefinition)||admission.submit(work);
  }
  function attachWorkingHandle(snapshot, workspace, handle) {
    if (!handle?.handleId) return;
    productStaging.ensureWorking(snapshot, workspace.workspaceId, handle,
      Object.freeze(snapshot.episodeClaims || []));
  }
  function attachWorkspaceOutputs(snapshot, workspace, work) {
    const results = options.workResultReader.read(work.workId)
      .filter((item) => item.outcomeKind === 'succeeded');
    for (const item of results) {
      attachWorkingHandle(snapshot, workspace,
        item.result?.workspaceMaterialHandle ||
        item.result?.workspaceMediaHandle?.workspaceMaterialHandle);
    }
  }
  function attachArtifactOutputs(snapshot, workspace) {
    const context = artifactVerificationContext(options, snapshot.run.libraRunId);
    for (const item of context.artifactMaterials) {
      const materialized = options.workspaceProductPort
        .readMaterializedArtifact(item.artifactHandle);
      productStaging.ensureWorking(snapshot, workspace.workspaceId,
        materialized.workspaceMaterialHandle, Object.freeze([]));
    }
  }
  function selectedOutput(work) {
    const selections=options.workResultReader.read(work.workId).filter((item)=>item.outcomeKind==='succeeded'&&
      item.capabilityRef==='libra.product_output.select@1');
    if(selections.length!==1)throw new Error('Terminal media selection Work lacks one durable Selection Result.');
    return selections[0].result;
  }
  function workSucceeded(status) {
    return status?.state === 'succeeded';
  }
  function workFailed(status) {
    return status?.state === 'failed' || status?.state === 'cancelled';
  }
  function terminalWork(snapshot, work, status, blockerKind='capability_exhausted') {
    const failed = status?.state === 'failed';
    if (failed && options.libraRunLifecycleService) {
      return options.libraRunLifecycleService.freezeFailedWork(
        snapshot.run.libraRunId,
        work.workId,
        blockerKind,
      );
    }
    return Object.freeze({
      kind: 'work_cancelled',
      libraRunId: snapshot.run.libraRunId,
      workId: work.workId,
      reasonCode: status?.latestAttempt?.failure_code || 'work_cancelled',
    });
  }
  function externalResultRecord(work, capabilityRef) {
    const values = options.workResultReader.read(work.workId).filter((item) =>
      item.outcomeKind === 'succeeded' && item.capabilityRef === capabilityRef);
    if (values.length !== 1) {
      throw new Error('Terminal External Material Work lacks one durable ' +
        capabilityRef + ' Result.');
    }
    return values[0];
  }
  function externalResult(work, capabilityRef) {
    return externalResultRecord(work, capabilityRef).result;
  }
  function freezeBusinessTerminal(snapshot, work, resultRecord, failureCode) {
    if (options.libraRunLifecycleService?.freezeTerminalResult) {
      return options.libraRunLifecycleService.freezeTerminalResult(
        snapshot.run.libraRunId,
        work.workId,
        'product_unachievable',
        Object.freeze({
          eventId: resultRecord.eventId,
          failureClass: 'business_unachievable',
          failureCode,
          resultDigest: resultRecord.resultDigest,
        }),
      );
    }
    return Object.freeze({ kind:'product_unachievable', libraRunId:snapshot.run.libraRunId,
      workId:work.workId, reasonCode:failureCode });
  }
  function freezePersistedConformanceFailure(snapshot) {
    if (typeof options.workResultReader.listWorks !== 'function') return null;
    const works = options.workResultReader.listWorks({
      ownerDomain: 'libra',
      processType: 'libra_run',
      processId: snapshot.run.libraRunId,
      workKind: 'product_conformance',
    }).filter((item) => item.state === 'succeeded')
      .sort((left, right) => Number(right.updated_at_ms) - Number(left.updated_at_ms));
    for (const work of works) {
      const record = options.workResultReader.read(work.work_id).find((item) =>
        item.outcomeKind === 'succeeded' &&
        item.capabilityRef === 'libra.product.conformance.verify@1');
      const evidence = record?.result;
      if (evidence && evidence.result !== 'passed') {
        if (snapshot.run.authorizedDefectManifest && coversRequirementGaps(
          snapshot.run.authorizedDefectManifest,
          evidence.unmetRequirementCodes || evidence.reasonCodes || [])) continue;
        return freezeBusinessTerminal(snapshot, { workId:work.work_id }, record,
          evidence.unmetRequirementCodes?.[0] ||
          evidence.reasonCodes?.[0] || 'product_conformance_failed');
      }
    }
    return null;
  }
  function mediaVerification(work) {
    const values = options.workResultReader.read(work.workId).filter((item) =>
      item.outcomeKind === 'succeeded' &&
      item.capabilityRef === 'libra.product_media.verify@1');
    if (values.length !== 1) {
      throw new Error('Terminal media selection Work lacks one durable Product Media Verification.');
    }
    return values[0].result;
  }
  function requiresExternalSource(work) {
    const reasons = new Set(mediaVerification(work).reasonCodes || []);
    return reasons.has('minimum_raster_unmet') ||
      reasons.has('system_upscale_forbidden') ||
      reasons.has('primary_audio_unmet');
  }
  function sizeCapWaived(snapshot) {
    const codes = snapshot.run.authorizedDefectManifest?.waivedRequirementCodes || [];
    return codes.includes('max_size_exceeded');
  }
  function literalBinding(record, portName) {
    return record?.inputBindings?.bindings?.find((item) =>
      item.portName === portName && item.bindingKind === 'literal')?.value || null;
  }
  function onlyWaivedSizeGap(work, snapshot) {
    if (!sizeCapWaived(snapshot)) return false;
    const reasons = mediaVerification(work).reasonCodes || [];
    const waived = new Set(snapshot.run.authorizedDefectManifest.waivedRequirementCodes || []);
    return reasons.includes('max_size_exceeded') &&
      reasons.every((code) => waived.has(code));
  }
  function ensureOriginalMediaThenExternal(snapshot, workspace) {
    const authorized = snapshot.run.authorizedDefectManifest?.defects?.some(
      (item) => item.defectCode === 'external_source_exhausted');
    if (snapshot.materialInputForm !== 'stream_file') {
      return authorized
        ? continueExternalOrAuthorizedDirectInput(snapshot, workspace)
        : ensureExternalSelection(snapshot, workspace);
    }
    const direct = directMediaSelectionWork(snapshot), submitted = submit(direct),
      status = options.workResultReader.status(direct.workId);
    if (!workSucceeded(status)) {
      if (workFailed(status)) return terminalWork(snapshot, direct, status);
      return Object.freeze({kind:'pending',phase:'workspace_media_direct_selection',libraRunId:snapshot.run.libraRunId,
        workId:direct.workId,replayed:submitted.replayed,workspaceId:workspace.workspaceId,
        workspaceRevision:workspace.currentRevision});
    }
    if (authorized) return ensureDelivery(snapshot, workspace, direct);
    return ensureExternalSelection(snapshot, workspace);
  }
  function ensureExternalSelection(snapshot, workspace) {
    const integrationHandle = options.resolveExternalMaterialIntegrationHandle?.({
      operationId: 'libra.external_material.search@1',
    });
    if (!integrationHandle || integrationHandle.integrationType !== 'moviepilot' ||
        integrationHandle.allowedOperation !== 'libra.external_material.search@1') {
      return Object.freeze({
        kind: 'waiting_external_integration',
        phase: 'external_search_selection',
        reasonCode: 'moviepilot_integration_unavailable',
        libraRunId: snapshot.run.libraRunId,
        workspaceId: workspace.workspaceId,
      });
    }
    for(let acquisitionAttempt=1;acquisitionAttempt<=5;acquisitionAttempt+=1){
      const search=externalSearchSelectionWork(snapshot,acquisitionAttempt),searchSubmitted=submit(search),
        searchStatus=options.workResultReader.status(search.workId);
      if(!workSucceeded(searchStatus)){
        if(workFailed(searchStatus))return terminalWork(snapshot,search,searchStatus,'integration_exhausted');
        return Object.freeze({kind:'pending',phase:'external_search_selection',acquisitionAttempt,
          libraRunId:snapshot.run.libraRunId,workId:search.workId,replayed:searchSubmitted.replayed,workspaceId:workspace.workspaceId});
      }
      const query=externalResult(externalSearchSelectionWork(snapshot,1),'libra.external_material.query.prepare@1'),maximum=query.maxDownloadAttempts,
        selectedCandidateRecord=externalResultRecord(search,'libra.external_material.candidate.select@1'),selectedCandidate=selectedCandidateRecord.result;
      if(acquisitionAttempt>maximum||selectedCandidate.result!=='selected')return freezeBusinessTerminal(snapshot,search,
        selectedCandidateRecord,selectedCandidate.selectionReasonCode||'download_attempt_limit_exhausted');
      const acquire=externalAcquireVerificationWork(snapshot,acquisitionAttempt),acquireSubmitted=submit(acquire),
        acquireStatus=options.workResultReader.status(acquire.workId);
      if(!workSucceeded(acquireStatus)){
        if(workFailed(acquireStatus))return terminalWork(snapshot,acquire,acquireStatus,'integration_exhausted');
        return Object.freeze({kind:'pending',phase:'external_acquire_verification',acquisitionAttempt,
          libraRunId:snapshot.run.libraRunId,workId:acquire.workId,replayed:acquireSubmitted.replayed,workspaceId:workspace.workspaceId});
      }
      const verifiedRecord=externalResultRecord(acquire,'libra.external_material.package.verify@1'),verified=verifiedRecord.result;
      if(verified.result!=='passed'){
        if(acquisitionAttempt<maximum)continue;
        return freezeBusinessTerminal(snapshot,acquire,verifiedRecord,verified.reasonCodes?.[0]||'external_package_rejected');
      }
      const imported=externalImportSelectionWork(snapshot,acquisitionAttempt),importSubmitted=submit(imported),
        importStatus=options.workResultReader.status(imported.workId);
      if(!workSucceeded(importStatus)){
        if(workFailed(importStatus))return terminalWork(snapshot,imported,importStatus,'integration_exhausted');
        return Object.freeze({kind:'pending',phase:'external_import_selection',acquisitionAttempt,
          libraRunId:snapshot.run.libraRunId,workId:imported.workId,replayed:importSubmitted.replayed,workspaceId:workspace.workspaceId});
      }
      attachWorkspaceOutputs(snapshot,workspace,imported);
      const selectionRecord=options.workResultReader.read(imported.workId).find((item)=>item.outcomeKind==='succeeded'&&
        item.capabilityRef==='libra.product_output.select@1'),selection=selectedOutput(imported);
      if(selection.result!=='selected'){
        if(acquisitionAttempt<maximum)continue;
        return freezeBusinessTerminal(snapshot,imported,selectionRecord,
          selection.reasonCodes?.[0]||selection.selectionReasonCode||'external_output_rejected');
      }
      return ensureDelivery(snapshot,workspace,imported);
    }
    throw new Error('External acquisition attempt loop escaped its configured bound.');
  }
  function continueExternalOrAuthorizedDirectInput(snapshot, workspace, context) {
    const authorized = snapshot.run.authorizedDefectManifest?.defects?.some(
      (item) => item.defectCode === 'external_source_exhausted');
    if (authorized && typeof context?.priorSelectionWorkId === 'string') {
      const persisted = options.workResultReader.readDefinition?.(
        context.priorSelectionWorkId,
      )?.definition;
      if (!persisted || persisted.ownerDomain !== 'libra' ||
          persisted.processType !== 'libra_run' ||
          persisted.processId !== snapshot.run.libraRunId ||
          persisted.executionBasisDigest !== snapshot.run.executionBasisDigest) {
        throw new Error(
          'Authorized direct-input selection Work changed from the frozen Run Basis.',
        );
      }
      return ensureDelivery(snapshot, workspace, Object.freeze({
        workId:persisted.workId,
        executionBasisDigest:persisted.executionBasisDigest,
      }));
    }
    return ensureExternalSelection(snapshot, workspace);
  }
  function ensureTranscodeSelection(snapshot,workspace,context) {
    for(let ordinal=1;ordinal<=64;ordinal+=1){
      const assessment=transcodeStrategyAssessmentWork(snapshot,ordinal),assessmentSubmitted=submit(assessment),
        assessmentStatus=options.workResultReader.status(assessment.workId);
      if(!workSucceeded(assessmentStatus)){
        if(workFailed(assessmentStatus)){
          const reasonCode=assessmentStatus?.latestAttempt?.failure_code||'transcode_assessment_failed';
          if(['media_device_strategies_exhausted','media_size_budget_infeasible'].includes(reasonCode))
            return continueExternalOrAuthorizedDirectInput(snapshot,workspace,context);
          return terminalWork(snapshot,assessment,assessmentStatus);
        }
        return Object.freeze({kind:'pending',phase:'transcode_strategy_assessment',libraRunId:snapshot.run.libraRunId,
          workId:assessment.workId,replayed:assessmentSubmitted.replayed,transcodeStrategyOrdinal:ordinal,
          workspaceId:workspace.workspaceId,workspaceRevision:workspace.currentRevision});
      }
      const assessmentResults=options.workResultReader.read(assessment.workId).filter((item)=>item.outcomeKind==='succeeded'&&
        item.capabilityRef==='libra.transcode.input.verify@1');
      if(assessmentResults.length!==1)throw new Error('Terminal Transcode Assessment lacks one Compatibility Result.');
      const compatibility=assessmentResults[0].result;
      if(compatibility.disposition==='integrity_rejected')return options.libraRunLifecycleService
        ?options.libraRunLifecycleService.freezeFailedWork(snapshot.run.libraRunId,assessment.workId,'source_integrity_rejected')
        :Object.freeze({kind:'integrity_rejected',libraRunId:snapshot.run.libraRunId,workId:assessment.workId,
          reasonCodes:compatibility.reasonCodes});
      if(compatibility.disposition==='strategy_rejected')continue;
      if(compatibility.disposition!=='compatible')throw new Error('Transcode Assessment disposition is invalid.');
      if(!sizeCapWaived(snapshot) && options.libraRunLifecycleService?.freezeTerminalResult){
        const intent=literalBinding(assessmentResults[0],'encodeIntent');
        const probe=literalBinding(assessmentResults[0],'mediaProbeEvidence');
        const forecast=sizeCapAdmissionForecast({
          maxSizeBytes:snapshot.spec?.requirements?.space?.maxSizeBytes,
          probe, intent,
        });
        if(forecast){
          return options.libraRunLifecycleService.freezeTerminalResult(
            snapshot.run.libraRunId, assessment.workId, 'product_unachievable',
            Object.freeze({
              eventId:assessmentResults[0].eventId,
              failureClass:'business_unachievable',
              failureCode:'size_cap_requires_admission',
              resultDigest:assessmentResults[0].resultDigest,
            }),
          );
        }
      }
      const work=transcodeMediaSelectionWork(snapshot,ordinal),submitted=submit(work),status=options.workResultReader.status(work.workId);
      if(workSucceeded(status)){
        attachWorkspaceOutputs(snapshot,workspace,work);
        const selection=selectedOutput(work);
        if(selection.result==='selected' || onlyWaivedSizeGap(work,snapshot))
          return ensureDelivery(snapshot,workspace,work);
        if(requiresExternalSource(work))return continueExternalOrAuthorizedDirectInput(snapshot,workspace,context);
        continue;
      }
      if(workFailed(status)){
        const reasonCode=status?.latestAttempt?.failure_code||'transcode_work_failed';
        if(['media_device_strategies_exhausted','media_size_budget_infeasible'].includes(reasonCode))
          return continueExternalOrAuthorizedDirectInput(snapshot,workspace,context);
        return terminalWork(snapshot,work,status);
      }
      return Object.freeze({kind:'pending',phase:'workspace_media_transcode_selection',libraRunId:snapshot.run.libraRunId,
        workId:work.workId,replayed:submitted.replayed,transcodeStrategyOrdinal:ordinal,
        workspaceId:workspace.workspaceId,workspaceRevision:workspace.currentRevision});
    }
    return continueExternalOrAuthorizedDirectInput(snapshot,workspace,context);
  }
  function ensureWorkspace(snapshot) {
    const id=workspaceId(snapshot.run.libraRunId),existing=options.movieProductionReader.readWorkspace(id);
    if(existing)return existing;
    const root=options.workspaceProductPort.rootSnapshot();
    const inputPrimaryTotalBytes=snapshot.members.filter((item)=>item.role==='primary_payload')
      .reduce((total,item)=>total+item.sizeBytes,0);
    const request=buildSpaceAdmissionRequest({workspaceId:id,libraRunId:snapshot.run.libraRunId,
      executionBasisDigest:snapshot.run.executionBasisDigest,rootId:root.rootId,rootSnapshotDigest:root.snapshotDigest,
      inputPrimaryTotalBytes,requiredFreeBytes:requiredFreeBytes(inputPrimaryTotalBytes)});
    const observedAtMs=(options.now||Date.now)();
    let evidence;
    try {
      evidence=options.workspaceProductPort.observeSpace({...request,
        requiredBytes:request.requiredFreeBytes,observedAtMs});
    } catch (error) {
      if (error?.code !== 'CLEAN_WORKSPACE_SPACE_UNAVAILABLE') throw error;
      return Object.freeze({kind:'workspace_admission_deferred',workspaceId:id,
        reasonCode:'insufficient_space',requiredFreeBytes:request.requiredFreeBytes});
    }
    const decision=buildWorkspaceAdmissionDecision({libraRunRef:{libraRunId:snapshot.run.libraRunId,
      stateRevision:snapshot.run.stateRevision,stateDigest:snapshot.run.stateDigest,
      executionBasisDigest:snapshot.run.executionBasisDigest},workspaceId:id,platformWorkspaceRootSnapshot:root,
      spaceAdmissionEvidence:evidence});
    workspaceAdmission.admit({decision,commitMarker:stable('libra-workspace-admission-marker-',{workspaceId:id,
      decisionDigest:decision.decisionDigest}),resultId:stable('libra-workspace-admission-result-',{workspaceId:id,
      decisionDigest:decision.decisionDigest})});
    const admitted=options.movieProductionReader.readWorkspace(id);
    if(!admitted)throw new Error('Admitted Libra Workspace cannot be reconstructed.');
    return admitted;
  }
  function ensureDelivery(snapshot,workspace,selectedMediaWork){
    productStaging.ensure(snapshot,Object.freeze({workId:selectedMediaWork.workId,workspaceId:workspace.workspaceId}));
    const conformance=productConformanceWork(snapshot,selectedMediaWork),conformanceSubmitted=submit(conformance),
      conformanceStatus=options.workResultReader.status(conformance.workId);
    if(!workSucceeded(conformanceStatus)){
      if(workFailed(conformanceStatus))return terminalWork(snapshot,conformance,conformanceStatus);
      return Object.freeze({kind:'pending',phase:'product_conformance',libraRunId:snapshot.run.libraRunId,
        workId:conformance.workId,replayed:conformanceSubmitted.replayed,workspaceId:workspace.workspaceId});
    }
    const conformanceResults=options.workResultReader.read(conformance.workId).filter((item)=>item.outcomeKind==='succeeded'&&
      item.capabilityRef==='libra.product.conformance.verify@1');
    if(conformanceResults.length!==1)throw new Error('Terminal Product Conformance Work lacks one durable Evidence Result.');
    const conformanceRecord=conformanceResults[0],evidence=conformanceRecord.result;
    if(evidence.result!=='passed' && !(snapshot.run.authorizedDefectManifest &&
      coversRequirementGaps(snapshot.run.authorizedDefectManifest,
        evidence.unmetRequirementCodes || evidence.reasonCodes || [])))return freezeBusinessTerminal(snapshot,conformance,conformanceRecord,
      evidence.unmetRequirementCodes?.[0] || evidence.reasonCodes?.[0] || 'product_conformance_failed');
    const promotion=deliverablePromotionWork(snapshot,selectedMediaWork,conformance,evidence),
      promotionSubmitted=submit(promotion),promotionStatus=options.workResultReader.status(promotion.workId);
    if(!workSucceeded(promotionStatus)){
      if(workFailed(promotionStatus))return terminalWork(snapshot,promotion,promotionStatus);
      return Object.freeze({kind:'pending',phase:'deliverable_promotion',libraRunId:snapshot.run.libraRunId,
        workId:promotion.workId,replayed:promotionSubmitted.replayed,verificationId:evidence.verificationId,
        workspaceId:workspace.workspaceId});
    }
    const receipts=options.workResultReader.read(promotion.workId).filter((item)=>item.outcomeKind==='succeeded'&&
      item.capabilityRef==='libra.product_package.publish@1');
    if(receipts.length!==1||receipts[0].result?.receiptKind!=='libra_product_package_published'||!receipts[0].result.offerId)
      throw new Error('Terminal Deliverable Promotion Work lacks one open Handoff B Offer receipt.');
    const receipt=receipts[0].result;
    return Object.freeze({kind:'handoff_b_offer_open',libraRunId:snapshot.run.libraRunId,workId:promotion.workId,
      conformanceWorkId:conformance.workId,verificationId:evidence.verificationId,onDeckPackageId:receipt.onDeckPackageId,
      packageRevision:receipt.packageRevision,packageDigest:receipt.packageDigest,offerId:receipt.offerId,
      workspaceId:workspace.workspaceId});
  }
  function reconcile(libraRunId){
    let snapshot;
    try { snapshot=typeof options.movieProductionReader.readRunSnapshot==='function'
      ?options.movieProductionReader.readRunSnapshot(libraRunId):options.movieProductionReader.readRun(libraRunId); }
    catch(error){if(error?.code==='P14_MOVIE_PRODUCTION_RUN_UNAVAILABLE')return Object.freeze({kind:'not_found',libraRunId});throw error;}
    if(snapshot.run.state!=='active' && snapshot.run.state!=='suspended')
      return Object.freeze({kind:'terminal',libraRunId,state:snapshot.run.state});
    const persistedConformanceFailure = freezePersistedConformanceFailure(snapshot);
    if (persistedConformanceFailure) return persistedConformanceFailure;
    const lifecycle = options.libraRunLifecycleService?.reconcile(libraRunId);
    if (lifecycle && lifecycle.kind !== 'ready') {
      if (['freshness_confirmed', 'resume'].includes(lifecycle.kind)) {
        return reconcile(libraRunId);
      }
      return Object.freeze({
        ...lifecycle,
        phase: lifecycle.kind === 'replacement_required'
          ? 'replacement_required' : 'run_lifecycle',
      });
    }
    if(snapshot.run.state!=='active')return Object.freeze({kind:'terminal',libraRunId,state:snapshot.run.state});
    const identity=options.movieProductionReader.readFact(libraRunId,'resolved_identity',1);
    let committed=identity;
    if(!committed){
      const nfoReferences=snapshot.relatedReferences.filter((item)=>item.role==='nfo').sort((a,b)=>a.referenceId.localeCompare(b.referenceId));
      const manualSelection=options.productIdentitySelection?.readCurrent(libraRunId)||null;
      const nfoWork=!manualSelection&&nfoReferences.length===1?identityObservationWork(snapshot,'related_nfo'):null;
      let nfoResult=null;
      if(nfoWork){const submitted=submit(nfoWork),status=options.workResultReader.status(nfoWork.workId);if(!workSucceeded(status)){if(workFailed(status))return terminalWork(snapshot,nfoWork,status,'product_unachievable');return Object.freeze({kind:'pending',phase:'product_identity_nfo',libraRunId,workId:nfoWork.workId,replayed:submitted.replayed});}nfoResult=options.workResultReader.read(nfoWork.workId).find((item)=>item.outcomeKind==='succeeded'&&item.capabilityRef==='libra.product_identity.evidence.observe@1');}
      const strongFact=nfoResult?.result?.result==='resolved'?nfoResult.result.verifiedIdentity:null;
      const observationWork=manualSelection?identityObservationWork(snapshot,'provider_exact',{workId:manualSelection.selection_intent_id,resultDigest:manualSelection.intent_digest}):
        strongFact?identityObservationWork(snapshot,'provider_exact',{workId:nfoWork.workId,resultDigest:nfoResult.resultDigest}):identityObservationWork(snapshot,'provider_search'),observationSubmitted=submit(observationWork),observationStatus=options.workResultReader.status(observationWork.workId);
      if(!workSucceeded(observationStatus)){
        if(workFailed(observationStatus))return terminalWork(snapshot,observationWork,observationStatus,'integration_exhausted');
        return Object.freeze({kind:'pending',phase:strongFact?'product_identity_exact_verification':'product_identity_search',libraRunId,
          workId:observationWork.workId,replayed:observationSubmitted.replayed});
      }
      const observationResult=options.workResultReader.read(observationWork.workId).find((item)=>item.outcomeKind==='succeeded'&&
        item.capabilityRef==='libra.product_identity.evidence.observe@1');
      if(!observationResult)throw new Error('Terminal Product Identity Observation Work lacks its durable Result.');
      if(observationResult.result?.result!=='resolved'||!observationResult.result.verifiedIdentity)return Object.freeze({kind:'waiting_product_identity',phase:'product_identity_observation',
        libraRunId,workId:observationWork.workId,observationId:observationResult.result?.observationId||null,
        reasonCode:observationResult.result?.reasonCode||'provider_identity_ambiguous',
        observationResult:observationResult.result?.result||'ambiguous'});
      const work=identityCommitWork(snapshot,{workId:observationWork.workId,resultDigest:observationResult.resultDigest}),
        submitted=submit(work),status=options.workResultReader.status(work.workId);
      if(!workSucceeded(status)){
        if(workFailed(status))return terminalWork(snapshot,work,status,'product_unachievable');
        return Object.freeze({kind:'pending',phase:'product_identity_commit',libraRunId,
          workId:work.workId,replayed:submitted.replayed,observationWorkId:observationWork.workId});
      }
      const result=options.workResultReader.read(work.workId).find((item)=>item.outcomeKind==='succeeded'&&
        item.capabilityRef==='libra.product_identity.resolve@1');
      committed=options.movieProductionReader.readFact(libraRunId,'resolved_identity',1);
      if(!result||!committed||result.result.identityDigest!==committed.factValue.identityDigest)
        throw new Error('Terminal Product Identity Work did not atomically publish its Product Fact.');
    }
    const metadataStage=nextMetadataStage(options,snapshot,committed);
    if(metadataStage.kind==='unavailable')return Object.freeze({
      kind:'waiting_external_integration', phase:'product_metadata_observation',libraRunId,
      reasonCode:metadataStage.reasonCode, missingFields:metadataStage.missingFields,
      missingCastRoles:metadataStage.missingCastRoles});
    if(metadataStage.kind==='unresolved'){
      const terminal=unresolvedMetadataTerminal(metadataStage);
      return freezeBusinessTerminal(snapshot,terminal.work,terminal.resultRecord,terminal.failureCode);
    }
    if(metadataStage.kind==='source'){
      const work=metadataObservationWork(snapshot,metadataStage.source),submitted=submit(work),
        status=options.workResultReader.status(work.workId);
      if(!workSucceeded(status)){
        if(workFailed(status))return terminalWork(snapshot,work,status,
          metadataStage.source.kind==='provider'?'integration_exhausted':'product_unachievable');
        return Object.freeze({kind:'pending',phase:'product_metadata_observation',libraRunId,
          workId:work.workId,replayed:submitted.replayed,identityDigest:committed.factValue.identityDigest,
          sourceKind:metadataStage.source.kind,sourcePriority:metadataStage.source.intent.sourcePriority});
      }
      options.wake?.();
      return Object.freeze({kind:'pending',phase:'product_metadata_source_committed',libraRunId,
        workId:work.workId,sourceKind:metadataStage.source.kind,
        sourcePriority:metadataStage.source.intent.sourcePriority});
    }
    if(metadataStage.kind!=='ready')throw new Error('Product Metadata stage is invalid.');
    const workspace=ensureWorkspace(snapshot);
    if(workspace.kind==='workspace_admission_deferred')return Object.freeze({kind:'waiting_for_resource',
      phase:'workspace_admission',libraRunId,workspaceId:workspace.workspaceId,
      reasonCode:workspace.reasonCode,requiredFreeBytes:workspace.requiredFreeBytes});
    const artifact=artifactWork(snapshot,workspace),artifactSubmitted=submit(artifact),artifactStatus=options.workResultReader.status(artifact.workId);
    if(!workSucceeded(artifactStatus)){
      if(workFailed(artifactStatus))return terminalWork(snapshot,artifact,artifactStatus);
      return Object.freeze({kind:'pending',phase:'artifact_production',libraRunId,workId:artifact.workId,
        replayed:artifactSubmitted.replayed,identityDigest:committed.factValue.identityDigest,
        workspaceId:workspace.workspaceId,workspaceRevision:workspace.currentRevision});
    }
    attachArtifactOutputs(snapshot,workspace);
    const artifactResults=options.workResultReader.read(artifact.workId).filter((item)=>item.outcomeKind==='succeeded'&&
      item.capabilityRef==='shared.artifact.manifest.verify@1');
    const expected=snapshot.spec.requirements.metadata.requiredArtifactKinds.length;
    if(artifactResults.length!==expected||artifactResults.some((item)=>item.result?.result!=='passed'))
      throw new Error('Terminal Artifact Work does not cover every mandatory Artifact Requirement.');
    const facts=productFactWork(snapshot,workspace,artifact),factsSubmitted=submit(facts),factsStatus=options.workResultReader.status(facts.workId);
    if(!workSucceeded(factsStatus)){
      if(workFailed(factsStatus))return terminalWork(snapshot,facts,factsStatus);
      return Object.freeze({kind:'pending',phase:'product_fact_assembly',libraRunId,workId:facts.workId,
        replayed:factsSubmitted.replayed,identityDigest:committed.factValue.identityDigest,
        workspaceId:workspace.workspaceId,workspaceRevision:workspace.currentRevision});
    }
    const mediaCast=options.movieProductionReader.readFact(libraRunId,'media_cast',1);
    const productMetadata=options.movieProductionReader.readFact(libraRunId,'product_metadata',1);
    const factResults=options.workResultReader.read(facts.workId).filter((item)=>item.outcomeKind==='succeeded');
    if(!mediaCast||!productMetadata||!factResults.some((item)=>item.capabilityRef==='libra.media_cast.commit@1')||
        !factResults.some((item)=>item.capabilityRef==='libra.product_metadata.commit@1'))
      throw new Error('Terminal Product Fact Work did not atomically publish the required Facts.');
    const sourceMedia=sourceMediaObservationWork(snapshot),sourceSubmitted=submit(sourceMedia),sourceStatus=options.workResultReader.status(sourceMedia.workId);
    if(!workSucceeded(sourceStatus)){
      if(workFailed(sourceStatus))return terminalWork(snapshot,sourceMedia,sourceStatus);
      return Object.freeze({kind:'pending',phase:'workspace_media_source_observation',libraRunId,
        workId:sourceMedia.workId,replayed:sourceSubmitted.replayed,workspaceId:workspace.workspaceId,
        workspaceRevision:workspace.currentRevision});
    }
    const sourceResults=options.workResultReader.read(sourceMedia.workId).filter((item)=>item.outcomeKind==='succeeded'&&
      item.capabilityRef==='shared.material.media.probe@1');
    if(sourceResults.length!==1)throw new Error('Terminal source media Observation Work lacks one durable Probe Result.');
    if(sourceRequiresExternalSearch(sourceResults[0].result,snapshot.spec?.requirements?.mandatoryMedia)){
      return ensureOriginalMediaThenExternal(snapshot,workspace);
    }
    if(snapshot.materialInputForm!=='stream_file'){
      const remux=remuxMediaSelectionWork(snapshot),remuxSubmitted=submit(remux),remuxStatus=options.workResultReader.status(remux.workId);
      if(!workSucceeded(remuxStatus)){
        if(workFailed(remuxStatus))return terminalWork(snapshot,remux,remuxStatus);
        return Object.freeze({kind:'pending',phase:'workspace_media_remux_selection',libraRunId,
          workId:remux.workId,replayed:remuxSubmitted.replayed,materialInputForm:snapshot.materialInputForm,
          workspaceId:workspace.workspaceId,workspaceRevision:workspace.currentRevision});
      }
      attachWorkspaceOutputs(snapshot,workspace,remux);
      const selection=selectedOutput(remux);
      if(selection.result!=='selected')return requiresExternalSource(remux)
        ?ensureExternalSelection(snapshot,workspace)
        :ensureTranscodeSelection(snapshot,workspace,
          {sourceWorkId:sourceMedia.workId,priorSelectionWorkId:remux.workId});
      return ensureDelivery(snapshot,workspace,remux);
    }
    const direct=directMediaSelectionWork(snapshot),directSubmitted=submit(direct),directStatus=options.workResultReader.status(direct.workId);
    if(!workSucceeded(directStatus)){
      if(workFailed(directStatus))return terminalWork(snapshot,direct,directStatus);
      return Object.freeze({kind:'pending',phase:'workspace_media_direct_selection',libraRunId,
        workId:direct.workId,replayed:directSubmitted.replayed,workspaceId:workspace.workspaceId,
        workspaceRevision:workspace.currentRevision});
    }
    const selection=selectedOutput(direct);
    if(selection.result!=='selected')return requiresExternalSource(direct)
      ?snapshot.run.authorizedDefectManifest?.defects?.some((item)=>item.defectCode==='external_source_exhausted')
        ?ensureDelivery(snapshot,workspace,direct)
        :ensureExternalSelection(snapshot,workspace)
      :ensureTranscodeSelection(snapshot,workspace,
        {sourceWorkId:sourceMedia.workId,priorSelectionWorkId:direct.workId});
    return ensureDelivery(snapshot,workspace,direct);
  }
  return Object.freeze({reconcile});
}

module.exports=Object.freeze({createLibraRunCoordinator,definitionForReplay,unresolvedMetadataTerminal,identityObservationWork,identityCommitWork,metadataObservationWork,artifactWork,productFactWork,
  sourceMediaObservationWork,directMediaSelectionWork,remuxMediaSelectionWork,transcodeMediaSelectionWork,
  transcodeStrategyAssessmentWork,
  externalSearchSelectionWork,externalAcquireVerificationWork,externalImportSelectionWork});
