'use strict';
const {canonicalDigest}=require('../../../contracts/canonical-json');
const {effectiveRequirements}=require('./care-objective');
const {primaryReadHandle,CAPABILITY_REFS:C}=require('./aftercare-contract');
const {evaluateSeriesCareMediaSpace,seriesMemberAssessmentEventId}=require('./series-care-media-space');

function readSeriesMemberAssessmentSet(context,execution,allRows) {
  const space=evaluateSeriesCareMediaSpace(context,effectiveRequirements(context)?.space?.maxSizeBytes??null),
    rows=allRows.filter(row=>row.capabilityRef===C.conformance&&row.result?.memberScope),
    currentRows=rows.filter(row=>row.attemptId===execution.workAttemptId&&row.planId===execution.planId),refs=[],findings=[],members=[];
  if(currentRows.length!==space.members.length)throw new Error('Series member Assessment set is incomplete or ambiguous.');
  for(const member of space.members) {
    const material=context.raw.materials.find(item=>item.material_key===member.materialKey),
      expectedScope={materialKey:member.materialKey,spaceBasisDigest:space.basisDigest,
        sourceHandleDigest:canonicalDigest(primaryReadHandle(context,material)),
        maxOutputBytes:space.memberBudgets.find(item=>item.materialKey===member.materialKey).maxOutputBytes},
      selected=currentRows.filter(row=>row.result.memberScope.materialKey===member.materialKey),
      row=selected[0],result=row?.result;
    if(selected.length!==1||row.workId!==execution.workId||row.outcomeKind!=='succeeded'||
        row.eventId!==seriesMemberAssessmentEventId(execution.workAttemptId,member.materialKey)||
        typeof row.resultId!=='string'||!row.resultId||!/^[a-f0-9]{64}$/.test(row.inputBindingDigest||'')||
        row.resultDigest!==canonicalDigest(result)||result.careBasisDigest!==context.basis.digest||
        result.inventoryRevision!==context.basis.inventoryRevision||result.shelfEntryId!==context.shelfEntryId||
        !['healthy','degraded'].includes(result.assessmentState)||
        canonicalDigest(result.memberScope)!==canonicalDigest(expectedScope)||
        result.payloadDigest!==canonicalDigest(Object.fromEntries(Object.entries(result).filter(([key])=>key!=='payloadDigest'))))
      throw new Error('Series member Assessment does not match the current scope and exact Event Result.');
    members.push(row);
    findings.push(...result.findingDrafts);
    refs.push({materialKey:member.materialKey,eventId:row.eventId,resultId:row.resultId,resultDigest:row.resultDigest,inputBindingDigest:row.inputBindingDigest});
  }
  return Object.freeze({members:Object.freeze(members),findings:Object.freeze(findings),
    memberAssessmentSet:Object.freeze({memberCount:refs.length,digest:canonicalDigest({schema:'arca.series-member-assessment-set@1',
      workId:execution.workId,workAttemptId:execution.workAttemptId,planId:execution.planId,spaceBasisDigest:space.basisDigest,members:refs})})});
}

