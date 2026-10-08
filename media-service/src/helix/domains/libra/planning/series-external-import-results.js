'use strict';
const {canonicalDigest:d,canonicalJson}=require('../../../contracts/canonical-json');
const {replacementBasis,externalImportSelectionWork,externalAcquireVerificationWork}=require('./external-material-work');
const {buildSeriesReplacementMapping}=require('../model/series-external-replacement');
const {createExternalMaterialProjections,IMPORTED_CANDIDATE,EXTERNAL_SELECTION}=require('./external-material-planner');
const external=require('../model/external-material-contracts');
const media=require('../model/media-production-contracts');
const IMPORT='libra.workspace.material.import@1',PROBE='shared.material.media.probe@1',
  VERIFY='libra.product_media.verify@1',SELECT='libra.product_output.select@1';
const schema=capability=>'helix://contracts/capabilities/'+capability.replace('@1','/v1')+'/result';
const stable=(prefix,value)=>prefix+d(value).slice(0,40);
const same=(a,b)=>canonicalJson(a)===canonicalJson(b);
function requireValue(condition){if(!condition)throw new Error('Series external import Results do not form one exact frozen Scope Work.');}
function literal(row,name){const found=row.inputBindings.bindings.filter(item=>item.portName===name&&item.bindingKind==='literal');
  requireValue(found.length===1);return found[0].value;}

