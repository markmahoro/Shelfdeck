'use strict';
const {canonicalDigest}=require('../../../contracts/canonical-json');
const {evaluateSeriesEpisodeSpace}=require('../../../contracts/episode-byte-allocation');
const {CAPABILITY_REFS:C}=require('./aftercare-contract');
const {effectiveRequirements}=require('./care-objective');
const {evaluateSeriesCareMediaSpace}=require('./series-care-media-space');
const {seriesMediaRepairTargets,seriesMediaOutputTarget}=require('./series-care-assessment-set');

function resolveVerifiedMediaOutput(rows,sourceWorkId,sourceEventId) {
    const fail=()=>{throw new Error('Aftercare verified media output is absent or ambiguous.');};
    const valid=row=>row.workId===sourceWorkId&&row.outcomeKind==='succeeded'&&
      typeof row.attemptId==='string'&&row.attemptId.length>0&&typeof row.planId==='string'&&row.planId.length>0&&
      row.resultDigest===canonicalDigest(row.result);
    const verifications=rows.filter(row=>row.eventId===sourceEventId&&row.capabilityRef===C.mediaVerify);
    if(verifications.length!==1)fail();
    const verification=verifications[0],result=verification.result;
    if(!valid(verification)||result?.verificationKind!=='aftercare_media'||result.result!=='passed'||
      !result.workspaceMediaHandleId)fail();
    const bindings=verification.inputBindings?.bindings?.filter(binding=>binding.portName==='workspaceMediaHandle')||[];
    if(bindings.length!==1||bindings[0].bindingKind!=='projected_event_result')fail();
    const producers=rows.filter(row=>[C.remux,C.transcode].includes(row.capabilityRef)&&
      row.result?.workspaceMediaHandleId===result.workspaceMediaHandleId);
    if(producers.length!==1)fail();
    const producer=producers[0];
    if(!valid(producer)||producer.attemptId!==verification.attemptId||producer.planId!==verification.planId||
      producer.eventId!==bindings[0].eventId||producer.result.producingEventId!==producer.eventId||
      producer.resultSchemaRef!==bindings[0].resultSchemaRef)fail();
    return producer.result;
}

function evaluatePreparedSeriesSpace(space,outputs) {
  const bySource=new Map(outputs.map(item=>[item.target.materialKey,item.output.workspaceMaterialHandle]));
  if(bySource.size!==outputs.length)throw new Error('Series prepared set repeats a source member.');
  const members=space.members.map(member=>{
    const replacement=bySource.get(member.materialKey);
    if(!replacement)return member;
    if(replacement.sizeBytes!==replacement.physicalIdentity.sizeBytes||replacement.materialKey!==canonicalDigest({
      schema:'physical-material-identity@2',...replacement.physicalIdentity}))
      throw new Error('Series prepared output physical identity is corrupt.');
    return {...member,materialKey:replacement.materialKey,sizeBytes:replacement.sizeBytes};
  });
  if([...bySource.keys()].some(key=>!space.members.some(member=>member.materialKey===key)))
    throw new Error('Series prepared set contains a foreign source member.');
  const allocations=evaluateSeriesEpisodeSpace({members,episodeKeys:space.episodeKeys,maxSizeBytes:space.maxSizeBytes});
  if(allocations.some(item=>!item.withinLimit))throw Object.assign(new Error('Series prepared set exceeds an Episode byte limit.'),
    {code:'ARCA_AFTERCARE_SERIES_FINAL_SPACE_UNMET'});
  return allocations;
}

function readSeriesPreparedMediaSet(context,care,history,reader,workId) {
  const fail=()=>{throw new Error('Series prepared media set is incomplete, ambiguous or stale.');};
  if(typeof workId!=='string'||!workId)fail();
  const targets=seriesMediaRepairTargets(context,care,history,reader),rows=reader.read(workId),
    verifications=rows.filter(row=>row.capabilityRef===C.mediaVerify),
    producers=rows.filter(row=>[C.remux,C.transcode].includes(row.capabilityRef));
  if(verifications.length!==targets.length||producers.length!==targets.length)fail();
  const outputs=verifications.map(row=>{
    const output=resolveVerifiedMediaOutput(rows,workId,row.eventId),verification=row.result,
      {target}=seriesMediaOutputTarget(context,care,history,reader,output);
    if(verification.basisDigest!==context.basis.digest||verification.aftercareCaseId!==care.aftercareCaseId||
        verification.careRequirementDigest!==care.careRequirementDigest||row.attemptId!==verifications[0].attemptId||
        row.planId!==verifications[0].planId)fail();
    return Object.freeze({target,output,verification,verificationEventId:row.eventId,verificationResultDigest:row.resultDigest});
  }).sort((a,b)=>Buffer.from(a.target.materialKey).compare(Buffer.from(b.target.materialKey)));
  if(new Set(outputs.map(item=>item.target.materialKey)).size!==targets.length)fail();
  const space=evaluateSeriesCareMediaSpace(context,effectiveRequirements(context)?.space?.maxSizeBytes??null),
    episodeAllocations=evaluatePreparedSeriesSpace(space,outputs),setDigest=canonicalDigest({
      schema:'arca.series-care-prepared-set@1',caseId:care.aftercareCaseId,workId,attemptId:verifications[0].attemptId,
      planId:verifications[0].planId,spaceBasisDigest:space.basisDigest,episodeAllocations,
      outputs:outputs.map(item=>({materialKey:item.target.materialKey,outputDigest:canonicalDigest(item.output),
        verificationEventId:item.verificationEventId,verificationResultDigest:item.verificationResultDigest}))});
  return Object.freeze({outputs:Object.freeze(outputs),episodeAllocations,setDigest});
}

module.exports=Object.freeze({resolveVerifiedMediaOutput,evaluatePreparedSeriesSpace,readSeriesPreparedMediaSet});
