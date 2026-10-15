'use strict';
const {createWorkAdmission}=require('../../../foundation/execution/work-admission');
const {correctionCommitWorkId,SCHEMA:COMMIT_SCHEMA}=require('../model/jav-correction-commit-contract');
const {RESULT_SCHEMA:RETIREMENT_RESULT,retirementWorkId}=require('../model/jav-correction-retirement-contract');
const {RESULT_SCHEMA:RECLAIM_RESULT,workspaceReclaimWorkId}=require('../model/jav-correction-workspace-reclaim-contract');
const {javCorrectionAssetsWorkId,javCorrectionFilesWorkId,javCorrectionPublishWorkId,javCorrectionVerifyWorkId}=require('../model/jav-correction-execution-contract');
const OBJECTIVE='helix://arca/work/jav_correction_assets/v1';
function createJavCorrectionProcessCoordinator(options) {
  const admission=createWorkAdmission({schemaManifest:options.schemaManifest,unitOfWork:options.unitOfWork,
    limits:{globalOpenWorks:256,ownerOpenWorks:256,openEvents:256},eligibilityProvider:{check:request=>({eligible:request.ownerDomain==='arca'&&
      request.processType==='arca_jav_identity_correction',basisDigest:request.executionBasisDigest,reasonCode:'ARCA_JAV_CORRECTION_SCOPE_STALE'})}});
  return Object.freeze({reconcile(correctionId){let record=options.correctionStore.get(correctionId);
    if(!record)return {kind:'not_found',correctionId};
    if(record.state==='committed'){
      if(!['pending','active'].includes(record.cleanupState))return {kind:record.cleanupState,correctionId};
      if(options.workResultReader.status(record.committedContext.commitReference.workId)?.state!=='succeeded')return {kind:'commit_journal_pending',correctionId};
      if(record.cleanupState==='pending')record=options.correctionStore.updateCleanupState(correctionId,{expectedState:'pending',nextState:'active',contextDigest:record.committedContext.contextDigest});
      const {scope}=options.retirementPreparation.readScope(correctionId),workId=retirementWorkId(scope,record),definition={schemaRef:'helix://foundation/types/SupportingWorkDefinition/v1',schemaVersion:1,
        workId,ownerDomain:'arca',processType:'arca_jav_identity_correction',processId:correctionId,workKind:'jav_correction_formal_retirement',
        workObjectiveTypeRef:'helix://arca/work/jav_correction_formal_retirement/v1',workObjectiveVersion:1,executionBasisId:'arca-jav-retirement-basis-'+scope.digest.slice(0,40),
        executionBasisDigest:scope.digest,dependencyRefs:[{ownerDomain:'arca',objectType:'jav_correction_committed_context',objectId:correctionId,revision:record.stateRevision,digest:scope.committedContextDigest},
          ...(record.recoveryIntent?[{ownerDomain:'arca',objectType:'jav_correction_recovery_intent',objectId:record.recoveryIntent.recoveryId,revision:record.stateRevision,digest:record.recoveryIntent.receiptDigest}]:[])],
        priorityClass:'normal_foreground',priorityRevision:1,capabilityCatalogScope:'arca',workspaceMaterialScope:[],idempotencyKey:workId,
        concurrencyScope:'arca_jav_identity_correction/'+correctionId,outputContractRef:RETIREMENT_RESULT};
      if(!options.workResultReader.status(workId)){const submitted=admission.replay(definition)||admission.submit(definition);if(submitted.kind==='invalid_contract')throw Object.assign(new Error('Retirement Work contract is invalid.'),{code:submitted.reasonCode});}
      const status=options.workResultReader.status(workId);
      if(status?.state==='failed'){options.correctionStore.updateCleanupState(correctionId,{expectedState:'active',nextState:'attention_required',contextDigest:scope.committedContextDigest});return {kind:'cleanup_attention_required',correctionId,workId};}
      if(status?.state!=='succeeded')return {kind:'formal_retirement_pending',correctionId,workId};
      const reclaim=options.workspaceReclaimPreparation.readScope(correctionId),reclaimWorkId=workspaceReclaimWorkId(reclaim.scope,record),reclaimDefinition={...definition,
        workId:reclaimWorkId,workKind:'jav_correction_workspace_reclaim',workObjectiveTypeRef:'helix://arca/work/jav_correction_workspace_reclaim/v1',
        executionBasisId:'arca-jav-workspace-reclaim-basis-'+reclaim.scope.digest.slice(0,40),executionBasisDigest:reclaim.scope.digest,
        idempotencyKey:reclaimWorkId,outputContractRef:RECLAIM_RESULT};
      if(!options.workResultReader.status(reclaimWorkId)){const submitted=admission.replay(reclaimDefinition)||admission.submit(reclaimDefinition);
        if(submitted.kind==='invalid_contract')throw Object.assign(new Error('Workspace reclaim Work contract is invalid.'),{code:submitted.reasonCode});}
      const reclaimed=options.workResultReader.status(reclaimWorkId);
      if(reclaimed?.state==='failed'){options.correctionStore.updateCleanupState(correctionId,{expectedState:'active',nextState:'attention_required',contextDigest:scope.committedContextDigest});
        return {kind:'cleanup_attention_required',correctionId,workId:reclaimWorkId};}
      if(reclaimed?.state==='succeeded')return options.cleanupCompletion.complete(correctionId);
      return {kind:'workspace_reclaim_pending',correctionId,workId:reclaimWorkId};
    }
    if(record.state==='admitted')record=options.correctionStore.transition(correctionId,{expectedState:'admitted',expectedStateRevision:record.stateRevision,
      expectedAdmissionDigest:record.admissionDigest,nextState:'active'});
    if(record.state!=='active')return {kind:record.state,correctionId};
    const {scope}=options.correctionContextReader.read(correctionId),
      workId=javCorrectionAssetsWorkId(scope,record),definition={schemaRef:'helix://foundation/types/SupportingWorkDefinition/v1',schemaVersion:1,
        workId,ownerDomain:'arca',processType:'arca_jav_identity_correction',processId:correctionId,workKind:'jav_correction_assets',workObjectiveTypeRef:OBJECTIVE,workObjectiveVersion:1,
        executionBasisId:'arca-jav-correction-basis-'+scope.digest.slice(0,40),executionBasisDigest:scope.digest,
        dependencyRefs:[{ownerDomain:'arca',objectType:'jav_identity_correction',objectId:correctionId,revision:record.stateRevision,digest:record.admissionDigest},
          ...(record.recoveryIntent?[{ownerDomain:'arca',objectType:'jav_correction_recovery_intent',objectId:record.recoveryIntent.recoveryId,revision:record.stateRevision,digest:record.recoveryIntent.receiptDigest}]:[])],
        priorityClass:'normal_foreground',priorityRevision:1,capabilityCatalogScope:'arca',workspaceMaterialScope:[],
        idempotencyKey:workId,concurrencyScope:'arca_jav_identity_correction/'+correctionId,
        outputContractRef:'helix://contracts/types/JavCorrectionAssetsPrepared/v1'};
    const prior=options.workResultReader.status(workId);
    if(!prior){const submitted=admission.replay(definition)||admission.submit(definition);if(submitted.kind==='invalid_contract')throw Object.assign(new Error('Correction Work violates its Foundation contract.'),{code:submitted.reasonCode});}
    const status=options.workResultReader.status(workId);
    if(status?.state==='failed') {
      options.correctionStore.transition(correctionId,{expectedState:'active',expectedStateRevision:record.stateRevision,
        expectedAdmissionDigest:record.admissionDigest,nextState:'attention_required'});
      return {kind:'attention_required',correctionId,workId};
    }
    if(status?.state==='succeeded') {
      const filePlan=options.filePlanPreparation.prepare(correctionId,workId);
      const stageWorkId=javCorrectionFilesWorkId(scope,filePlan.planDigest,record),
        stageDefinition={...definition,workId:stageWorkId,workKind:'jav_correction_files',workObjectiveTypeRef:'helix://arca/work/jav_correction_files/v1',
          idempotencyKey:stageWorkId,
          outputContractRef:'helix://contracts/types/StagedInventoryManifestRecord/v1'};
      let staged=options.workResultReader.status(stageWorkId);
      if(!staged){const submitted=admission.replay(stageDefinition)||admission.submit(stageDefinition);
        if(submitted.kind==='invalid_contract')throw Object.assign(new Error('Correction stage Work violates its Foundation contract.'),{code:submitted.reasonCode});
        staged=options.workResultReader.status(stageWorkId);}
      if(staged?.state==='failed') {
        options.correctionStore.transition(correctionId,{expectedState:'active',expectedStateRevision:record.stateRevision,expectedAdmissionDigest:record.admissionDigest,nextState:'attention_required'});
        return {kind:'attention_required',correctionId,workId:stageWorkId};
      }
      if(staged?.state==='succeeded') {
        const publishWorkId=javCorrectionPublishWorkId(scope,filePlan.planDigest,record),
          publishDefinition={...stageDefinition,workId:publishWorkId,workKind:'jav_correction_publish',workObjectiveTypeRef:'helix://arca/work/jav_correction_publish/v1',
            idempotencyKey:publishWorkId,
            outputContractRef:'helix://contracts/types/PlacementSwitchReceipt/v1'};
        let published=options.workResultReader.status(publishWorkId);
        if(!published){const submitted=admission.replay(publishDefinition)||admission.submit(publishDefinition);
          if(submitted.kind==='invalid_contract')throw Object.assign(new Error('Correction publication Work violates its Foundation contract.'),{code:submitted.reasonCode});
          published=options.workResultReader.status(publishWorkId);}
        if(published?.state==='failed'){options.correctionStore.transition(correctionId,{expectedState:'active',expectedStateRevision:record.stateRevision,expectedAdmissionDigest:record.admissionDigest,nextState:'attention_required'});return {kind:'attention_required',correctionId,workId:publishWorkId};}
        if(published?.state==='succeeded') {
          const verifyWorkId=javCorrectionVerifyWorkId(scope,filePlan.planDigest,record),
            verifyDefinition={...stageDefinition,workId:verifyWorkId,workKind:'jav_correction_verify',workObjectiveTypeRef:'helix://arca/work/jav_correction_verify/v1',
              idempotencyKey:verifyWorkId,
              outputContractRef:'helix://contracts/types/FinalProductVerificationRecord/v1'};
          let verified=options.workResultReader.status(verifyWorkId);
          if(!verified){const submitted=admission.replay(verifyDefinition)||admission.submit(verifyDefinition);
            if(submitted.kind==='invalid_contract')throw Object.assign(new Error('Correction verification Work violates its Foundation contract.'),{code:submitted.reasonCode});
            verified=options.workResultReader.status(verifyWorkId);}
          if(verified?.state==='failed'){options.correctionStore.transition(correctionId,{expectedState:'active',expectedStateRevision:record.stateRevision,
            expectedAdmissionDigest:record.admissionDigest,nextState:'attention_required'});return {kind:'attention_required',correctionId,workId:verifyWorkId};}
          if(verified?.state==='succeeded') {
            const commitWorkId=correctionCommitWorkId(scope,filePlan.planDigest,record),commitDefinition={...stageDefinition,workId:commitWorkId,
              workKind:'jav_correction_commit',workObjectiveTypeRef:'helix://arca/work/jav_correction_commit/v1',outputContractRef:COMMIT_SCHEMA,
              idempotencyKey:commitWorkId};
            let committed=options.workResultReader.status(commitWorkId);
            if(!committed){const submitted=admission.replay(commitDefinition)||admission.submit(commitDefinition);
              if(submitted.kind==='invalid_contract')throw Object.assign(new Error('Correction commit Work violates its Foundation contract.'),{code:submitted.reasonCode});
              committed=options.workResultReader.status(commitWorkId);}
            if(committed?.state==='failed'){options.correctionStore.transition(correctionId,{expectedState:'active',expectedStateRevision:record.stateRevision,
              expectedAdmissionDigest:record.admissionDigest,nextState:'attention_required'});return {kind:'attention_required',correctionId,workId:commitWorkId};}
            return {kind:'commit_pending',correctionId,workId:commitWorkId,filePlan};
          }
          return {kind:'verification_pending',correctionId,workId:verifyWorkId,filePlan};
        }
        return {kind:'publication_pending',correctionId,workId:publishWorkId,filePlan};
      }
      return {kind:'files_pending',correctionId,workId:stageWorkId,filePlan};
    }
    return {kind:'assets_pending',correctionId,workId};
  }});
}
module.exports=Object.freeze({createJavCorrectionProcessCoordinator});
