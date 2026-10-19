'use strict';
const {canonicalDigest:D,canonicalJson:J}=require('../../../contracts/canonical-json');
const {createWorkAdmission}=require('../../../foundation/execution/work-admission');
const {createReconcileCursorStore}=require('../../../foundation/execution/reconcile-cursor-store');
const {createPeopleArtifactReclamationStore}=require('../persistence/reference-artifact-reclamation-store');
const {createPeopleArtifactAuditSource}=require('../persistence/reference-artifact-audit-source');
const {workFor}=require('../model/reference-artifact-reclamation-work');
const {AUDIT,RECLAIM,EVIDENCE,RECEIPT,INPUT,POLICY,assertEvidence,evidence}=require('../../../contracts/people-artifact-reclamation');
function fail(message){throw Object.assign(new Error(message),{code:'PEOPLE_ARTIFACT_AUDIT_INVALID'});}
function bodyOf(value){const {schemaRef,schemaVersion,evidenceId,evidenceKind,producerRef,basisDigest,payloadDigest,observedAtMs,...body}=value;return body;}
function createPeopleArtifactReclamation(options){
  const now=options.now||Date.now,validator=options.contractValidator,reader=options.workResultReader,store=createPeopleArtifactReclamationStore({...options,now}),
    cursors=createReconcileCursorStore({...options,now}),io=options.peopleImagePort?.reclamation,
    sources=[createPeopleArtifactAuditSource(options),...(options.artifactReferenceSources||[])],
    admission=createWorkAdmission({...options,limits:{globalOpenWorks:768,ownerOpenWorks:32,openEvents:512},eligibilityProvider:{check:request=>({eligible:
      request.ownerDomain==='people'&&request.processType==='people_artifact_reclamation',basisDigest:request.executionBasisDigest,reasonCode:'PEOPLE_ARTIFACT_AUDIT_INVALID'})}});
  function readySources(){if(!io||sources.length!==3||sources.map(item=>item.sourceId).join(',')!=='people_current,libra_frozen,arca_frozen')fail('Reclamation requires its real controlled root and all three Owner reference projections.');}
  function epochs(){readySources();return sources.map(source=>({sourceId:source.sourceId,epochDigest:source.epoch()}));}
  function definition(workId){const work=reader.readDefinition(workId)?.definition;
    if(!work||work.ownerDomain!=='people'||work.processType!=='people_artifact_reclamation'||!['reference_artifact_audit','reference_artifact_reclaim'].includes(work.workKind))fail('Audit requires its exact People Supporting Work.');return work;}
  function result(workId,expectedDigest=null){const matches=reader.read(workId).filter(row=>row.outcomeKind==='succeeded'&&row.state==='succeeded'&&[EVIDENCE,RECEIPT].includes(row.resultSchemaRef));
    if(matches.length!==1||expectedDigest&&matches[0].resultDigest!==expectedDigest||D(matches[0].result)!==matches[0].resultDigest)fail('Audit predecessor is not the exact successful immutable Result.');
    return matches[0];}
  function input(workId){const work=definition(workId),one=type=>{const refs=work.dependencyRefs.filter(ref=>ref.objectType===type);if(refs.length!==1)fail('Audit dependency is not unique.');return refs[0];},
    artifact=one('reference_artifact'),bootRef=one('reference_audit_boot'),seq=one('reference_audit_sequence'),previousRefs=work.dependencyRefs.filter(ref=>ref.objectType==='reference_audit_predecessor');
    if(previousRefs.length>1)fail('Audit predecessor is ambiguous.');
    const previous=previousRefs[0]?result(previousRefs[0].objectId,previousRefs[0].digest):null;
    if(previous&&previous.resultSchemaRef!==EVIDENCE)fail('Audit chain must continue from typed reference Evidence.');
    const artifactHandle=previous?assertEvidence(previous.result,validator).artifactHandle:store.artifact(artifact.objectId)?.handle,
      boot={bootId:bootRef.objectId,rootFenceDigest:bootRef.digest},sequence=Number(seq.objectId),phase=work.workKind==='reference_artifact_audit'?'audit':'reclaim';
    if(!artifactHandle||!Number.isSafeInteger(sequence)||sequence<0||D(sequence)!==seq.digest||artifact.revision!==artifactHandle.referenceRevision||artifact.digest!==D(artifactHandle)||
      J(workFor({artifactHandle,boot,sequence,phase,previous:previous?{workId:previous.workId,resultDigest:previous.resultDigest}:null}))!==J(work))fail('Audit Work, Artifact or predecessor dependency changed.');
    const value={schemaRef:INPUT,schemaVersion:1,artifactHandle,...boot,previousEvidence:previous?.result||null};validator.validate(INPUT,value);return value;}
  function audit(workId){const work=definition(workId),value=input(workId),currentEpochs=epochs(),currentBoot=io.snapshot(),previous=value.previousEvidence,
    first={artifactHandle:value.artifactHandle,policyDigest:D(POLICY),bootId:value.bootId,rootFenceDigest:value.rootFenceDigest,sourceEpochs:currentEpochs,
      round:1,sourceIndex:0,cursor:null,status:'scanning',firstPassCompletedAtMs:null,pageCount:0,chainDigest:D({schema:'people.reference-audit-chain@1',artifactHandle:value.artifactHandle,bootId:value.bootId})},
    at=now();let body=previous?bodyOf(previous):first;
    if(currentBoot.bootId!==value.bootId||currentBoot.rootFenceDigest!==value.rootFenceDigest||previous&&D(previous.sourceEpochs)!==D(currentEpochs))
      return evidence({...body,status:'changed'},work.executionBasisDigest,at);
    if(previous?.status==='waiting'){
      if(previous.firstPassCompletedAtMs===null||at-previous.firstPassCompletedAtMs<POLICY.quietMs)fail('Audit second pass started before its quiet interval.');
      body={...body,round:2,sourceIndex:0,cursor:null,status:'scanning'};
    }else if(previous&&previous.status!=='scanning')fail('Audit predecessor cannot continue scanning.');
    if(!store.currentReferences(value.artifactHandle))return evidence({...body,status:'retained'},work.executionBasisDigest,at);
    const page=sources[body.sourceIndex].page({artifactHandle:value.artifactHandle,cursor:body.cursor,atMs:at}),
      next={...body,pageCount:body.pageCount+1,chainDigest:D({previous:body.chainDigest,pageDigest:page.pageDigest}),cursor:page.nextCursor};
    if(page.referenced||sources[0].resolvesReferenceAssets(page.referenceAssetIds||[],value.artifactHandle))next.status='retained';
    else if(page.done){next.sourceIndex++;next.cursor=null;
      if(next.sourceIndex===3){next.status=next.round===1?'waiting':'eligible';if(next.round===1)next.firstPassCompletedAtMs=at;}}
    return evidence(next,work.executionBasisDigest,at);
  }
  function current(context){const work=definition(context.workId);if(context.ownerScope?.domain!=='people'||context.ownerScope.processType!==work.processType||context.ownerScope.processId!==work.processId)fail('Execution does not belong to this exact People process.');return work;}
  function executeReclaim(context){current(context);const value=input(context.workId),proof=value.previousEvidence;assertEvidence(proof,validator);
    if(proof.status!=='eligible'||D(context.namedInputs.peopleArtifactReferenceEvidence)!==D(proof))fail('Reclaim input is not its exact eligible audit Result.');
    return io.reclaim({context,evidence:proof,replay:()=>store.replay(context),readRegistry:()=>store.artifact(proof.artifactHandle.artifactHandleId),
      authority:()=>options.maintenanceBatchAllowed?.()===true&&D(epochs())===D(proof.sourceEpochs)&&store.currentReferences(proof.artifactHandle,D(['workspace_write',context.idempotencyKey])),
      claim:request=>{const readFence=options.unitOfWork.captureReadFence();if(D(epochs())!==D(proof.sourceEpochs))fail('Owner reference views changed before deletion claim.');
        return store.claim({...request,execution:context,evidence:proof,readFence,guards:[sources[0].participant(proof.sourceEpochs[0].epochDigest,proof.artifactHandle,now()),io.rootReadParticipant()]});},
      settle:request=>store.settle({...request,execution:context,evidence:proof,guards:[io.rootReadParticipant()]})});
  }
  function reconcile({artifactHandleId}){
    const record=store.artifact(artifactHandleId);if(!record||!['active','gc_eligible'].includes(record.state)||!['reference-image','reference-embedding'].includes(record.handle.artifactKind)||now()-record.createdAtMs<POLICY.artifactAgeMs)return {kind:'retained'};
    readySources();const key={ownerDomain:'people',reconcilerKey:'reference-artifact:'+artifactHandleId},head=cursors.read(key),pointer=head.cursor?JSON.parse(head.cursor):{lastWorkId:null,sequence:0,finishedWindow:null},window=options.maintenanceWindowKey?.();
    if(!window||options.maintenanceBatchAllowed?.()!==true||pointer.finishedWindow===window)return {kind:'waiting'};
    let previous=null,phase='audit',boot=io.snapshot(),artifactHandle=record.handle;
    if(pointer.lastWorkId){const status=reader.status(pointer.lastWorkId);if(status&&!['succeeded','failed','cancelled'].includes(status.state))return {kind:'in_flight',workId:pointer.lastWorkId};
      if(status?.state==='succeeded'){const row=result(pointer.lastWorkId),value=row.result;
        if(row.resultSchemaRef===RECEIPT||['retained','changed'].includes(value.status)){
          cursors.advance({...key,expectedRevision:head.revision,cursor:J({...pointer,lastWorkId:null,finishedWindow:window})});return {kind:'complete'};}
        if(value.status==='waiting'&&now()-value.firstPassCompletedAtMs<POLICY.quietMs)return {kind:'quiet_interval'};
        if(value.bootId===boot.bootId&&value.rootFenceDigest===boot.rootFenceDigest||record.state==='gc_eligible'){
          artifactHandle=value.artifactHandle;boot={bootId:value.bootId,rootFenceDigest:value.rootFenceDigest};previous={workId:row.workId,resultDigest:row.resultDigest};
          phase=value.status==='eligible'?'reclaim':'audit';}
      }else{if(record.state==='gc_eligible')return {kind:'recovery_required'};
        cursors.advance({...key,expectedRevision:head.revision,cursor:J({...pointer,lastWorkId:null,finishedWindow:window})});return {kind:'failed_isolated'};}}
    const work=workFor({artifactHandle,boot,previous,sequence:pointer.sequence,phase}),admitted=admission.replay(work)||admission.submit(work);
    if(admitted.kind==='deferred')return {kind:'deferred'};if(admitted.kind==='invalid_contract')fail('Reference Artifact Work violates admission.');
    cursors.advance({...key,expectedRevision:head.revision,cursor:J({lastWorkId:work.workId,sequence:pointer.sequence+1,finishedWindow:null})});
    return {kind:'admitted',workId:work.workId};
  }
  const ports={
    [AUDIT]:{validateInputs(context){current(context);if(D(context.namedInputs.peopleArtifactReferenceAuditInput)!==D(input(context.workId)))fail('Audit input changed after planning.');},
      execute(context){current(context);const value=audit(context.workId);return {kind:'succeeded',resultSchemaRef:EVIDENCE,result:value,
        evidenceSchemaRef:'helix://contracts/capabilities/people.reference_usage.audit/v1/evidence',evidence:{evidenceId:value.evidenceId,evidenceKind:value.evidenceKind,producerRef:AUDIT,basisDigest:value.basisDigest,payloadDigest:D(value),observedAtMs:now()}};},
      validateResult(context,outcome){assertEvidence(outcome.result,validator);if(outcome.result.basisDigest!==definition(context.workId).executionBasisDigest)fail('Audit Result is outside its frozen Work.');}},
    [RECLAIM]:{validateInputs(context){current(context);const value=input(context.workId);if(!value.previousEvidence||D(context.namedInputs.peopleArtifactReferenceEvidence)!==D(value.previousEvidence))fail('Reclaim Evidence changed.');},
      execute:executeReclaim,validateResult(context,value){const saved=store.replay(context);if(!saved||D(saved.result)!==D(value.result))fail('Reclaim Receipt is not its exact atomic settlement.');},
      observeEffectReality(value){try{const work=definition(value.work.work_id);if(work.workKind!=='reference_artifact_reclaim'||value.event.work_id!==work.workId||value.event.capability_ref!==RECLAIM)fail('Reclaim recovery scope changed.');
        const frozen=input(work.workId);assertEvidence(frozen.previousEvidence,validator);
        const context={workId:work.workId,eventId:value.event.event_id,eventAttemptId:value.effect.event_attempt_id,idempotencyKey:value.effect.idempotency_key},saved=store.replay(context),
          observed=saved?{evidenceDigest:D(saved.result)}:io.observe({context,evidence:frozen.previousEvidence,readRegistry:()=>store.artifact(frozen.artifactHandle.artifactHandleId)});
        return {status:'matching',cleanupDeclared:false,evidenceDigest:observed.evidenceDigest};
      }catch(error){return {status:'conflict',cleanupDeclared:false,evidenceDigest:D({reason:error.code||'PEOPLE_ARTIFACT_AUDIT_INVALID'})};}}}
  };
  return Object.freeze({listPage:store.listPage,reconcile,definition,input,ports,store});
}
module.exports=Object.freeze({createPeopleArtifactReclamation});
