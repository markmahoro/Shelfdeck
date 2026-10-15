'use strict';
const {advanceSeriesExternalScope}=require('./series-external-scope-coordinator');
const {replacementScopes}=require('../planning/external-material-work');
const { candidateSeriesAnchor } = require('../model/series-identity-contracts');
const {nextJavIdentityStage}=require('../planning/jav-product-identity-work');

const { readDirectMediaSelections } = require('../planning/direct-media-selections');
const {readSeriesProductionCandidates,readSeriesMediaSelections,candidateSetDigest}=require('../planning/series-production-candidates');

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { createWorkAdmission } = require('../../../foundation/execution/work-admission');
const { createWorkspaceAdmissionStore } = require('../persistence/workspace-admission-store');
const { buildSpaceAdmissionRequest, buildWorkspaceAdmissionDecision, requiredFreeBytes, workspaceId } =
  require('../model/workspace-admission-contracts');
const { directMediaSelectionWork, remuxMediaSelectionWork, sourceMediaObservationWork,
  transcodeMediaSelectionWork,transcodeStrategyAssessmentWork,seriesFinalSelectionWork } = require('../planning/media-production-work');
const { readSourceMediaObservations } = require('../planning/source-media-observations');
const { createProductStagingService } = require('./product-staging-service');
const { productConformanceWork, deliverablePromotionWork } =
  require('../planning/product-delivery-work');
