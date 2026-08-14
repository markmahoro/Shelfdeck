'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { createMaterialControlProjectionPort } = require('../../../foundation/persistence/material-control');
const { buildProductionMaterialManifest,buildRunAdmissionDecision,buildRunExecutionBasis } = require('../model/run-admission-contracts');
const { createRunAdmissionStore } = require('../persistence/run-admission-store');

const utf8=(a,b)=>Buffer.from(a).compare(Buffer.from(b));
const stable=(prefix,value)=>prefix+canonicalDigest(value).slice(0,40);
function createLibraRunCreator(options){
  if(!options?.contextReader)throw new TypeError('Libra Run Creator requires an Owner context reader.');
  const store=createRunAdmissionStore(options),controlPort=createMaterialControlProjectionPort(options);
  function manifest(context,libraRunId){
    const controlled=context.bindings.filter((row)=>row.authority_kind==='primary_control');
    if(controlled.length<1||controlled.length>1024)throw new Error('Libra Run requires 1..1024 current Primary Material Bindings.');
    const keys=controlled.map((row)=>row.material_key),controls=[];
    for(let index=0;index<keys.length;index+=500)controls.push(...controlPort.getMaterialControlProjections(keys.slice(index,index+500)));
    const byKey=new Map(controls.map((item)=>[item.materialKey,item]));
    const members=controlled.map((row)=>{const control=byKey.get(row.material_key);
      if(!control||control.resultKind!=='available'||control.controlState!=='controlled'||control.ownerDomain!=='libra'||
        control.ownerScopeType!=='subject'||control.ownerScopeId!==context.subject.subject_id)throw new Error('Libra Run input Control is unavailable.');
      const episodeClaims=context.claims.filter((claim)=>claim.material_key===row.material_key&&Number(claim.binding_revision)===Number(row.binding_revision))
        .sort((a,b)=>utf8(a.episode_key,b.episode_key)).map((claim)=>Object.freeze({episodeKey:claim.episode_key,seasonClaimDigest:claim.season_claim_digest}));
      return Object.freeze({materialKey:row.material_key,role:row.role,physicalIdentity:Object.freeze({mountScopeId:row.mount_scope_id,
        inode:String(row.inode),sizeBytes:Number(row.size_bytes),fingerprintAlgorithm:row.fingerprint_algorithm,
        fingerprintVersion:Number(row.fingerprint_version),contentFingerprint:row.content_fingerprint}),sizeBytes:Number(row.size_bytes),
        location:Object.freeze({locationKind:'domain_binding',endpointId:row.endpoint_id,location:row.location}),bindingKind:'libra_material_binding',
        bindingRevision:Number(row.binding_revision),bindingEvidenceDigest:row.evidence_digest,originCandidateDeliveryRef:Object.freeze({
          intakeDecisionId:row.origin_intake_decision_id,offerId:row.origin_offer_id,candidatePackageId:row.origin_candidate_package_id,
          packageRevision:Number(row.origin_package_revision),packageDigest:row.origin_package_digest,
          candidateDeliverySnapshotDigest:row.origin_candidate_delivery_snapshot_digest,relatedReferenceSetDigest:row.origin_related_reference_set_digest}),
        admittedControlRevision:control.controlRevision,admittedControlProjectionDigest:control.projectionDigest,episodeClaims:Object.freeze(episodeClaims)});
    });
    return buildProductionMaterialManifest({manifestRole:'run_input',manifestRevision:1,libraRunId,
      scopeKind:context.subject.structure_kind==='season'?'episode_delivery':'single',members},context.spec);
  }
  function relatedDispositionScope(context){
    const related=context.bindings.filter((row)=>row.authority_kind==='related_derived').map((row)=>{
      const referenceId=canonicalDigest({schema:'procurement.related-material-reference-id@1',primaryMaterialKey:row.primary_material_key,
        role:row.role,relatedMaterialKey:row.material_key,endpointId:row.endpoint_id,location:row.location});
      return Object.freeze({referenceId,primaryMaterialKey:row.primary_material_key,role:row.role,materialKey:row.material_key,
        associationEvidenceDigest:row.association_evidence_digest,
        dispositionBasisDigest:row.disposition_basis_digest});
    }).sort((a,b)=>utf8(a.referenceId,b.referenceId));
    const origins=new Set(context.bindings.map((row)=>row.origin_related_reference_set_digest).filter(Boolean));
    const scopes=new Set(context.bindings.map((row)=>row.origin_related_disposition_scope_digest).filter(Boolean));
    if(origins.size!==1||scopes.size!==1)throw new Error('Libra Binding origin does not expose one immutable Related scope.');
    const relatedReferenceSetDigest=[...origins][0],relatedDispositionScopeDigest=[...scopes][0];
    const computed=canonicalDigest({schema:'procurement.related-disposition-scope@1',items:related.map((item)=>({
      referenceId:item.referenceId,primaryMaterialKey:item.primaryMaterialKey,role:item.role,materialKey:item.materialKey,
      dispositionBasisDigest:item.dispositionBasisDigest}))});
    if(computed!==relatedDispositionScopeDigest)throw new Error('Libra Related Binding scope differs from its Handoff A origin.');
    return Object.freeze({relatedReferenceSetDigest,relatedDispositionScopeDigest,items:Object.freeze(related)});
  }
  function reconcileInternal(subjectId,forceReplacementOf=null){const context=options.contextReader.read(subjectId);if(context.kind!=='ready')return context;
    const eligible=context.runs.filter((run)=>['active','suspended','frozen'].includes(run.state));
    if(eligible.length>1)throw new Error('Subject has more than one commit-eligible Libra Run.');
    const current=eligible[0]||null;
    const completed=context.runs.filter((run)=>run.state==='completed');
    if(current&&context.acceptedDeliveryRunIds?.includes(current.libra_run_id)){
      return Object.freeze({kind:'delivered',subjectId,libraRunId:current.libra_run_id,
        acceptanceSpecId:current.acceptance_spec_id,executionBasisDigest:current.execution_basis_digest});
    }
    if(!current&&context.subject.structure_kind==='single'&&completed.length>0){
      const delivered=completed.sort((left,right)=>Number(right.state_revision)-Number(left.state_revision))[0];
      return Object.freeze({kind:'completed',subjectId,libraRunId:delivered.libra_run_id,
        acceptanceSpecId:delivered.acceptance_spec_id,executionBasisDigest:delivered.execution_basis_digest});
    }
    if(forceReplacementOf&&current?.libra_run_id!==forceReplacementOf)
      throw new Error('Forced replacement no longer targets the current commit-eligible Libra Run.');
    if(current?.state==='frozen')return Object.freeze({kind:'frozen',subjectId,libraRunId:current.libra_run_id});
    if(!forceReplacementOf&&current&&current.acceptance_spec_id===context.spec.acceptanceSpecId)return Object.freeze({kind:'current',subjectId,
      libraRunId:current.libra_run_id,state:current.state,executionBasisDigest:current.execution_basis_digest});
    if(!forceReplacementOf&&current&&typeof options.contextReader.readAcceptanceSpec==='function'){const currentSpec=options.contextReader.readAcceptanceSpec(current.acceptance_spec_id);
      if(currentSpec?.specDigest===context.spec.specDigest)return Object.freeze({kind:'current',subjectId,
        libraRunId:current.libra_run_id,state:current.state,executionBasisDigest:current.execution_basis_digest,
        semanticSpecReplay:true,currentAcceptanceSpecId:context.spec.acceptanceSpecId});}
    const head=options.contextReader.headSnapshot(subjectId,context.runHead),admissionRevision=head.headRevision+1,
      libraRunId=canonicalDigest({schema:'libra.run-id@1',subjectId,admissionRevision}),productionMaterialManifest=manifest(context,libraRunId);
    const basis=buildRunExecutionBasis({subjectSnapshot:{subjectId,intakeRevision:Number(context.subject.intake_revision),
      structureKind:context.subject.structure_kind,contentProfile:context.subject.content_profile,
      continuitySetDigest:context.subject.current_continuity_set_digest,episodeScopeDigest:context.subject.current_episode_scope_digest},
      decisionHeadSnapshot:options.contextReader.decisionHeadSnapshot(subjectId,context.decisionHead),acceptanceSpec:context.spec,
      shelfProjection:context.shelfProjection,productionMaterialManifest,relatedDispositionScope:relatedDispositionScope(context)});
    const replacement=current?{libraRunId:current.libra_run_id,stateRevision:Number(current.state_revision),stateDigest:current.state_digest,
      runScopeDigest:current.run_scope_digest,acceptanceSpecId:current.acceptance_spec_id,executionBasisDigest:current.execution_basis_digest}:null;
    const priority=current?{priorityClass:current.priority_class,priorityIntentDigest:current.priority_intent_digest}:{priorityClass:'normal',
      priorityIntentDigest:canonicalDigest({schema:'libra.priority-intent-empty@1'})};
    const decision=buildRunAdmissionDecision({admissionKind:current?'replacement':'initial',subjectId,expectedRunAdmissionHead:head,
      runExecutionBasis:basis,...(replacement?{replacementOfRunRef:replacement}:{}),initialPriority:priority});
    const identity={subjectId,decisionDigest:decision.decisionDigest},admitted=store.admit({decision,
      commitMarker:stable('libra-run-admission-marker-',identity),resultId:stable('libra-run-admission-result-',identity)});
    if(replacement&&typeof options.cancelProcessWorks==='function')options.cancelProcessWorks(Object.freeze({ownerDomain:'libra',
      processType:'libra_run',processId:replacement.libraRunId,reasonCode:'LIBRA_RUN_SUPERSEDED'}));
    return Object.freeze({kind:'admitted',subjectId,libraRunId:admitted.result.libraRunId,replayed:admitted.replayed,result:admitted.result});
  }
  return Object.freeze({
    reconcile(subjectId){return reconcileInternal(subjectId);},
    replace(subjectId,libraRunId){return reconcileInternal(subjectId,libraRunId);},
  });
}

module.exports=Object.freeze({createLibraRunCreator});