function invalidTarget() {
  throw Object.assign(new Error('Series media repair lacks exact Case, Finding and member Strategy evidence.'),
    {code:'ARCA_AFTERCARE_SERIES_MEDIA_TARGET_STALE'});
}
function seriesMediaRepairTargets(context,care,history,reader) {
  if(context.raw.entry.structure_kind!=='season'||care?.state!=='active'||care.careBasisDigest!==context.basis.digest||
      care.careRequirement?.careBasisDigest!==context.basis.digest)invalidTarget();
  const {digest,...requirement}=care.careRequirement;
  if(digest!==care.careRequirementDigest||digest!==canonicalDigest(requirement))invalidTarget();
  const inputs=care.basisInputs?.filter(item=>item.inputKind==='health_assessment_work')||[],input=inputs[0];
  if(inputs.length!==1||input.ownerDomain!=='arca'||input.aggregateType!=='supporting_work'||
      input.revision!==1||input.inputDigest!==context.basis.digest)invalidTarget();
  const rows=reader.read(input.aggregateId),aggregates=rows.filter(row=>row.workId===input.aggregateId&&
    row.capabilityRef===C.conformance&&row.outcomeKind==='succeeded'&&row.result?.memberAssessmentSet&&!row.result.memberScope&&
    history.assessments.some(item=>item.assessmentId===row.result.evidenceId&&item.assessmentKind==='conformance'&&
      item.careBasisDigest===context.basis.digest&&item.evidenceDigest===row.result.payloadDigest));
  if(aggregates.length!==1)invalidTarget();
  const row=aggregates[0],aggregate=row.result;
  if(row.resultDigest!==canonicalDigest(aggregate)||aggregate.careBasisDigest!==context.basis.digest||
      aggregate.shelfEntryId!==context.shelfEntryId||aggregate.payloadDigest!==canonicalDigest(
        Object.fromEntries(Object.entries(aggregate).filter(([key])=>key!=='payloadDigest'))))invalidTarget();
  const set=readSeriesMemberAssessmentSet(context,{workId:input.aggregateId,workAttemptId:row.attemptId,planId:row.planId},rows);
  if(canonicalDigest(set.memberAssessmentSet)!==canonicalDigest(aggregate.memberAssessmentSet))invalidTarget();
  const effects=requirement.requiredEffects,targets=new Map(),mediaKinds=new Set(['video_codec_unmet','max_size_exceeded','file_extension_unmet','container_unmet']);
  if(!Array.isArray(effects)||new Set(effects.map(item=>item.objectId)).size!==effects.length||
      requirement.acceptanceDigest!==canonicalDigest(effects))invalidTarget();
  for(const effect of effects) {
    const matches=history.findings.filter(item=>item.findingId===effect.objectId&&item.findingDigest===effect.digest);
    if(matches.length!==1)invalidTarget();
    const finding=matches[0],[kind,code]=finding.findingKind.split(':');
    if(kind!=='conformance'||!mediaKinds.has(code))continue;
    if(finding.assessmentId!==aggregate.evidenceId||!aggregate.findingDrafts.some(item=>
        item.objectId===effect.objectId&&item.snapshotDigest===effect.digest&&
        item.schemaRef.split('/')[4]===kind&&item.schemaRef.split('/')[5]===code))invalidTarget();
    const members=set.members.filter(item=>item.result.findingDrafts.some(draft=>draft.schemaRef.split('/')[5]===code));
    if(!members.length)invalidTarget();
    for(const member of members) {
      const materialKey=member.result.memberScope.materialKey,previous=targets.get(materialKey),
        repairKind=previous?.repairKind==='transcode'||['video_codec_unmet','max_size_exceeded'].includes(code)?'transcode':'remux';
      targets.set(materialKey,{materialKey,repairKind,memberScope:member.result.memberScope,strategy:member.result.mediaRepairStrategy,
        memberEvidenceDigest:member.result.payloadDigest,assessmentSetDigest:set.memberAssessmentSet.digest});
    }
  }
  if(!targets.size)invalidTarget();
  for(const target of targets.values())if(target.repairKind==='transcode') {
    const strategy=target.strategy;
    if(!strategy||strategy.careBasisDigest!==context.basis.digest||strategy.sourceHandleDigest!==target.memberScope.sourceHandleDigest||
        strategy.digest!==strategy.strategyDigest||strategy.strategyDigest!==canonicalDigest(
          Object.fromEntries(Object.entries(strategy).filter(([key])=>!['strategyDigest','digest'].includes(key)))))invalidTarget();
  }
  return Object.freeze([...targets.values()].sort((a,b)=>Buffer.from(a.materialKey).compare(Buffer.from(b.materialKey))).map(Object.freeze));
}

function seriesMediaOutputTarget(context,care,history,reader,output) {
  const invalid=()=>{throw Object.assign(new Error('Series media output does not match its frozen repair target.'),
    {code:'ARCA_AFTERCARE_SERIES_MEDIA_OUTPUT_STALE'});};
  const targets=seriesMediaRepairTargets(context,care,history,reader),matches=targets.filter(target=>
    target.memberScope.sourceHandleDigest===output?.sourceMaterialHandleDigest);
  if(matches.length!==1)invalid();
  const target=matches[0],workspace=output.workspaceMaterialHandle,
    unsigned=Object.fromEntries(Object.entries(output).filter(([key])=>key!=='resultDigest')),
    expectedIntent=target.repairKind==='transcode'?target.strategy.strategyDigest:
      canonicalDigest({kind:'remux',requirement:care.careRequirementDigest,memberKey:target.materialKey});
  if(output.resultDigest!==canonicalDigest(unsigned)||!workspace||workspace.workspaceId!==care.aftercareCaseId||
      workspace.ownerDomain!=='arca'||workspace.processId!==context.shelfEntryId||
      output.workspaceMaterialHandleDigest!==canonicalDigest(workspace)||
      output.productionIntentKind!==(target.repairKind==='transcode'?'encode':'remux')||
      output.productionIntentDigest!==expectedIntent)invalid();
  const material=context.raw.materials.find(item=>item.material_key===target.materialKey);
  return Object.freeze({target,material});
}

module.exports=Object.freeze({readSeriesMemberAssessmentSet,seriesMediaRepairTargets,seriesMediaOutputTarget});
