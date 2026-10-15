'use strict';
const path=require('node:path');
const {canonicalDigest}=require('../../../contracts/canonical-json');
const {createJavCorrectionRecoveryReader}=require('../persistence/jav-correction-recovery-reader');
const {createStagedManifestStore}=require('../persistence/staged-manifest-store');
const {buildJavCorrectionBasis}=require('../model/jav-identity-correction');
const {recoveryMode,OBSERVATION_SCHEMA}=require('../model/jav-correction-recovery');
const {SOURCE_CAPABILITY,STAGE_CAPABILITY,javCorrectionAssetsWorkId,javCorrectionFilesWorkId,javCorrectionPublishWorkId,javCorrectionVerifyWorkId}=require('../model/jav-correction-execution-contract');
const {correctionCommitWorkId}=require('../model/jav-correction-commit-contract');
const {retirementWorkId}=require('../model/jav-correction-retirement-contract');
const {workspaceReclaimWorkId}=require('../model/jav-correction-workspace-reclaim-contract');
const fail=(details)=>{throw Object.assign(new Error('Recovery requires one exact terminal failed phase and a matching declared file scene.'),{code:'ARCA_JAV_CORRECTION_RECOVERY_UNPROVEN',...(details?{details}:{})});};
function createJavCorrectionRecoveryPreparation(options){
  const reader=createJavCorrectionRecoveryReader(options),stagedStore=createStagedManifestStore(options);
  return Object.freeze({async prepare(shelfEntryId,correctionId){
    const record=options.correctionStore.get(correctionId),mode=recoveryMode(record);
    if(!record||record.shelfEntryId!==shelfEntryId||!mode)fail();
    const execution=reader.read(record),works=new Map(execution.snapshot.works.map(work=>[work.work_id,work]));
    let scope,filePlan=null,manifest=null,retirementPlan=null,currentBasisDigest,assetsWorkId,selected=[];
    if(mode==='continue_correction'){
      const current=options.correctionContextReader.readForRecovery(correctionId);scope=current.scope;currentBasisDigest=record.proof.basis.basisDigest;
      assetsWorkId=javCorrectionAssetsWorkId(scope,record);
      selected.push({kind:'jav_correction_assets',base:javCorrectionAssetsWorkId(scope),id:assetsWorkId});
      if(works.get(assetsWorkId)?.state==='succeeded'){
        filePlan=options.filePlanPreparation.prepareForRecovery(correctionId,assetsWorkId);
        selected.push(...[['jav_correction_files',javCorrectionFilesWorkId],['jav_correction_publish',javCorrectionPublishWorkId],
          ['jav_correction_verify',javCorrectionVerifyWorkId],['jav_correction_commit',correctionCommitWorkId]].map(([kind,id])=>
          ({kind,base:id(scope,filePlan.planDigest),id:id(scope,filePlan.planDigest,record)})));
        const stageId=javCorrectionFilesWorkId(scope,filePlan.planDigest,record);
        if(works.get(stageId)?.state==='succeeded'){
          const rows=options.workResultReader.read(stageId).filter(row=>row.capabilityRef===STAGE_CAPABILITY&&row.state==='succeeded'&&row.outcomeKind==='succeeded');
          if(rows.length!==1)fail();manifest=stagedStore.resolve(rows[0].result);
        }
      }
    }else{
      const retirement=options.retirementPreparation.readScope(correctionId);scope=retirement.scope;retirementPlan=retirement.plan;
      filePlan=record.committedContext.filePlan;manifest=stagedStore.resolve(record.committedContext.stagedRecord);
      selected.push({kind:'jav_correction_formal_retirement',base:retirementWorkId(scope),id:retirementWorkId(scope,record)});
      if(works.get(selected[0].id)?.state==='succeeded'){
        const reclaim=options.workspaceReclaimPreparation.readScope(correctionId);scope=reclaim.scope;
        selected.push({kind:'jav_correction_workspace_reclaim',base:workspaceReclaimWorkId(scope),id:workspaceReclaimWorkId(scope,record)});
      }
      const raw=options.contextReader.read(shelfEntryId).raw,keys=[...new Set(raw.materials.map(row=>row.material_key))].sort(),controls=[];
      for(let offset=0;offset<keys.length;offset+=500)controls.push(...options.materialControlProjectionPort.getMaterialControlProjections(keys.slice(offset,offset+500)));
      currentBasisDigest=buildJavCorrectionBasis({raw:{...raw,correctionGate:null},controlProjections:controls,activeCases:options.contextReader.store.history(shelfEntryId).cases}).basisDigest;
      const assetScope={correctionId,digest:filePlan.scopeDigest};assetsWorkId=javCorrectionAssetsWorkId(assetScope,record);
    }
    const failures=selected.filter(item=>works.get(item.id)?.state==='failed');if(failures.length!==1)fail();
    const failure=failures[0],failed=works.get(failure.id);if(failed.work_kind!==failure.kind||failed.basis_digest!==scope.digest)fail();
    let sourceReference=record.recoveryIntent?.sourceResultReference||null;
    if(!sourceReference){
      const sources=execution.snapshot.events.filter(event=>event.work_id===assetsWorkId&&event.capability_ref===SOURCE_CAPABILITY&&event.state==='succeeded');
      if(sources.length>1)fail();
      if(sources.length){const result=execution.snapshot.results.find(result=>result.event_id===sources[0].event_id);if(!result)fail();
        sourceReference={workId:assetsWorkId,eventId:sources[0].event_id,resultDigest:result.result_digest};}
    }
    const verified=execution.source(sourceReference);
    if(!verified&&(failure.kind!=='jav_correction_assets'||execution.snapshot.effects.length||execution.snapshot.registries.length||execution.snapshot.materials.length||execution.snapshot.artifacts.length))fail();
    const registry=mode==='continue_correction'?options.workspaceStore.inspectRecovery(correctionId,record.admissionDigest):
      options.workspaceStore.inspectCommitted(correctionId,record.committedContext.contextDigest);
    const roots=[options.rootSnapshot.resolvedRoot],files=[],directories=[],requiredGroups=[],workspace=path.join(roots[0],correctionId+'-assets');
    function file(role,location,identities=[],extra={}){const index=files.length;files.push({role,location,identities:identities.filter(Boolean).map(identity=>identity.identity?identity:{identity}),...extra});return index;}
    const workspaceFiles=[];
    if(verified)for(const expected of verified.byteExpectations){
      const location=options.workspaceIo.location(correctionId,expected.kind).location,handle=registry.members.find(member=>member.relativePath.split('/')[0]===expected.kind);
      file('workspace_'+expected.kind,location,handle?[handle.physicalIdentity]:[],{byteDigest:expected.byteDigest,sizeBytes:expected.sizeBytes,
        missingAllowed:failure.kind==='jav_correction_workspace_reclaim'||failure.kind==='jav_correction_assets'&&!handle});
      const temporary=path.join(path.dirname(location),'.shelfdeck-writing-'+expected.byteDigest+'.part'),allowProducer=failure.kind==='jav_correction_assets';
      if(allowProducer)file('producer_temporary_'+expected.kind,temporary,[],{missingAllowed:true,
        producerRecipe:{byteDigest:expected.byteDigest,sizeBytes:expected.sizeBytes,registeredWorkspace:registry.registryExists}});
      workspaceFiles.push(location);directories.push({location:path.dirname(location),allowedMembers:allowProducer?[location,temporary]:[location]});
    }
    directories.push({location:workspace,allowedMembers:[...new Set(workspaceFiles.map(location=>path.dirname(location)))]});
    if(!filePlan){
      for(const material of record.proof.basis.materials)file('original_'+material.role,material.location,[material.physicalIdentity]);
      roots.push(options.contextReader.read(shelfEntryId).raw.shelf.target_root_location);
    }else if(mode==='continue_correction'){
      roots.push(filePlan.target.rootLocation);const stageDirectory=path.join(filePlan.target.rootLocation,'.shelfdeck-'+correctionId+'-stage'),stagePaths=[];
      for(const member of filePlan.members){
        const staged=manifest?.stagedMembers[member.ordinal],finalNeeded=['jav_correction_verify','jav_correction_commit'].includes(failure.kind),
          originalAlternatives=[member.original.physicalIdentity,...filePlan.members.filter(item=>item.targetLocation===member.original.location).map(item=>manifest?.stagedMembers[item.ordinal]?.physicalIdentity)].filter(Boolean),
          original=file('original_'+member.role,member.original.location,originalAlternatives,{missingAllowed:true}),
          retained=file('retained_'+member.role,member.retainedLocation,[member.original.physicalIdentity],{missingAllowed:!finalNeeded});
        requiredGroups.push([original,retained]);
        const stageLocation=staged?.location||path.join(stageDirectory,String(member.ordinal).padStart(4,'0')+'-'+path.basename(member.targetLocation));stagePaths.push(stageLocation);
        const source=member.source.workspaceMaterialHandle,identity=source?.physicalIdentity||member.original.physicalIdentity;
        file('stage_'+member.role,stageLocation,staged?[staged.physicalIdentity]:[{identity,inodeRequired:false}],{missingAllowed:failure.kind==='jav_correction_files'});
        const oldAtTarget=filePlan.members.find(item=>item.original.location===member.targetLocation);
        file('final_'+member.role,member.targetLocation,[staged?.physicalIdentity,...(!finalNeeded&&oldAtTarget?[oldAtTarget.original.physicalIdentity]:[])].filter(Boolean),{missingAllowed:!finalNeeded});
      }
      directories.push({location:stageDirectory,allowedMembers:stagePaths});
      const allowed=filePlan.members.flatMap(member=>[member.original.location,member.retainedLocation,member.targetLocation]);
      for(const directory of new Set(filePlan.members.map(member=>path.dirname(member.targetLocation))))directories.push({location:directory,allowedMembers:allowed.filter(location=>path.dirname(location)===directory)});
    }else{
      roots.push(retirementPlan.targetRoot);
      for(const member of retirementPlan.finals)file('final_'+member.role,member.location,[member.physicalIdentity]);
      for(const member of retirementPlan.retirements)file('retired_'+member.kind,member.location,[member.physicalIdentity],{missingAllowed:true});
      directories.push({location:retirementPlan.stageDirectory,allowedMembers:retirementPlan.retirements.filter(member=>member.kind==='stage_alias').map(member=>member.location)});
    }
    const realityObservation=await options.recoveryScene.observe({correctionId,phase:failure.kind,roots:[...new Set(roots)],files,directories,requiredGroups});
    if(realityObservation.classification!=='matching')fail({reasonCode:'file_changed',locations:realityObservation.files.filter(file=>file.status==='conflict').slice(0,8).map(file=>file.location)});
    const body={schema:'arca.jav-correction-recovery-observation@1',correctionId,admissionDigest:record.admissionDigest,stateRevision:record.stateRevision,updatedAtMs:record.updatedAtMs,
      previousIntentDigest:record.recoveryIntent?.receiptDigest||null,scopeDigest:scope.digest,executionRevision:record.recoveryIntent?.executionRevision||2,
      filePlanDigest:filePlan?.planDigest||null,sourceResultReference:sourceReference,realityClassification:'matching',realityDigest:canonicalDigest(realityObservation),realityObservation,
      failedWork:{ownerDomain:'arca',processType:'arca_jav_identity_correction',processId:correctionId,state:'failed',hasUnresolvedEffects:false,workKind:failure.kind,
        baseWorkId:failure.base,workId:failure.id,definitionDigest:failed.definition_digest,executionEvidenceDigest:execution.workEvidence(failure.id),basisDigest:scope.digest},executionSnapshot:execution.snapshot},
      observation={...body,observationDigest:canonicalDigest(body)};
    options.contractValidator.validate(OBSERVATION_SCHEMA,observation);
    return Object.freeze({currentBasisDigest,executionSnapshotDigest:execution.snapshotDigest,observation});
  }});
}
module.exports=Object.freeze({createJavCorrectionRecoveryPreparation});