const {
  externalAcquireVerificationWork,
  externalImportSelectionWork,
  externalSearchSelectionWork,
} = require('../planning/external-material-work');
const {
  establishedSubjectIdentity,
  identityCommitWork,
  identityObservationWork,
} = require('../planning/product-identity-work');
const {
  metadataObservationWork,
  nextMetadataStage,
  requiredArtifactKinds,
} = require('../planning/product-metadata-work');
const { coversRequirementGaps } = require('../model/defect-admission-contracts');
const { sizeCapRetryDecision, sourceRequiresExternalSearch } = require('../model/media-production-contracts');
const {
  classifyVerifyGap,
  onlyRemuxGapFromVerification,
  shouldTranscodeExternalImport,
} = require('../model/media-production-routing');
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
      items:requiredArtifactKinds(snapshot)})};
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
    workspaceId:workspace.workspaceId,artifactWorkId:artifact?.workId||null};
  const artifactDependency=artifact?Object.freeze({ownerDomain:'libra',objectType:'supporting_work',objectId:artifact.workId,
    revision:1,digest:artifact.executionBasisDigest}):null;
  return Object.freeze({schemaRef:'helix://foundation/types/SupportingWorkDefinition/v1',schemaVersion:1,
    workId:stable('libra-product-fact-work-',basis),ownerDomain:'libra',processType:'libra_run',
    processId:snapshot.run.libraRunId,workKind:'product_fact_assembly',
    workObjectiveTypeRef:'helix://libra/work/product-fact-assembly/v1',workObjectiveVersion:1,
    executionBasisId:stable('libra-product-fact-basis-',basis),executionBasisDigest:snapshot.run.executionBasisDigest,
    dependencyRefs:Object.freeze(artifactDependency?[artifactDependency]:[]),priorityClass:priority(snapshot),
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
  function attachWorkingHandle(snapshot, workspace, handle, claims = snapshot.episodeClaims) {
    if (!handle?.handleId) return;
    productStaging.ensureWorking(snapshot, workspace.workspaceId, handle,
      Object.freeze(claims || []));
  }
  function attachWorkspaceOutputs(snapshot, workspace, work, member) {
    const results = options.workResultReader.read(work.workId)
      .filter((item) => item.outcomeKind === 'succeeded');
    for (const item of results) {
      attachWorkingHandle(snapshot, workspace,
        item.result?.workspaceMaterialHandle ||
        item.result?.workspaceMediaHandle?.workspaceMaterialHandle,member?.episodeClaims || snapshot.episodeClaims);
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
          evidence.unmetRequirementCodes || evidence.reasonCodes || [],evidence)) continue;
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
    return classifyVerifyGap(mediaVerification(work)) === 'spec_external';
  }
  function mediaVerificationRecord(work) {
    const values = options.workResultReader.read(work.workId).filter((item) =>
      item.outcomeKind === 'succeeded' &&
      item.capabilityRef === 'libra.product_media.verify@1');
    if (values.length !== 1) {
      throw new Error('Terminal media selection Work lacks one durable Product Media Verification.');
    }
    return values[0];
  }
  function findBestVolumeOnlyWorkspaceVerify(snapshot) {
    if (typeof options.workResultReader.listWorks !== 'function') return null;
    const works = options.workResultReader.listWorks({
      ownerDomain: 'libra',
      processType: 'libra_run',
      processId: snapshot.run.libraRunId,
      workKind: 'workspace_media_production',
    }).filter((item) => /transcode_\d+_selection-work-/.test(item.work_id));
    const candidates = works.flatMap((row) => {
      const record = options.workResultReader.read(row.work_id).find((item) =>
        item.outcomeKind === 'succeeded' &&
        item.capabilityRef === 'libra.product_media.verify@1' &&
        item.result?.candidateKind === 'workspace_output');
      if (!record || classifyVerifyGap(record.result) !== 'volume_only') return [];
      return [{ work: { workId: row.work_id }, record }];
    }).sort((left, right) => {
      const leftOrdinal = Number(/transcode_(\d+)_selection/.exec(left.work.workId)?.[1] || 0);
      const rightOrdinal = Number(/transcode_(\d+)_selection/.exec(right.work.workId)?.[1] || 0);
      return leftOrdinal - rightOrdinal;
    });
    return candidates[0] || null;
  }
  function tryFreezeMeasuredSizeCap(snapshot, work, verifyRecord) {
    if (sizeCapWaived(snapshot) || !options.libraRunLifecycleService?.freezeTerminalResult) return null;
    const verification = verifyRecord?.result;
    if (classifyVerifyGap(verification) !== 'volume_only') return null;
    return options.libraRunLifecycleService.freezeTerminalResult(
      snapshot.run.libraRunId, work.workId, 'product_unachievable',
      Object.freeze({
        eventId: verifyRecord.eventId,
        failureClass: 'business_unachievable',
        failureCode: 'size_cap_requires_admission',
        resultDigest: verifyRecord.resultDigest,
      }),
    );
  }
  function transcodeIntent(work) {
    return options.workResultReader.read(work.workId).find((item) =>
      item.outcomeKind === 'succeeded' &&
      item.capabilityRef === 'libra.media.transcode@1')?.inputBindings?.bindings
      ?.find((item) => item.portName === 'encodeIntent' &&
        item.bindingKind === 'literal')?.value || null;
  }
  function shouldFreezeMeasuredSizeCap(work, verifyRecord) {
    const verification=verifyRecord?.result,intent=transcodeIntent(work);
    if(classifyVerifyGap(verification)!=='volume_only'||
        !Number.isSafeInteger(intent?.video?.targetVideoBitrateBps)||
        !Number.isSafeInteger(intent?.video?.qualityFloorVideoBitrateBps))return false;
    const decision=sizeCapRetryDecision({
      previousTargetVideoBitrateBps:intent.video.targetVideoBitrateBps,
      maxSizeBytes:verification.spaceSummary.maxSizeBytes,
      actualSizeBytes:verification.spaceSummary.actualSizeBytes,
      qualityFloorVideoBitrateBps:intent.video.qualityFloorVideoBitrateBps,
    });
    return !decision.retryAllowed;
  }
  function sizeCapWaived(snapshot) {
    const codes = snapshot.run.authorizedDefectManifest?.waivedRequirementCodes || [];
    return codes.includes('max_size_exceeded');
  }
  function onlyWaivedSizeGap(work, snapshot) {
    if (!sizeCapWaived(snapshot)) return false;
    const reasons = mediaVerification(work).reasonCodes || [];
    const waived = new Set(snapshot.run.authorizedDefectManifest.waivedRequirementCodes || []);
    return reasons.includes('max_size_exceeded') &&
      reasons.every((code) => waived.has(code));
  }
  function ensureOriginalMediaThenExternal(snapshot, workspace, context = {}) {
    const authorized = snapshot.run.authorizedDefectManifest?.defects?.some(
      (item) => Boolean(item.originalMediaVerificationId));
    if (snapshot.materialInputForm !== 'stream_file') {
      return authorized
        ? continueExternalOrAuthorizedDirectInput(snapshot, workspace, context)
        : ensureExternalSelection(snapshot, workspace, context);
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
    return ensureExternalSelection(snapshot, workspace, Object.freeze({
      ...context,
      priorSelectionWorkId: direct.workId,
    }));
  }
  function ensureExternalSelection(snapshot, workspace, context = {}) {
    const integrationHandle = options.resolveExternalMaterialIntegrationHandle?.({
      operationId: 'libra.external_material.search@1',
    });
    if (!integrationHandle || integrationHandle.integrationType !== 'moviepilot' ||
        integrationHandle.allowedOperation !== 'libra.external_material.search@1') {
      if(options.waitUnavailableStrategy) {
        const pending=ensureDefectProductEvidence(snapshot);if(pending)return pending;
        return options.waitUnavailableStrategy(snapshot.run.libraRunId,'moviepilot','moviepilot_integration_unavailable');
      }
      return Object.freeze({
        kind: 'waiting_external_integration',
        phase: 'external_search_selection',
        reasonCode: 'moviepilot_integration_unavailable',
        libraRunId: snapshot.run.libraRunId,
        workspaceId: workspace.workspaceId,
      });
    }
    const search=externalSearchSelectionWork(snapshot),searchSubmitted=submit(search),
        searchStatus=options.workResultReader.status(search.workId);
      if(!workSucceeded(searchStatus)){
        if(workFailed(searchStatus))return terminalWork(snapshot,search,searchStatus,'integration_exhausted');
        return Object.freeze({kind:'pending',phase:'external_search_selection',
          libraRunId:snapshot.run.libraRunId,workId:search.workId,replayed:searchSubmitted.replayed,workspaceId:workspace.workspaceId});
      }
      const selectedCandidateRecord=externalResultRecord(search,'libra.external_material.candidate.select@1'),selectedCandidate=selectedCandidateRecord.result;
      if(selectedCandidate.result!=='selected')return freezeBusinessTerminal(snapshot,search,
        selectedCandidateRecord,selectedCandidate.selectionReasonCode);
      const acquire=externalAcquireVerificationWork(snapshot),acquireSubmitted=submit(acquire),
        acquireStatus=options.workResultReader.status(acquire.workId);
      if(!workSucceeded(acquireStatus)){
        if(workFailed(acquireStatus))return terminalWork(snapshot,acquire,acquireStatus,'integration_exhausted');
        return Object.freeze({kind:'pending',phase:'external_acquire_verification',
          libraRunId:snapshot.run.libraRunId,workId:acquire.workId,replayed:acquireSubmitted.replayed,workspaceId:workspace.workspaceId});
      }
      const verifiedRecord=externalResultRecord(acquire,'libra.external_material.package.verify@1'),verified=verifiedRecord.result;
      if(verified.result!=='passed'){
        return freezeBusinessTerminal(snapshot,acquire,verifiedRecord,verified.reasonCodes?.[0]||'external_package_rejected');
      }
      const imported=externalImportSelectionWork(snapshot),importSubmitted=submit(imported),
        importStatus=options.workResultReader.status(imported.workId);
      if(!workSucceeded(importStatus)){
        if(workFailed(importStatus))return terminalWork(snapshot,imported,importStatus,'integration_exhausted');
        return Object.freeze({kind:'pending',phase:'external_import_selection',
          libraRunId:snapshot.run.libraRunId,workId:imported.workId,replayed:importSubmitted.replayed,workspaceId:workspace.workspaceId});
      }
      attachWorkspaceOutputs(snapshot,workspace,imported);
      const selectionRecord=options.workResultReader.read(imported.workId).find((item)=>item.outcomeKind==='succeeded'&&
        item.capabilityRef==='libra.product_output.select@1'),selection=selectedOutput(imported);
      if(selection.result!=='selected'){
        const verifyRecord=mediaVerificationRecord(imported);
        if(onlyRemuxGapFromVerification(verifyRecord.result)){
          const remux=remuxMediaSelectionWork(snapshot),submitted=submit(remux),status=options.workResultReader.status(remux.workId);
          if(!workSucceeded(status))return workFailed(status)?terminalWork(snapshot,remux,status):Object.freeze({kind:'pending',phase:'workspace_media_remux_selection',libraRunId:snapshot.run.libraRunId,workId:remux.workId,replayed:submitted.replayed});
          attachWorkspaceOutputs(snapshot,workspace,remux);
          if(selectedOutput(remux).result==='selected')return ensureDelivery(snapshot,workspace,remux);
          return freezeBusinessTerminal(snapshot,remux,mediaVerificationRecord(remux),'external_output_rejected');
        }
        if(shouldTranscodeExternalImport(verifyRecord.result)){
          return ensureTranscodeSelection(snapshot,workspace,Object.freeze({
            ...context,
            externalImportWorkId:imported.workId,
            sourceKind:'external_workspace',
          }));
        }
        return freezeBusinessTerminal(snapshot,imported,selectionRecord,
          selection.reasonCodes?.[0]||selection.selectionReasonCode||'external_output_rejected');
      }
      return ensureDelivery(snapshot,workspace,imported);
  }
  function continueExternalOrAuthorizedDirectInput(snapshot, workspace, context) {
    const authorized = snapshot.run.authorizedDefectManifest?.defects?.some(
      (item) => Boolean(item.originalMediaVerificationId));
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
    return ensureExternalSelection(snapshot, workspace, context);
  }
  function ensureTranscodeSelection(snapshot,workspace,context={}) {
    for(let ordinal=1;ordinal<=64;ordinal+=1){
      const assessment=transcodeStrategyAssessmentWork(snapshot,ordinal),assessmentSubmitted=submit(assessment),
        assessmentStatus=options.workResultReader.status(assessment.workId);
      if(!workSucceeded(assessmentStatus)){
        if(workFailed(assessmentStatus)){
          const reasonCode=assessmentStatus?.latestAttempt?.failure_code||'transcode_assessment_failed';
          if(reasonCode==='media_device_strategies_exhausted')break;
          if(reasonCode==='media_size_budget_infeasible')continue;
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
      const work=transcodeMediaSelectionWork(snapshot,ordinal),submitted=submit(work),status=options.workResultReader.status(work.workId);
      if(workSucceeded(status)){
        attachWorkspaceOutputs(snapshot,workspace,work);
        const selection=selectedOutput(work);
        if(selection.result==='selected' || onlyWaivedSizeGap(work,snapshot))
          return ensureDelivery(snapshot,workspace,work);
        const verifyRecord=mediaVerificationRecord(work);
        if(shouldFreezeMeasuredSizeCap(work,verifyRecord)){
          const frozen=tryFreezeMeasuredSizeCap(snapshot,work,verifyRecord);
          if(frozen)return frozen;
        }
        if(requiresExternalSource(work))return continueExternalOrAuthorizedDirectInput(snapshot,workspace,context);
        continue;
      }
      if(workFailed(status)){
        const reasonCode=status?.latestAttempt?.failure_code||'transcode_work_failed';
        if(reasonCode==='media_device_strategies_exhausted')break;
        if(reasonCode==='media_size_budget_infeasible')continue;
        return terminalWork(snapshot,work,status);
      }
      return Object.freeze({kind:'pending',phase:'workspace_media_transcode_selection',libraRunId:snapshot.run.libraRunId,
        workId:work.workId,replayed:submitted.replayed,transcodeStrategyOrdinal:ordinal,
        workspaceId:workspace.workspaceId,workspaceRevision:workspace.currentRevision});
    }
    const measured=findBestVolumeOnlyWorkspaceVerify(snapshot);
    if(measured){
      const frozen=tryFreezeMeasuredSizeCap(snapshot,measured.work,measured.record);
      if(frozen)return frozen;
    }
    return continueExternalOrAuthorizedDirectInput(snapshot,workspace,context);
  }
  function ensureSeriesExternalScope(snapshot,workspace,scope) {
    const integration=options.resolveExternalMaterialIntegrationHandle?.({operationId:'libra.external_material.search@1'});
    if(!integration||integration.integrationType!=='moviepilot'||integration.allowedOperation!=='libra.external_material.search@1')
      return Object.freeze({kind:'waiting_external_integration',phase:'external_search_selection',reasonCode:'moviepilot_integration_unavailable',
        libraRunId:snapshot.run.libraRunId,workspaceId:workspace.workspaceId});
    return advanceSeriesExternalScope(snapshot,workspace,scope,{reader:options.workResultReader,submit,
      result:externalResultRecord,terminal:(work,status)=>terminalWork(snapshot,work,status,'integration_exhausted'),
      freeze:(work,row,reason)=>freezeBusinessTerminal(snapshot,work,row,reason),
      freezeMeasured:(work,row,exhausted)=>(exhausted||shouldFreezeMeasuredSizeCap(work,row))?tryFreezeMeasuredSizeCap(snapshot,work,row):null,
      attach:(handle,claims)=>attachWorkingHandle(snapshot,workspace,handle,claims)});
  }
  function ensureSeriesSelection(snapshot,workspace) {
    const pending=(work,phase,submitted)=>Object.freeze({kind:'pending',phase,libraRunId:snapshot.run.libraRunId,
      workId:work.workId,replayed:submitted.replayed,workspaceId:workspace.workspaceId});
    const scopes=replacementScopes(snapshot);
    const externalFor=member=>{
      const scope=scopes.find(item=>item.members.some(source=>source.materialKey===member.materialKey));
      if(!scope)throw new Error('Series external routing lacks its complete frozen Scope.');
      const progress=ensureSeriesExternalScope(snapshot,workspace,scope);
      return progress.kind==='series_external_ready'?ensureSeriesSelection(snapshot,workspace):progress;
    };
    for(const scope of scopes)if(options.workResultReader.status(externalSearchSelectionWork(snapshot,scope).workId)){
      const progress=ensureSeriesExternalScope(snapshot,workspace,scope);
      if(progress.kind!=='series_external_ready')return progress;
    }
    let candidates=readSeriesProductionCandidates(options,snapshot);
    for(const candidate of candidates) {
      if(candidate.eligible)continue;
      const member=candidate.member;
      if(classifyVerifyGap(candidate.verification)==='spec_external')return externalFor(member);
      if(onlyRemuxGapFromVerification(candidate.verification)) {
        const work=remuxMediaSelectionWork(snapshot,member),submitted=submit(work),status=options.workResultReader.status(work.workId);
        if(!workSucceeded(status))return workFailed(status)?terminalWork(snapshot,work,status):pending(work,'workspace_media_remux_selection',submitted);
        attachWorkspaceOutputs(snapshot,workspace,work,member);
        if(readSeriesProductionCandidates(options,snapshot).find(item=>item.member.materialKey===member.materialKey).eligible)continue;
      }
      let eligible=false,measured=null;
      for(let ordinal=1;ordinal<=64;ordinal++) {
        const assessment=transcodeStrategyAssessmentWork(snapshot,ordinal,member),submitted=submit(assessment),
          status=options.workResultReader.status(assessment.workId);
        if(!workSucceeded(status)) {
          if(!workFailed(status))return pending(assessment,'transcode_strategy_assessment',submitted);
          if(status.state==='failed'){
            const reason=status.latestAttempt?.failure_code;
            if(reason==='media_device_strategies_exhausted')break;
            if(reason==='media_size_budget_infeasible')continue;
          }
          return terminalWork(snapshot,assessment,status);
        }
        const record=externalResultRecord(assessment,'libra.transcode.input.verify@1');
        if(record.result.disposition==='integrity_rejected')return freezeBusinessTerminal(snapshot,assessment,record,'source_integrity_rejected');
        if(record.result.disposition==='strategy_rejected')continue;
        if(record.result.disposition!=='compatible')throw new Error('Series Assessment has an invalid disposition.');
        const work=transcodeMediaSelectionWork(snapshot,ordinal,member),workSubmitted=submit(work),workStatus=options.workResultReader.status(work.workId);
        if(!workSucceeded(workStatus)){
          if(!workFailed(workStatus))return pending(work,'workspace_media_transcode_selection',workSubmitted);
          if(workStatus.state==='failed'){
            const reason=workStatus.latestAttempt?.failure_code;
            if(reason==='media_device_strategies_exhausted')break;
            if(reason==='media_size_budget_infeasible')continue;
          }
          return terminalWork(snapshot,work,workStatus);
        }
        attachWorkspaceOutputs(snapshot,workspace,work,member);
        if(readSeriesProductionCandidates(options,snapshot).find(item=>item.member.materialKey===member.materialKey).eligible){eligible=true;break;}
        const verified=mediaVerificationRecord(work);
        if(classifyVerifyGap(verified.result)==='volume_only'&&!measured)measured={work,record:verified};
        if(shouldFreezeMeasuredSizeCap(work,verified)){
          const frozen=tryFreezeMeasuredSizeCap(snapshot,work,verified);if(frozen)return frozen;
        }
      }
      if(!eligible){
        if(measured){const frozen=tryFreezeMeasuredSizeCap(snapshot,measured.work,measured.record);if(frozen)return frozen;}
        return externalFor(member);
      }
    }
    candidates=readSeriesProductionCandidates(options,snapshot);
    for(const candidate of candidates.filter(item=>item.media))attachWorkspaceOutputs(snapshot,workspace,candidate.work,candidate.member);
    const work=seriesFinalSelectionWork(snapshot,candidateSetDigest(candidates),candidates.map(item=>item.work)),
      submitted=submit(work),status=options.workResultReader.status(work.workId);
    if(!workSucceeded(status))return workFailed(status)?terminalWork(snapshot,work,status):pending(work,'workspace_media_final_selection',submitted);
    const rejected=readSeriesMediaSelections(options,snapshot,work.workId).find(item=>item.selection.result!=='selected');
    if(rejected)return freezeBusinessTerminal(snapshot,work,rejected.verificationRecord,rejected.verification.reasonCodes[0]||'product_output_rejected');
    return ensureDelivery(snapshot,workspace,work);
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
    if(snapshot.run.secondaryTarget && !snapshot.run.authorizedDefectManifest) {
      const blocker=snapshot.run.secondaryTarget.blockedWorks[0];
      const record=options.workResultReader.read(blocker.workId).find(item=>item.eventId===blocker.terminalEventId);
      if(!record||record.resultDigest!==blocker.terminalEvidenceDigest)throw new Error('Secondary actor evidence changed.');
      return freezeBusinessTerminal(snapshot,{workId:blocker.workId},record,blocker.failureCode);
    }
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
        evidence.unmetRequirementCodes || evidence.reasonCodes || [],evidence)))return freezeBusinessTerminal(snapshot,conformance,conformanceRecord,
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
  function ensureDefectProductEvidence(snapshot) {
    if(snapshot.materialInputForm !== 'stream_file') return null;
    const libraRunId = snapshot.run.libraRunId, workspace=ensureWorkspace(snapshot);
    if(workspace.kind==='workspace_admission_deferred')return Object.freeze({kind:'waiting_for_resource',phase:'workspace_admission',libraRunId,reasonCode:workspace.reasonCode});
    for(const work of [sourceMediaObservationWork(snapshot),directMediaSelectionWork(snapshot)]) {
      const submitted=submit(work),status=options.workResultReader.status(work.workId);
      if(!workSucceeded(status))return workFailed(status)?terminalWork(snapshot,work,status):Object.freeze({kind:'pending',phase:'defect_product_safety',libraRunId,workId:work.workId,replayed:submitted.replayed});
    }
    return null;
  }
  function reconcile(libraRunId){
    let snapshot;
    try { snapshot=typeof options.movieProductionReader.readRunSnapshot==='function'
      ?options.movieProductionReader.readRunSnapshot(libraRunId):options.movieProductionReader.readRun(libraRunId); }
    catch(error){if(error?.code==='P14_MOVIE_PRODUCTION_RUN_UNAVAILABLE')return Object.freeze({kind:'not_found',libraRunId});throw error;}
    if(snapshot.run.state==='active' && snapshot.run.packageRevisionHead>0 && options.resolveRejectedRun) {
      const published=options.movieProductionReader.readPublishedDeliveryRef(libraRunId,snapshot.run.packageRevisionHead);
      if(published && options.movieProductionReader.readDeliveryReceipt(published.offerId)?.result==='rejected')
        return options.resolveRejectedRun(libraRunId);
    }
    if(snapshot.run.state==='frozen' && options.resolveFrozenRun) {
      const resolution=options.resolveFrozenRun(libraRunId);
      return resolution?.kind==='defect_admitted'?reconcile(libraRunId):resolution;
    }
    if(snapshot.run.state!=='active' && snapshot.run.state!=='suspended')
      return Object.freeze({kind:'terminal',libraRunId,state:snapshot.run.state});
    const persistedConformanceFailure = freezePersistedConformanceFailure(snapshot);
    if (persistedConformanceFailure) return persistedConformanceFailure;
    if(snapshot.spec.contentProfile==='series'){
      const scoped=options.resolveCurrentAcceptanceSpec(snapshot.run.subjectId,libraRunId);
      if(scoped.kind!=='ready')return Object.freeze({kind:'pending',phase:'run_scope_requirements',libraRunId,
        workId:scoped.workId||null,reasonCode:scoped.reasonCode||null});
    }
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
      if(snapshot.spec.contentProfile==='jav') {
        const stage=nextJavIdentityStage(options,snapshot);
        if(stage.kind==='waiting')return Object.freeze({kind:'waiting_product_identity',phase:'product_identity_observation',libraRunId,
          reasonCode:stage.reasonCode,observationId:stage.observationId||null,observationResult:stage.observationResult||'not_found'});
        if(stage.kind==='observation') {
          const submitted=submit(stage.work);
          return Object.freeze({kind:'pending',phase:'product_identity_search',libraRunId,workId:stage.work.workId,replayed:submitted.replayed});
        }
        const work=identityCommitWork(snapshot,{workId:stage.work.workId,resultDigest:stage.sourceResult.resultDigest}),submitted=submit(work),status=options.workResultReader.status(work.workId);
        if(!workSucceeded(status)) {
          if(workFailed(status))return terminalWork(snapshot,work,status,'product_unachievable');
          return Object.freeze({kind:'pending',phase:'product_identity_commit',libraRunId,workId:work.workId,replayed:submitted.replayed});
        }
        committed=options.movieProductionReader.readFact(libraRunId,'resolved_identity',1);
        if(!committed)throw new Error('Terminal JAV identity Work did not atomically publish its Fact.');
      }else {
      const nfoReferences=snapshot.relatedReferences.filter((item)=>item.role==='nfo').sort((a,b)=>a.referenceId.localeCompare(b.referenceId));
      const manualSelection=options.productIdentitySelection?.readCurrent(libraRunId)||null;
      const established=!manualSelection?establishedSubjectIdentity(options,snapshot):null;
      const candidateAnchor=!manualSelection&&!established?candidateSeriesAnchor(snapshot):null;
    const nfoWork=!manualSelection&&!established&&!candidateAnchor&&nfoReferences.length===1?identityObservationWork(snapshot,'related_nfo'):null;
      let nfoResult=null;
      if(nfoWork){const submitted=submit(nfoWork),status=options.workResultReader.status(nfoWork.workId);if(!workSucceeded(status)){if(workFailed(status))return terminalWork(snapshot,nfoWork,status,'product_unachievable');return Object.freeze({kind:'pending',phase:'product_identity_nfo',libraRunId,workId:nfoWork.workId,replayed:submitted.replayed});}nfoResult=options.workResultReader.read(nfoWork.workId).find((item)=>item.outcomeKind==='succeeded'&&item.capabilityRef==='libra.product_identity.evidence.observe@1');}
      const strongFact=nfoResult?.result?.result==='resolved'?nfoResult.result.verifiedIdentity:null;
      const observationWork=manualSelection?identityObservationWork(snapshot,'provider_exact',{workId:manualSelection.selection_intent_id,resultDigest:manualSelection.intent_digest}):
        established?identityObservationWork(snapshot,'provider_exact',established):
      candidateAnchor?identityObservationWork(snapshot,'provider_exact',candidateAnchor):
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
    }
    const currentRequirements=options.resolveCurrentAcceptanceSpec(snapshot.run.subjectId,snapshot.spec.contentProfile==='series'?libraRunId:null);
    if(currentRequirements.kind!=='ready')return Object.freeze({kind:'pending',phase:'formal_identity_rating_resolution',libraRunId,
      workId:currentRequirements.workId||null,reasonCode:currentRequirements.reasonCode||null});
    if(currentRequirements.spec.specDigest!==snapshot.spec.specDigest){
      options.wake?.();
      return Object.freeze({kind:'pending',phase:'acceptance_requirements_changed',libraRunId,
        acceptanceSpecId:currentRequirements.spec.acceptanceSpecId});
    }
    const metadataStage=nextMetadataStage(options,snapshot,committed);
    if(metadataStage.kind==='unavailable'&&options.waitUnavailableStrategy) {
      const pending=ensureDefectProductEvidence(snapshot);if(pending)return pending;
      return options.waitUnavailableStrategy(libraRunId,'tmdb',metadataStage.reasonCode);
    }
    if(metadataStage.kind==='unavailable')return Object.freeze({
      kind:'waiting_external_integration', phase:'product_metadata_observation',libraRunId,
      reasonCode:metadataStage.reasonCode, missingFields:metadataStage.missingFields,
      missingCastRoles:metadataStage.missingCastRoles});
    if(metadataStage.kind==='unresolved' && metadataStage.reasonCode==='product_metadata_required_cast_missing' &&
        !snapshot.run.secondaryTarget && options.libraRunLifecycleService?.enterSecondaryTarget) {
      const terminal=unresolvedMetadataTerminal(metadataStage);
      return options.libraRunLifecycleService.enterSecondaryTarget(libraRunId,terminal.work.workId,{
        eventId:terminal.resultRecord.eventId,resultDigest:terminal.resultRecord.resultDigest,
        failureCode:terminal.failureCode,failureClass:'business_unachievable'});
    }
    if(metadataStage.kind==='unresolved'){
      const pending = ensureDefectProductEvidence(snapshot);
      if(pending)return pending;
      const terminal=unresolvedMetadataTerminal(metadataStage);
      return freezeBusinessTerminal(snapshot,terminal.work,terminal.resultRecord,terminal.failureCode);
    }
    if(metadataStage.kind==='source'){
      const work=metadataObservationWork(snapshot,metadataStage.source),submitted=submit(work),
        status=options.workResultReader.status(work.workId);
      if(!workSucceeded(status)){
        if(workFailed(status))return ensureDefectProductEvidence(snapshot) || terminalWork(snapshot,work,status,
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
    const artifact=requiredArtifactKinds(snapshot).length?artifactWork(snapshot,workspace):null;
    if(artifact) {
    const artifactSubmitted=submit(artifact),artifactStatus=options.workResultReader.status(artifact.workId);
    if(!workSucceeded(artifactStatus)){
      if(workFailed(artifactStatus))return ensureDefectProductEvidence(snapshot)||terminalWork(snapshot,artifact,artifactStatus);
      return Object.freeze({kind:'pending',phase:'artifact_production',libraRunId,workId:artifact.workId,
        replayed:artifactSubmitted.replayed,identityDigest:committed.factValue.identityDigest,
        workspaceId:workspace.workspaceId,workspaceRevision:workspace.currentRevision});
    }
    const artifactResults=options.workResultReader.read(artifact.workId).filter((item)=>item.outcomeKind==='succeeded'&&
      item.capabilityRef==='shared.artifact.manifest.verify@1');
    const absentArtifact=artifactResults.find(item=>item.result?.result==='failed'&&
      item.result.reasonCodes?.includes('required_artifact_missing'));
    if(absentArtifact)return ensureDefectProductEvidence(snapshot)||
      freezeBusinessTerminal(snapshot,artifact,absentArtifact,'required_artifact_missing');
    if(artifactResults.some((item)=>item.result?.result!=='passed'))
      throw new Error('Terminal Artifact Work does not cover every mandatory Artifact Requirement.');
    // Attachment validates the exact Season/Episode target set and producer
    // bindings. A kind count cannot represent multiple Series NFO targets.
    attachArtifactOutputs(snapshot,workspace);
    }
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
    const sourceObservations=readSourceMediaObservations(options,snapshot);
    if(snapshot.materialInputForm==='stream_file' && snapshot.run.authorizedDefectManifest?.defects?.some(item=>Boolean(item.originalMediaVerificationId))) {
      const direct=directMediaSelectionWork(snapshot);
      if(!workSucceeded(options.workResultReader.status(direct.workId)))throw new Error('Authorized direct product lost its completed verification Work.');
      return ensureDelivery(snapshot,workspace,direct);
    }
    if(snapshot.spec.contentProfile!=='series'&&sourceObservations.some(item=>sourceRequiresExternalSearch(item.record.result,snapshot.spec?.requirements?.mandatoryMedia))){
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
        ?ensureExternalSelection(snapshot,workspace,{priorSelectionWorkId:remux.workId})
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
    if(snapshot.spec.contentProfile==='series') {
      const members=readDirectMediaSelections(options,snapshot,direct.workId);
      if(members.every(item=>item.selection.result==='selected')) return ensureDelivery(snapshot,workspace,direct);
      return ensureSeriesSelection(snapshot,workspace);
    }
    const selection=selectedOutput(direct);
    if(selection.result!=='selected' && onlyRemuxGapFromVerification(mediaVerification(direct))){
      const remux=remuxMediaSelectionWork(snapshot),remuxSubmitted=submit(remux),remuxStatus=options.workResultReader.status(remux.workId);
      if(!workSucceeded(remuxStatus)){
        if(workFailed(remuxStatus))return terminalWork(snapshot,remux,remuxStatus);
        return Object.freeze({kind:'pending',phase:'workspace_media_remux_selection',libraRunId,
          workId:remux.workId,replayed:remuxSubmitted.replayed,materialInputForm:snapshot.materialInputForm,
          workspaceId:workspace.workspaceId,workspaceRevision:workspace.currentRevision});
      }
      attachWorkspaceOutputs(snapshot,workspace,remux);
      const remuxSelection=selectedOutput(remux);
      if(remuxSelection.result!=='selected')return requiresExternalSource(remux)
        ?ensureExternalSelection(snapshot,workspace,{priorSelectionWorkId:remux.workId})
        :ensureTranscodeSelection(snapshot,workspace,
          {sourceWorkId:sourceMedia.workId,priorSelectionWorkId:remux.workId});
      return ensureDelivery(snapshot,workspace,remux);
    }
    if(selection.result!=='selected')return requiresExternalSource(direct)
      ?snapshot.run.authorizedDefectManifest?.defects?.some((item)=>Boolean(item.originalMediaVerificationId))
        ?ensureDelivery(snapshot,workspace,direct)
        :ensureExternalSelection(snapshot,workspace,{priorSelectionWorkId:direct.workId})
      :ensureTranscodeSelection(snapshot,workspace,
        {sourceWorkId:sourceMedia.workId,priorSelectionWorkId:direct.workId});
    return ensureDelivery(snapshot,workspace,direct);
  }
  return Object.freeze({reconcile,
    readJavIdentityStage(libraRunId) {
      const snapshot=options.movieProductionReader.readRunSnapshot(libraRunId);
      if(!snapshot || snapshot.spec.contentProfile!=='jav')return null;
      return Object.freeze({...nextJavIdentityStage(options,snapshot),claimedCode:snapshot.candidateIdentityClaim.javCode||null,
        sourceLocation:snapshot.members.find(member=>member.role==='primary_payload')?.location||null});
    }});
}

module.exports=Object.freeze({createLibraRunCoordinator,definitionForReplay,unresolvedMetadataTerminal,identityObservationWork,identityCommitWork,metadataObservationWork,artifactWork,productFactWork,
  sourceMediaObservationWork,directMediaSelectionWork,remuxMediaSelectionWork,transcodeMediaSelectionWork,
  transcodeStrategyAssessmentWork,
  externalSearchSelectionWork,externalAcquireVerificationWork,externalImportSelectionWork});
