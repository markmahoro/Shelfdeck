'use strict';
const {stagedResultReader}=require('../persistence/staged-manifest-store');
const { automaticCaseTargetsAcceptedDefect } = require('../model/accepted-defect-maintenance');
const { careFindingCodes, careFindingParameters, missingArtifactCustodyRefreshScope, freezeCareObjective } = require('../model/care-objective');
const { maintenanceRecoveryConditions } = require('../model/maintenance-recovery-conditions');

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { createWorkAdmission } = require('../../../foundation/execution/work-admission');
const { dispositionFromAssessments, assertProcessingRequirement, projectHealth, CAPABILITY_REFS:C, settlementScopeDigest,
  aftercareServiceCatalogRevision, buildAftercareSettlementHandles } = require('../model/aftercare-contract');
const { placementMaterialReceipts } = require('../model/aftercare-placement');
const { observeKnownOldBindings } = require('../model/known-old-binding');
const { projectAftercareProcess } = require('./aftercare-process-projection');

const LIMITS=Object.freeze({globalOpenWorks:256,ownerOpenWorks:256,openEvents:256});
// Revision 6 includes exact requirement gaps and independent Inventory playback
// evidence. Earlier assessments cannot prove this stronger health contract.
const ASSESSMENT_EXECUTION_REVISION=6;
const MAX_WORK_REPLACEMENTS=2;
const EXTERNAL_WRITER_FAILURES=new Set(['ARCA_AFTERCARE_NFO_SOURCE_STALE','PHYSICAL_MATERIAL_STAT_FENCE_CHANGED']);
const stable=(prefix,value)=>prefix+canonicalDigest(value).slice(0,40);
const succeeded=(value)=>value?.state==='succeeded'||value?.latestAttempt?.state==='succeeded';
const terminalFailure=(value)=>['failed','cancelled','timed_out'].includes(value?.state)||['failed','cancelled','timed_out'].includes(value?.latestAttempt?.state);
const lineageFailureCode=(value)=>value?.status?.latestAttempt?.failure_code||value?.status?.latestAttempt?.failureCode||value?.status?.failure_code||value?.status?.failureCode||null;
const exhaustedReason=(value,fallback)=>EXTERNAL_WRITER_FAILURES.has(lineageFailureCode(value))?'external_writer_conflict':fallback;

function projectActiveRepairProgress(works,prepareWorkId,atMs=Date.now()){
  const work=works.find((item)=>item.workId===prepareWorkId);
  if(!work)return Object.freeze({stage:'preparing',progressPercent:null,progress:null});
  const events=work.events||[],media=events.filter((event)=>
    ['arca.aftercare.media.transcode@1','arca.aftercare.media.remux@1'].includes(event.capabilityRef)),
    active=media.find((event)=>event.state==='executing'),sample=active?.progress||null;
  if(active){
    if(sample&&(!Number.isFinite(sample.sampledAtMs)||atMs-sample.sampledAtMs>120000))
      return Object.freeze({stage:'awaiting_media_progress',progressPercent:null,progress:null});
    const percent=sample?.mode==='determinate'&&sample.totalValue>0
    ?Math.min(99,Math.floor(sample.currentValue/sample.totalValue*100)):null;
    return Object.freeze({stage:'preparing_media',progressPercent:percent,progress:sample});}
  if(media.some((event)=>event.state==='waiting_for_resource'))
    return Object.freeze({stage:'waiting_for_resource',progressPercent:null,progress:null});
  const verification=events.find((event)=>event.capabilityRef==='arca.aftercare.media.verify@1');
  if(media.some((event)=>event.state==='succeeded')&&verification?.state!=='succeeded')
    return Object.freeze({stage:'verifying_media',progressPercent:null,progress:null});
  return Object.freeze({stage:'preparing',progressPercent:null,progress:null});
}