// Result reconstruction never creates a successor Fact or grants disposal of
// the original files. The final full-Run selection and Arca remain mandatory.
function readSeriesExternalImportSet({snapshot,scope,workResultReader:reader}) {
  const work=externalImportSelectionWork(snapshot,scope),status=reader.status(work.workId);
  if(status?.state!=='succeeded')return null;
  const definition=reader.readDefinition(work.workId),attemptId=status.latestAttempt?.attempt_id;
  requireValue(definition&&same(definition.definition,work)&&definition.definitionDigest===d(work)&&
    status.basis_digest===work.executionBasisDigest&&typeof attemptId==='string');
  const planId=stable('libra-external-material-plan-',{workId:work.workId,attempt:attemptId}),
    rows=reader.read(work.workId).filter(row=>row.attemptId===attemptId);
  requireValue(rows.length>0&&rows.every(row=>row.workId===work.workId&&row.planId===planId&&
    row.outcomeKind==='succeeded'&&row.state==='completed'&&[IMPORT,PROBE,VERIFY,SELECT].includes(row.capabilityRef)&&
    /^[a-f0-9]{64}$/.test(row.planDigest||'')&&row.planRevision===1&&typeof row.resultId==='string'&&row.resultId.length>0&&
    row.resultSchemaRef===schema(row.capabilityRef)&&row.resultDigest===d(row.result)&&row.inputBindingDigest===d(row.inputBindings))&&
    new Set(rows.map(row=>row.eventId)).size===rows.length&&new Set(rows.map(row=>row.planDigest)).size===1);
  const imports=rows.filter(row=>row.capabilityRef===IMPORT);
  requireValue(imports.length>0&&rows.length===imports.length*4);
  const first=imports[0],frozenEvidence=literal(first,'stableEvidence'),verified=literal(first,'verifiedExternalPackage'),
    descriptors=imports.map(row=>{
      const contract=literal(row,'workspaceDeliveryContract'),source=frozenEvidence.stableExternalMaterialHandle.outputSnapshot.members
        .find(item=>item.externalMemberId===contract.externalMemberId),basis={attempt:attemptId,contractDigest:contract.digest};
      requireValue(source&&same(literal(row,'stableEvidence'),frozenEvidence)&&same(literal(row,'verifiedExternalPackage'),verified)&&
        verified.result==='passed'&&contract.verifiedPackageDigest===d(verified)&&contract.libraRunId===snapshot.run.libraRunId&&
        contract.stableExternalMaterialHandleId===frozenEvidence.stableExternalMaterialHandle.handleId&&
        contract.digest===d(Object.fromEntries(Object.entries(contract).filter(([key])=>key!=='digest')))&&
        row.eventId===stable('libra-external-import-event-',basis));
      return {contract,source,importEventId:row.eventId,probeEventId:stable('libra-external-import-probe-event-',basis),
        eventExecutionKey:d({schema:'helix.event-execution-key@1',eventId:row.eventId,workAttemptId:attemptId,planId})};
    }).sort((a,b)=>Buffer.from(a.contract.externalMemberId).compare(Buffer.from(b.contract.externalMemberId)));
  const acquiredWork=externalAcquireVerificationWork(snapshot,scope),acquiredStatus=reader.status(acquiredWork.workId);
  requireValue(acquiredStatus?.state==='succeeded'&&acquiredStatus.basis_digest===acquiredWork.executionBasisDigest&&
    typeof acquiredStatus.latestAttempt?.attempt_id==='string');
  const acquired=reader.read(acquiredWork.workId).filter(row=>row.attemptId===acquiredStatus.latestAttempt.attempt_id);
  for(const [capability,value] of [['libra.external_material.stability.observe@1',frozenEvidence],
    ['libra.external_material.package.verify@1',verified]]){
    const matches=acquired.filter(row=>row.capabilityRef===capability);
    requireValue(matches.length===1&&matches[0].workId===acquiredWork.workId&&matches[0].outcomeKind==='succeeded'&&
      matches[0].resultDigest===d(value)&&same(matches[0].result,value));
  }
  requireValue(same(descriptors.map(item=>item.contract.externalMemberId),verified.verifiedMemberIds));
  const projections=new Map(createExternalMaterialProjections().map(item=>[item.projectionRef,item.projection])),
    sourceResults=rows.filter(row=>[IMPORT,PROBE].includes(row.capabilityRef)).map(row=>({eventId:row.eventId,
      resultSchemaRef:row.resultSchemaRef,result:row.result})),requirement=media.buildMediaRequirement(snapshot.spec),members=[];
  const exact=(id,capability)=>{const matches=rows.filter(row=>row.eventId===id&&row.capabilityRef===capability);
    requireValue(matches.length===1);return matches[0];};
  for(const item of descriptors){
    const basis={attempt:attemptId,contractDigest:item.contract.digest},imported=exact(item.importEventId,IMPORT),
      probe=exact(item.probeEventId,PROBE),verification=exact(stable('libra-external-import-verify-event-',basis),VERIFY),
      selection=exact(stable('libra-external-import-select-event-',basis),SELECT),candidateNodeId='external_import_output_'+item.contract.contractId;
    requireValue(same(probe.inputBindings.bindings,[{portName:'physicalMaterialReadHandleOrWorkspaceMaterialHandle',
      bindingKind:'event_result',eventId:imported.eventId,resultSchemaRef:schema(IMPORT)}]));
    const parameters={seriesImportMembers:descriptors,replacementScope:scope,runExecutionBasisDigest:snapshot.run.executionBasisDigest,
      externalMemberId:item.contract.externalMemberId,candidateNodeId,libraRunId:snapshot.run.libraRunId,mediaRequirement:requirement};
    const binding=verification.inputBindings.bindings;
    requireValue(binding.length===1&&binding[0].portName==='productMediaCandidateInput'&&binding[0].bindingKind==='projected_event_results'&&binding[0].projectionRef===IMPORTED_CANDIDATE&&
      same(binding[0].parameters,parameters)&&same(binding[0].eventResults,descriptors.flatMap(member=>[
        {eventId:member.importEventId,resultSchemaRef:schema(IMPORT)},{eventId:member.probeEventId,resultSchemaRef:schema(PROBE)}])));
    const input=projections.get(IMPORTED_CANDIDATE).project({sourceResults,parameters}),
      expected=media.buildProductMediaVerification({input,verifiedAtMs:verification.result.verifiedAtMs,playbackVerification:verification.result.decodeSummary});
    requireValue(same(expected,verification.result));
    const ranked=media.buildPlannedProductCandidateReference({rank:1,candidateKind:'workspace_output',candidateNodeId,
      mediaRequirementDigest:requirement.requirementDigest,outputTargetId:item.contract.contractId,outputTargetDigest:item.contract.digest,
      productionIntentDigest:item.contract.digest}),selectionParameters={candidateNodeId,libraRunId:snapshot.run.libraRunId,
      acceptanceSpecId:snapshot.spec.acceptanceSpecId,acceptanceSpecRecordDigest:snapshot.spec.recordDigest,
      mediaRequirementDigest:requirement.requirementDigest,rankedCandidates:[ranked]},selectionBinding=selection.inputBindings.bindings;
    requireValue(selectionBinding.length===1&&selectionBinding[0].portName==='productOutputSelectionInput'&&selectionBinding[0].bindingKind==='projected_event_result'&&
      selectionBinding[0].resultSchemaRef===schema(VERIFY)&&
      selectionBinding[0].eventId===verification.eventId&&selectionBinding[0].projectionRef===EXTERNAL_SELECTION&&
      same(selectionBinding[0].parameters,selectionParameters));
    const selectionInput=projections.get(EXTERNAL_SELECTION).project({sourceResult:expected,parameters:selectionParameters});
    requireValue(same(media.selectProductOutput({input:selectionInput,producedAtMs:selection.result.producedAtMs}),selection.result));
    const workspaceMediaHandle=external.buildImportedWorkspaceMediaHandle({workspaceDeliveryContract:item.contract,
      workspaceMaterialHandle:imported.result,producingEventId:item.importEventId,idempotencyKey:item.eventExecutionKey});
    members.push(Object.freeze({externalMember:item.source,workspaceMediaHandle,importRecord:imported,probeRecord:probe,
      verificationRecord:verification,selectionRecord:selection,eligible:selection.result.result==='selected'}));
  }
  const mapping=buildSeriesReplacementMapping({basis:replacementBasis(snapshot),scope,finalMembers:members.map(item=>({
    materialKey:item.importRecord.result.materialKey,memberDigest:d({externalMember:item.externalMember,
      workspaceMediaHandle:item.workspaceMediaHandle}),episodeKeys:item.externalMember.episodeClaims.map(claim=>claim.episodeKey)}))});
  return Object.freeze({work,scope,members:Object.freeze(members),mapping,eligible:members.every(item=>item.eligible)});
}
module.exports=Object.freeze({readSeriesExternalImportSet});