function createAftercareProcessCoordinator(options){
  const admission=createWorkAdmission({schemaManifest:options.schemaManifest,unitOfWork:options.unitOfWork,limits:LIMITS,
    eligibilityProvider:{check:(request)=>Object.freeze({eligible:request.ownerDomain==='arca'&&request.processType==='arca_shelf_entry',basisDigest:request.executionBasisDigest,reasonCode:'ARCA_AFTERCARE_BASIS_STALE'})}}),
    reader=options.contextReader,store=reader.store,now=options.now||Date.now;
  function definition(c,kind,identity,dependencyRefs,outputContractRef,workspaceMaterialScope=[]){const basisDigest=identity.basisDigest||c.basis.digest;return Object.freeze({schemaRef:'helix://foundation/types/SupportingWorkDefinition/v1',schemaVersion:1,workId:stable('arca-care-work-',{kind,...identity}),ownerDomain:'arca',processType:'arca_shelf_entry',processId:c.shelfEntryId,workKind:kind,workObjectiveTypeRef:'helix://arca/work/'+kind+'/v1',workObjectiveVersion:1,executionBasisId:stable('arca-care-basis-',{kind,...identity}),executionBasisDigest:basisDigest,dependencyRefs:Object.freeze(dependencyRefs),priorityClass:'normal_foreground',priorityRevision:1,capabilityCatalogScope:'arca',workspaceMaterialScope:Object.freeze(workspaceMaterialScope),idempotencyKey:stable('arca-care-key-',{kind,...identity}),concurrencyScope:'arca_shelf_entry/'+c.shelfEntryId+'/'+kind,outputContractRef});}
  function assessmentWork(c,cycleId,deep,replacementOrdinal=0){const identity={shelfEntryId:c.shelfEntryId,basisDigest:c.basis.digest,cycleId,deep,assessmentExecutionRevision:ASSESSMENT_EXECUTION_REVISION,...(replacementOrdinal>0?{replacementOrdinal}:{})},kind=(c.assessmentRequestOrigin==='periodic'?'periodic_':'')+(deep?'health_assessment':'custody_assessment');return definition(c,kind,identity,[{ownerDomain:'arca',objectType:'shelf_entry',objectId:c.shelfEntryId,revision:c.raw.entry.current_inventory_revision,digest:c.basis.digest},{ownerDomain:'arca',objectType:'assessment_cycle',objectId:cycleId,revision:ASSESSMENT_EXECUTION_REVISION,digest:canonicalDigest({cycleId,deep,assessmentExecutionRevision:ASSESSMENT_EXECUTION_REVISION})},...(c.assessmentRequestOrigin?[{ownerDomain:'arca',objectType:'assessment_request_origin',objectId:c.assessmentRequestOrigin,revision:1,digest:canonicalDigest(c.assessmentRequestOrigin)}]:[])],'helix://contracts/types/AssessmentRevision/v1');}
  function caseWork(c,kind,caseValue,extra=[],replacementOrdinal=0){const basisDigest=kind==='care_case_closure'?c.basis.digest:caseValue.careBasisDigest;return definition(c,kind,{shelfEntryId:c.shelfEntryId,basisDigest,aftercareCaseId:caseValue.aftercareCaseId,...(replacementOrdinal>0?{replacementOrdinal}:{})},[{ownerDomain:'arca',objectType:'aftercare_case',objectId:caseValue.aftercareCaseId,revision:1,digest:caseValue.careRequirementDigest},...extra],kind==='care_case_closure'?'helix://contracts/types/AftercareCaseResult/v1':kind==='care_deregistration_settlement'?'helix://contracts/types/ReclamationReceipt/v1':kind==='care_repair_commit'?'helix://contracts/types/AftercareInventoryCommitReceipt/v1':'helix://contracts/types/CareProductVerification/v1');}
  function submit(work){const result=admission.replay(work)||admission.submit(work);if(result?.kind==='invalid_contract')throw Object.assign(new Error('Aftercare Supporting Work violates Foundation contract.'),{code:result.reasonCode});return result;}
  function wait(work){submit(work);const status=options.workResultReader.status(work.workId);if(terminalFailure(status))return 'failed';return succeeded(status)?'succeeded':'pending';}
  function statusState(status){return terminalFailure(status)?'failed':succeeded(status)?'succeeded':'pending';}
  function advanceLineage(_c,makeWork,{allowReplacement=true}={}){let last=null;for(let replacementOrdinal=0;replacementOrdinal<=MAX_WORK_REPLACEMENTS;replacementOrdinal+=1){const work=makeWork(replacementOrdinal),status=options.workResultReader.status(work.workId);if(!status){if(replacementOrdinal>0&&(!allowReplacement||last?.state!=='failed'))break;const state=wait(work);return Object.freeze({work,state,replacementOrdinal,exhausted:state==='failed'&&replacementOrdinal===MAX_WORK_REPLACEMENTS,status:options.workResultReader.status(work.workId)});}const state=statusState(status),current=Object.freeze({work,state,replacementOrdinal,exhausted:state==='failed'&&replacementOrdinal===MAX_WORK_REPLACEMENTS,status});if(state!=='failed'||!allowReplacement)return current;last=current;}return last;}
  function inspectLineage(makeWork){let last=null;for(let replacementOrdinal=0;replacementOrdinal<=MAX_WORK_REPLACEMENTS;replacementOrdinal+=1){const work=makeWork(replacementOrdinal),status=options.workResultReader.status(work.workId);if(!status)break;const state=statusState(status);last=Object.freeze({work,state,replacementOrdinal,exhausted:state==='failed'&&replacementOrdinal===MAX_WORK_REPLACEMENTS});if(state!=='failed')break;}return last;}
  function runAssessment(c,cycleId,deep){return advanceLineage(c,(replacementOrdinal)=>assessmentWork(c,cycleId,deep,replacementOrdinal));}
  function completedAssessmentForHealth(c,health){
    const candidates=['health_assessment','periodic_health_assessment'].flatMap(workKind=>options.workResultReader.listWorks({ownerDomain:'arca',processType:'arca_shelf_entry',
      processId:c.shelfEntryId,workKind})).filter((item)=>item.state==='succeeded')
      .sort((a,b)=>Number(b.created_at_ms)-Number(a.created_at_ms));
    for(const candidate of candidates){
      const work=options.workResultReader.readDefinition(candidate.work_id)?.definition;
      if(!work||work.executionBasisDigest!==c.basis.digest)continue;
      const results=options.workResultReader.read(candidate.work_id).filter((item)=>item.outcomeKind==='succeeded');
      if(!results.some((item)=>item.capabilityRef===C.assessmentCommit&&item.result.careBasisDigest===c.basis.digest))continue;
      if(![['presentation',C.presentation],['conformance',C.conformance]].every(([kind,ref])=>
        results.some((item)=>item.capabilityRef===ref&&item.result.careBasisDigest===c.basis.digest&&
          item.result.payloadDigest===health.dimensions[kind].evidenceDigest)))continue;
      return Object.freeze({work,state:'succeeded'});
    }
    return null;
  }
  function caseDetail(aftercareCaseId){
    const care=store.getCase(aftercareCaseId);
    if(!care||care.state==='queued')return null;
    const workIds=[];
    for(const workKind of ['care_repair_prepare','care_repair_commit','health_assessment','care_case_closure','care_deregistration_settlement']){
      const works=options.workResultReader.listWorks({ownerDomain:'arca',processType:'arca_shelf_entry',
        processId:care.shelfEntryId,workKind});
      for(const work of works){
        const definition=options.workResultReader.readDefinition(work.work_id)?.definition;
        if(definition?.dependencyRefs.some(ref=>ref.ownerDomain==='arca'&&
          (ref.objectType==='aftercare_case'&&ref.objectId===aftercareCaseId&&ref.digest===care.careRequirementDigest||
           ref.objectType==='assessment_cycle'&&ref.objectId==='case-reassessment:'+aftercareCaseId)))workIds.push(work.work_id);
      }
    }
    const works=options.progressProjectionReader.read([care.shelfEntryId],{includePlans:true,workIds})
      .filter(work=>work.ownerDomain==='arca'&&work.processType==='arca_shelf_entry');
    return projectAftercareProcess(works,now());
  }
  function runCaseWork(c,kind,care,extra=[],settings){return advanceLineage(c,(replacementOrdinal)=>caseWork(c,kind,care,extra,replacementOrdinal),settings);}
  function inspectCaseWork(c,kind,care,extra=[]){return inspectLineage((replacementOrdinal)=>caseWork(c,kind,care,extra,replacementOrdinal));}
  function ensureSettlementApproval(c,care,inventoryCommit,prepare,commit){
    if(!commit||typeof options.workResultReader.readBindings!=='function'||
        typeof options.computeBoundedMaterialFingerprintSync!=='function')return null;
    const settlement=options.workResultReader.readBindings(commit.work.workId).find((item)=>item.capabilityRef===C.settlement);
    if(!settlement)return null;
    const frozenMaterials=reader.inventoryMaterials(c.shelfEntryId,care.careBasis.inventoryRevision),receipts=[
      ...options.workResultReader.read(commit.work.workId).filter((item)=>item.outcomeKind==='succeeded'&&item.capabilityRef===C.artifactMaterialize).map((item)=>item.result),
      ...placementMaterialReceipts(c,stagedResultReader(options),prepare.work.workId,care,frozenMaterials),
    ],handles=buildAftercareSettlementHandles({context:c,aftercareCaseId:care.aftercareCaseId,receipts,frozenMaterials,
      sourceTargetBinding:material=>reader.sourceTargetBinding(c.shelfEntryId,material),
      observedOldBindings:observeKnownOldBindings(c.raw,options.computeBoundedMaterialFingerprintSync),observedAtMs:inventoryCommit.committedAtMs});
    return store.issueSettlementApproval({aftercareCaseId:care.aftercareCaseId,settlementScopeDigest:settlementScopeDigest(handles),
      serviceCatalogRevision:aftercareServiceCatalogRevision(options.registry),shelfStandardRevision:care.careBasis.standardRevision,careBasisDigest:care.careBasisDigest,
      settlementEventId:settlement.eventId});
  }
  function modificationBlocked(c){return c.raw.shelf.status!=='active'||c.raw.reservations.some((item)=>item.state==='active');}
  function createCaseIfUnreserved(value){try{return store.createCase(value);}catch(error){if(error?.code==='ARCA_AFTERCARE_MODIFICATION_FENCED')return null;throw error;}}
  function stopCase(c,care,terminalState,reasonCode){
    store.staleSettlementApprovals?.(care.aftercareCaseId);
    const cancellation=typeof options.cancelProcessWorks==='function'?options.cancelProcessWorks({
      ownerDomain:'arca',processType:'arca_shelf_entry',processId:c.shelfEntryId,
      reasonCode:reasonCode==='accepted_defect_requires_manual_repair'?'ARCA_AFTERCARE_MANUAL_DEFECT_INTENT_REQUIRED':reasonCode==='care_basis_changed'?'ARCA_AFTERCARE_CASE_BASIS_STALE':reasonCode==='modification_fenced'?'ARCA_AFTERCARE_MODIFICATION_FENCED':'ARCA_AFTERCARE_REPAIR_EXHAUSTED',
    }):Object.freeze({drainingWorks:0});
    if(Number(cancellation?.drainingWorks||0)>0)return Object.freeze({kind:'case_fence_draining',
      shelfEntryId:c.shelfEntryId,aftercareCaseId:care.aftercareCaseId,reasonCode});
    const terminalEvidenceDigest=canonicalDigest({schema:'arca.aftercare-case-terminal-evidence@1',aftercareCaseId:care.aftercareCaseId,
      terminalState,reasonCode,careBasisDigest:care.careBasisDigest,currentBasisDigest:c.basis.digest});
    if(terminalState==='invalidated')store.terminateCase(care.aftercareCaseId,'invalidated',reasonCode,terminalEvidenceDigest);
    else store.terminateCase(care.aftercareCaseId,'unresolved',reasonCode,terminalEvidenceDigest);
    return Object.freeze({kind:terminalState==='invalidated'?'case_invalidated':'case_unresolved',shelfEntryId:c.shelfEntryId,
      aftercareCaseId:care.aftercareCaseId,reasonCode});
  }
  function stopForModificationFence(c,care){return stopCase(c,care,'invalidated','modification_fenced');}
  function basisMatchesCase(c,care,inventoryCommit){const frozen=care.careBasis;if(!inventoryCommit)return care.careBasisDigest===c.basis.digest;return Number(c.basis.inventoryRevision)===Number(inventoryCommit.newInventoryRevision)&&
    frozen.standardRevision===c.basis.standardRevision&&frozen.placementRevision===c.basis.placementRevision&&
    frozen.canonicalIdentityDigest===c.basis.canonicalIdentityDigest&&frozen.sourcePackageId===c.basis.sourcePackageId&&
    frozen.acceptedProductFactSetDigest===c.basis.acceptedProductFactSetDigest&&
    frozen.decisionFactSetDigest===c.basis.decisionFactSetDigest;}
  function progressCase(c,care){
    if(automaticCaseTargetsAcceptedDefect(c,care,store.history(c.shelfEntryId)))
      return stopCase(c,care,'unresolved','accepted_defect_requires_manual_repair');
    if(care.state==='queued'){if(modificationBlocked(c)||care.careBasisDigest!==c.basis.digest)return store.terminateCase(care.aftercareCaseId,'invalidated','queued_basis_changed',canonicalDigest({caseId:care.aftercareCaseId,basis:c.basis.digest}));const admitted=store.admitCase(care.aftercareCaseId);if(admitted.state!=='active')return Object.freeze({kind:'case_queued',shelfEntryId:c.shelfEntryId,aftercareCaseId:care.aftercareCaseId});care=admitted;}const history=store.history(c.shelfEntryId),inventoryCommit=history.commits.find((item)=>item.aftercareCaseId===care.aftercareCaseId);
    if(modificationBlocked(c))return stopForModificationFence(c,care);
    if(!basisMatchesCase(c,care,inventoryCommit))return stopCase(c,care,'invalidated','care_basis_changed');
    if(inventoryCommit){const prepare=inspectCaseWork(c,'care_repair_prepare',care);if(!prepare||prepare.state!=='succeeded')return stopCase(c,care,'unresolved','successful_prepare_work_missing');const commitExtra=[{ownerDomain:'arca',objectType:'repair_prepare_work',objectId:prepare.work.workId,revision:1,digest:care.careRequirementDigest}],commit=inspectCaseWork(c,'care_repair_commit',care,commitExtra);ensureSettlementApproval(c,care,inventoryCommit,prepare,commit);if(!commit)return stopCase(c,care,'unresolved','repair_commit_lineage_missing');if(commit.state==='failed')return stopCase(c,care,'unresolved','settlement_or_commit_failed');if(commit.state!=='succeeded')return Object.freeze({kind:'repair_commit_pending',aftercareCaseId:care.aftercareCaseId,workId:commit.work.workId,reasonCode:'settlement_pending'});const assessment=runAssessment(c,'case-reassessment:'+care.aftercareCaseId,true);if(assessment.state==='failed')return assessment.exhausted?stopCase(c,care,'unresolved','reassessment_exhausted'):Object.freeze({kind:'reassessment_retry_failed',reasonCode:'reassessment_failed',workId:assessment.work.workId,replacementOrdinal:assessment.replacementOrdinal,aftercareCaseId:care.aftercareCaseId});if(assessment.state!=='succeeded')return Object.freeze({kind:'reassessment_pending',workId:assessment.work.workId,aftercareCaseId:care.aftercareCaseId});const health=projectHealth(reader.read(c.shelfEntryId),store.history(c.shelfEntryId),now()),freshHealthy=Object.values(health.dimensions).every((item)=>item.state==='healthy'&&item.findings.length===0);if(!freshHealthy)return stopCase(c,care,'unresolved','reassessment_not_healthy');const current=reader.read(c.shelfEntryId),closureExtra=[{ownerDomain:'arca',objectType:'reassessment_work',objectId:assessment.work.workId,revision:1,digest:current.basis.digest},{ownerDomain:'arca',objectType:'repair_prepare_work',objectId:prepare.work.workId,revision:1,digest:care.careRequirementDigest},{ownerDomain:'arca',objectType:'repair_commit_work',objectId:commit.work.workId,revision:1,digest:inventoryCommit.commitDigest}],closure=runCaseWork(current,'care_case_closure',care,closureExtra);if(closure.exhausted)return stopCase(current,care,'unresolved','case_closure_exhausted');return Object.freeze({kind:closure.state==='succeeded'?'case_resolved':closure.state==='failed'?'case_closure_retry_failed':'case_closure_pending',workId:closure.work.workId,replacementOrdinal:closure.replacementOrdinal,aftercareCaseId:care.aftercareCaseId});}
    const prepare=runCaseWork(c,'care_repair_prepare',care);if(prepare.state==='failed')return prepare.exhausted?stopCase(c,care,'unresolved',exhaustedReason(prepare,'repair_preparation_exhausted')):Object.freeze({kind:'repair_preparation_retry_failed',reasonCode:'repair_preparation_failed',workId:prepare.work.workId,replacementOrdinal:prepare.replacementOrdinal,aftercareCaseId:care.aftercareCaseId});if(prepare.state!=='succeeded')return Object.freeze({kind:'repair_preparation_pending',workId:prepare.work.workId,aftercareCaseId:care.aftercareCaseId});const results=options.workResultReader.read(prepare.work.workId).filter((item)=>item.outcomeKind==='succeeded'),notAvailable=results.some((item)=>item.result?.resultKind==='not_available'),verificationFailed=results.some((item)=>item.result?.verificationKind==='aftercare_media'&&item.result.result!=='passed');if(notAvailable||verificationFailed)return stopCase(c,care,'unresolved',notAvailable?'provider_artifact_not_available':'media_verification_failed');
    const commitExtra=[{ownerDomain:'arca',objectType:'repair_prepare_work',objectId:prepare.work.workId,revision:1,digest:care.careRequirementDigest}],commit=runCaseWork(c,'care_repair_commit',care,commitExtra);if(commit.exhausted)return stopCase(c,care,'unresolved',exhaustedReason(commit,'repair_commit_exhausted'));return Object.freeze({kind:commit.state==='succeeded'?'inventory_committed':commit.state==='failed'?'repair_commit_retry_failed':'repair_commit_pending',workId:commit.work.workId,replacementOrdinal:commit.replacementOrdinal,aftercareCaseId:care.aftercareCaseId});}
  function refreshRecords(c,health,periodic=false){
    if(typeof options.refreshInventoryRecords!=='function')return Object.freeze({kind:'records_deferred',reasonCode:'record_refresh_unavailable'});
    const refresh=options.refreshInventoryRecords(c);
    if(refresh.kind!=='records_unchanged')return refresh;
    // The writer may have restored the original bytes since the recorded assessment.
    // Recheck once per finding kind set and periodic window, without creating a Case.
    const findings=[...new Set(Object.values(health.dimensions).flatMap(item=>item.findings.map(finding=>finding.findingKind)))].sort();
    const cycle=(periodic?'periodic:':'')+'record-recheck:'+canonicalDigest({basis:c.basis.digest,findings,window:Math.floor(now()/(24*60*60*1000))});
    const assessment=runAssessment(c,cycle,true);
    return Object.freeze({kind:assessment.state==='succeeded'?'records_rechecked':
      assessment.state==='failed'?'assessment_failed':'assessment_pending',workId:assessment.work.workId});
  }
  function reconcile(shelfEntryId,request={}){
    const origin=request.periodic===true?'periodic':typeof request.idempotencyKey==='string'&&request.idempotencyKey?'manual:'+request.idempotencyKey:null;
    const readContext=()=>{const value=reader.read(shelfEntryId);return value&&origin?{...value,assessmentRequestOrigin:origin}:value;};
    let c=readContext();if(!c)return Object.freeze({kind:'not_found',shelfEntryId});
    if(c.raw?.correctionGate)return Object.freeze({kind:'identity_correction_pending',shelfEntryId,correctionId:c.raw.correctionGate.correction_id});
    if(c.raw?.perceptionRating?.state==='pending'&&typeof options.ensurePerceptionRatingResolution==='function'){
      const resolution=options.ensurePerceptionRatingResolution(shelfEntryId);
      if(resolution?.kind!=='terminal')return Object.freeze({kind:'rating_resolution_pending',shelfEntryId,workId:resolution?.workId||null});
      c=readContext();
      if(c?.raw?.perceptionRating?.state==='pending')return Object.freeze({kind:'rating_resolution_pending',shelfEntryId,workId:null});
    }
    let history=store.history(shelfEntryId),active=history.cases.find((item)=>['queued','active'].includes(item.state));
    const periodic=request.periodic===true,manual=typeof request.idempotencyKey==='string'&&request.idempotencyKey.length>0;
    if(active&&periodic)return Object.freeze({kind:'case_deferred_to_normal_supply',shelfEntryId,aftercareCaseId:active.aftercareCaseId});
    if(!active&&!periodic&&!manual)return Object.freeze({kind:'no_active_case',shelfEntryId});
    if(active?.state!=='active'&&typeof options.refreshPersonRecords==='function'){
      const refresh=options.refreshPersonRecords(c);
      if(refresh.kind==='inventory_records_refreshed'){
        if(active?.state==='queued')store.terminateCase(active.aftercareCaseId,'invalidated','queued_basis_changed',canonicalDigest(refresh));
        return Object.freeze({...refresh,shelfEntryId});
      }
    }
    const projected=projectHealth(c,history,now()),recordGap=Object.values(projected.dimensions).some(item=>
      item.findings.some(finding=>finding.findingKind==='custody:nfo_identity_changed')),
      queuedRecordGoal=active?.state==='queued'&&active.careRequirement.typedParameters.some(item=>String(item.value).includes('nfo_identity_changed'));
    if((recordGap||queuedRecordGoal)&&active?.state!=='active'){
      if(typeof options.refreshInventoryRecords!=='function')return Object.freeze({kind:'records_deferred',shelfEntryId,reasonCode:'record_refresh_unavailable'});
      const refresh=refreshRecords(c,projected,periodic);
      if(['inventory_records_refreshed','records_rechecked'].includes(refresh.kind)&&active?.state==='queued')
        store.terminateCase(active.aftercareCaseId,'invalidated','queued_basis_changed',canonicalDigest(refresh));
      return Object.freeze({...refresh,shelfEntryId});
    }
    if(active)return progressCase(c,active);
    const health=projectHealth(c,history,now()),forced=typeof request.idempotencyKey==='string'&&request.idempotencyKey.length>0,
      custodyGapNeedsDeep=health.dimensions.custody.findings.some(item=>item.repairability==='auto_repair')&&
        health.dimensions.custody.assessedAtMs>Math.min(health.dimensions.presentation.assessedAtMs||0,health.dimensions.conformance.assessedAtMs||0),
      legacyConformance=health.dimensions.conformance.findings.some(item=>item.findingKind==='conformance:media_strategy_unavailable'),
      deep=forced||legacyConformance||custodyGapNeedsDeep||health.state==='never_assessed'||health.nextDeepDueAtMs<=now(),
      cycleId=forced?'manual:'+request.idempotencyKey:legacyConformance?'legacy-conformance:'+health.dimensions.conformance.evidenceDigest:custodyGapNeedsDeep?'custody-gap:'+health.dimensions.custody.evidenceDigest:
        (periodic?'periodic:':'')+(deep?'deep:':'custody:')+Math.floor(now()/(deep?7*24*60*60*1000:24*60*60*1000)),
      notDue=!forced&&!legacyConformance&&!custodyGapNeedsDeep&&health.state!=='never_assessed'&&Math.min(health.nextCustodyDueAtMs,health.nextDeepDueAtMs)>now();
    let assessment;
    if(notDue){
      const findings=Object.values(health.dimensions).flatMap((item)=>item.findings);
      if(dispositionFromAssessments([{findings}])!=='auto_repair')
        return Object.freeze({kind:'not_due',shelfEntryId,health});
      assessment=completedAssessmentForHealth(c,health);
      if(!assessment)return Object.freeze({kind:'assessment_provenance_unavailable',shelfEntryId,health});
    }else assessment=runAssessment(c,cycleId,deep);
    if(assessment.state==='failed')return Object.freeze({kind:'assessment_failed',shelfEntryId,workId:assessment.work.workId});
    if(assessment.state!=='succeeded')return Object.freeze({kind:'assessment_pending',shelfEntryId,workId:assessment.work.workId});
    c=readContext();
    history=store.history(shelfEntryId);
    const currentHealth=projectHealth(c,history,now());
    const missingArtifactScope=missingArtifactCustodyRefreshScope(c,currentHealth);
    if(missingArtifactScope.length) {
      const refreshed=runAssessment(c,(periodic?'periodic:':'')+'missing-artifact-custody:'+canonicalDigest({basis:c.basis.digest,materials:missingArtifactScope,
        custody:currentHealth.dimensions.custody.evidenceDigest,presentation:currentHealth.dimensions.presentation.evidenceDigest}),true);
      return Object.freeze({kind:refreshed.state==='failed'?'assessment_failed':'assessment_pending',shelfEntryId,
        reasonCode:'missing_artifact_custody_recheck',workId:refreshed.work.workId});
    }
    const findings=Object.values(currentHealth.dimensions).flatMap((item)=>item.findings);
    if(findings.some(item=>item.findingKind==='custody:nfo_identity_changed')){
      const refresh=refreshRecords(c,currentHealth,periodic);
      return Object.freeze({...refresh,shelfEntryId});
    }
    const disposition=dispositionFromAssessments([{findings}]);
    if(disposition!=='auto_repair')return Object.freeze({kind:disposition==='attention_required'?'attention_required':'terminal',shelfEntryId,workId:assessment.work.workId,health:currentHealth});
    if(modificationBlocked(c))return Object.freeze({kind:'modification_fenced',shelfEntryId,workId:assessment.work.workId,health:currentHealth});
    const findingSetDigest=canonicalDigest(findings.map((item)=>item.findingDigest).sort());
    const effects=findings.map((item)=>Object.freeze({objectId:item.findingId,revision:1,schemaRef:'helix://arca/types/RequiredCareEffect/v1',digest:item.findingDigest,objectKind:'required-effect'}));
    const typedParameters=careFindingParameters(findings);
    const recovery=maintenanceRecoveryConditions(findings,options.readFailureRecoveryConditions,c);
    const base={schemaRef:'helix://contracts/domain-types/CareRequirement/v1',schemaVersion:1,requirementId:stable('arca-care-requirement-',{shelfEntryId,basis:c.basis.digest,findingSetDigest,recoveryConditions:recovery.conditions}),revision:1,careBasisDigest:c.basis.digest,requiredEffects:Object.freeze(effects),acceptanceDigest:canonicalDigest(effects),typedParameters:Object.freeze([...typedParameters,...freezeCareObjective(c),recovery.parameter])};
    const requirement=Object.freeze({...base,digest:canonicalDigest(base)});
    try{assertProcessingRequirement(requirement);}catch(error){
      if(error.code!=='ARCA_AFTERCARE_PROCESSING_OBJECTIVE_REQUIRED')throw error;
      return Object.freeze({kind:'attention_required',reasonCode:'processing_objective_unavailable',shelfEntryId,
        workId:assessment.work.workId,health:currentHealth});
    }
    const triggerDigest=canonicalDigest({schema:'arca.aftercare-case-trigger@2',triggerKind:'health_maintenance',shelfEntryId,
      careBasisDigest:c.basis.digest,findingSetDigest,recoveryConditions:recovery.conditions});
    const care=createCaseIfUnreserved({shelfEntryId,careBasis:c.basis,findingSetDigest,careRequirement:requirement,triggerDigest,basisInputs:[
      {inputKind:'shelf_entry',ownerDomain:'arca',aggregateType:'shelf_entry',aggregateId:shelfEntryId,revision:c.raw.entry.current_inventory_revision,inputDigest:c.basis.digest},
      {inputKind:'canonical_identity',ownerDomain:'arca',aggregateType:'canonical_identity',aggregateId:shelfEntryId,revision:c.raw.entry.canonical_identity_revision,inputDigest:c.basis.canonicalIdentityDigest},
      {inputKind:'accepted_product_facts',ownerDomain:'arca',aggregateType:'inventory_product_facts',aggregateId:shelfEntryId,revision:c.raw.entry.current_inventory_revision,inputDigest:c.basis.acceptedProductFactSetDigest},
      {inputKind:'placement',ownerDomain:'arca',aggregateType:'shelf_placement',aggregateId:c.raw.shelf.shelf_id,revision:c.basis.placementRevision,inputDigest:c.raw.placement.policy_digest},
      {inputKind:'standard',ownerDomain:'arca',aggregateType:'shelf_standard',aggregateId:c.raw.shelf.shelf_id,revision:c.basis.standardRevision,inputDigest:c.raw.standard.standard_digest},
      {inputKind:'health_assessment_work',ownerDomain:'arca',aggregateType:'supporting_work',aggregateId:assessment.work.workId,revision:1,inputDigest:c.basis.digest},
    ]});
    if(!care)return Object.freeze({kind:'modification_fenced',shelfEntryId,workId:assessment.work.workId,health:currentHealth});
    if(!['queued','active'].includes(care.state))return Object.freeze({kind:'case_terminal',shelfEntryId,aftercareCaseId:care.aftercareCaseId,
      caseGeneration:care.caseGeneration,state:care.state,reasonCode:care.terminalReasonCode,evidenceDigest:care.terminalEvidenceDigest,health:currentHealth});
    return periodic?Object.freeze({kind:'case_queued',shelfEntryId,aftercareCaseId:care.aftercareCaseId}):progressCase(c,care);}
  function reconcileAssessmentCompletion(shelfEntryId,workId){
    const definition=options.workResultReader.readDefinition(workId)?.definition;
    if(!definition||definition.ownerDomain!=='arca'||definition.processType!=='arca_shelf_entry'||definition.processId!==shelfEntryId)
      throw new TypeError('Assessment completion requires the exact Owner Work.');
    const origin=definition.dependencyRefs.find(ref=>ref.ownerDomain==='arca'&&ref.objectType==='assessment_request_origin')?.objectId;
    return reconcile(shelfEntryId,origin==='periodic'?{periodic:true}:origin?.startsWith('manual:')?{idempotencyKey:origin.slice(7)}:{});
  }
  function caseProgress(shelfEntryId){
    const c=reader.read(shelfEntryId),history=c&&store.history(shelfEntryId),
      care=history?.cases.find(item=>['queued','active'].includes(item.state));
    if(!c||!care)return null;
    const goals=Object.freeze(careFindingCodes(care.careRequirement));
    if(care.state==='queued')return Object.freeze({aftercareCaseId:care.aftercareCaseId,stage:'queued',progressPercent:null,progress:null,goals});
    const inventoryCommit=history.commits.find(item=>item.aftercareCaseId===care.aftercareCaseId),
      prepare=inspectCaseWork(c,'care_repair_prepare',care),
      commitExtra=prepare?[{ownerDomain:'arca',objectType:'repair_prepare_work',objectId:prepare.work.workId,revision:1,digest:care.careRequirementDigest}]:[],
      commit=prepare?inspectCaseWork(c,'care_repair_commit',care,commitExtra):null,
      assessment=inventoryCommit&&commit?.state==='succeeded'?inspectLineage(ordinal=>assessmentWork(c,'case-reassessment:'+care.aftercareCaseId,true,ordinal)):null,
      closure=assessment&&prepare&&commit&&inventoryCommit?inspectCaseWork(c,'care_case_closure',care,[
        {ownerDomain:'arca',objectType:'reassessment_work',objectId:assessment.work.workId,revision:1,digest:c.basis.digest},
        {ownerDomain:'arca',objectType:'repair_prepare_work',objectId:prepare.work.workId,revision:1,digest:care.careRequirementDigest},
        {ownerDomain:'arca',objectType:'repair_commit_work',objectId:commit.work.workId,revision:1,digest:inventoryCommit.commitDigest}]):null,
      workIds=[prepare,commit,assessment,closure].filter(Boolean).map(item=>item.work.workId),
      works=typeof options.progressProjectionReader?.read==='function'
        ?options.progressProjectionReader.read([shelfEntryId],{workIds,includePlans:true}):[],
      mediaProgress=projectActiveRepairProgress(works,prepare?.work.workId,now()),
      currentAction=projectAftercareProcess(works,now()).currentAction;
    let stage=mediaProgress.stage;
    if(prepare?.state==='succeeded')stage='committing_inventory';
    if(commit?.state==='succeeded'&&inventoryCommit)stage='reassessing';
    if(prepare?.state==='failed'||commit?.state==='failed')stage='waiting_for_recovery';
    return Object.freeze({aftercareCaseId:care.aftercareCaseId,stage,currentAction,
      progressPercent:mediaProgress.progressPercent,progress:mediaProgress.progress,goals});
  }
  function reconcileWorkspaceLifecycle(aftercareCaseId){const lifecycle=store.inspectAftercareWorkspaceLifecycleHead(aftercareCaseId),registry=lifecycle.registry,care=store.getCase(aftercareCaseId);if(!care||!registry)return Object.freeze({kind:'not_found',aftercareCaseId});if(['queued','active'].includes(care.state))return Object.freeze({kind:'retained',aftercareCaseId,reasonCode:'case_active'});if(registry.state==='reclaimed')return Object.freeze({kind:'already_reclaimed',aftercareCaseId});if(registry.reclaim_after_ms===null){store.scheduleAftercareWorkspace?.(aftercareCaseId,Number(care.terminalAtMs));return Object.freeze({kind:'scheduled',aftercareCaseId});}if(Number(registry.reclaim_after_ms)>now())return Object.freeze({kind:'retained',aftercareCaseId,reasonCode:'retention_period_active'});const c=reader.read(care.shelfEntryId);if(!c)return Object.freeze({kind:'retained',aftercareCaseId,reasonCode:'shelf_entry_unavailable'});const audit=store.auditAftercareWorkspaceReferences(aftercareCaseId);if(!audit.ready)return Object.freeze({kind:'retained',aftercareCaseId,reasonCode:audit.reasonCode});const handles=store.listAftercareWorkspaceHandles(aftercareCaseId);if(handles.length>256)return Object.freeze({kind:'retained',aftercareCaseId,reasonCode:'workspace_scope_too_large'});const handleSetDigest=canonicalDigest(handles),workspaceMaterialScope=handles.map((handle)=>Object.freeze({handleSchemaRef:handle.schemaRef,handleId:handle.handleId,accessScope:handle.accessScope,fenceDigest:handle.fenceDigest})),prepare=inspectCaseWork(c,'care_repair_prepare',care),dependencyRefs=[{ownerDomain:'arca',objectType:'aftercare_case',objectId:care.aftercareCaseId,revision:1,digest:care.careRequirementDigest},...(prepare?[{ownerDomain:'arca',objectType:'repair_prepare_work',objectId:prepare.work.workId,revision:1,digest:care.careRequirementDigest}]:[])],work=definition(c,'care_workspace_reclaim',{shelfEntryId:c.shelfEntryId,basisDigest:care.careBasisDigest,aftercareCaseId,handleSetDigest,reclaimAfterMs:Number(registry.reclaim_after_ms)},dependencyRefs,'helix://contracts/types/ReclamationReceipt/v1',workspaceMaterialScope),state=wait(work);return Object.freeze({kind:state==='succeeded'?'workspace_reclaimed':state==='failed'?'workspace_reclaim_failed':'workspace_reclaim_pending',aftercareCaseId,workId:work.workId});}
  return Object.freeze({reconcile,reconcileAssessmentCompletion,reconcileWorkspaceLifecycle,stopForShelfDeregistration(shelfEntryId,aftercareCaseId){const c=reader.read(shelfEntryId),care=c&&store.history(shelfEntryId).cases.find((item)=>item.aftercareCaseId===aftercareCaseId&&['queued','active'].includes(item.state));return !c||!care?Object.freeze({kind:'already_terminal',shelfEntryId,aftercareCaseId}):stopForModificationFence(c,care);},requestCheck(shelfEntryId,idempotencyKey){return reconcile(shelfEntryId,{idempotencyKey});},project(shelfEntryId){const c=reader.read(shelfEntryId);return c?projectHealth(c,store.history(shelfEntryId),now()):null;},projectMany(shelfEntryIds){return new Map(reader.healthProjectionInputs(shelfEntryIds).map((item)=>[item.shelfEntryId,projectHealth(item,item.history,now())]));},caseProgress,caseDetail});
}

module.exports=Object.freeze({createAftercareProcessCoordinator,projectActiveRepairProgress});
