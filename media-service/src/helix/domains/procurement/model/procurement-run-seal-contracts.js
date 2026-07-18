'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const SHA256=/^[0-9a-f]{64}$/;
class ProcurementRunSealContractError extends Error { constructor(code,message,details={}){super(message);this.name='ProcurementRunSealContractError';this.code=code;this.details=details;} }
function fail(code,message,details){throw new ProcurementRunSealContractError(code,message,details);}
function exact(value,keys,code){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||keys.some((key)=>!Object.hasOwn(value,key)))fail(code,'Value does not match the closed Run Seal contract.');}
function orderedUnique(items,key){return Array.isArray(items)&&new Set(items.map((item)=>item[key])).size===items.length&&items.every((item,index)=>index===0||Buffer.compare(Buffer.from(items[index-1][key]),Buffer.from(item[key]))<0);}
function validateProcurementRunSealDecision(value){
  exact(value,['decisionId','procurementRunId','expectedStateRevision','expectedRunBasisDigest','sealOutcome','publishedCandidates','releasedMembers','decisionDigest'],'P7_RUN_SEAL_DECISION_SHAPE');
  if(typeof value.decisionId!=='string'||!value.decisionId||typeof value.procurementRunId!=='string'||!value.procurementRunId||
    !Number.isSafeInteger(value.expectedStateRevision)||value.expectedStateRevision<1||!SHA256.test(value.expectedRunBasisDigest||'')||
    !['completed','failed','partial_failure'].includes(value.sealOutcome)||!orderedUnique(value.publishedCandidates,'candidatePackageId')||
    !orderedUnique(value.releasedMembers,'materialKey'))fail('P7_RUN_SEAL_DECISION_INVALID','Run Seal scalar values or ordering are invalid.');
  for(const item of value.publishedCandidates)exact(item,['candidatePackageId','packageDigest','manifestDigest'],'P7_RUN_SEAL_CANDIDATE_SHAPE');
  for(const item of value.releasedMembers){exact(item,['materialKey','disposition','evidenceDigest'],'P7_RUN_SEAL_RELEASE_SHAPE');if(!SHA256.test(item.materialKey||'')||
    !SHA256.test(item.evidenceDigest||'')||!['completed_without_candidate','triage_failed'].includes(item.disposition))fail('P7_RUN_SEAL_RELEASE_INVALID','Released member is invalid.');}
  if(value.publishedCandidates.some((item)=>!SHA256.test(item.packageDigest||'')||!SHA256.test(item.manifestDigest||''))||
    value.sealOutcome==='completed'&&value.releasedMembers.some((item)=>item.disposition==='triage_failed')||
    value.sealOutcome==='failed'&&(value.publishedCandidates.length!==0||value.releasedMembers.length===0||value.releasedMembers.some((item)=>item.disposition!=='triage_failed'))||
    value.sealOutcome==='partial_failure'&&(value.publishedCandidates.length===0||!value.releasedMembers.some((item)=>item.disposition==='triage_failed'))||
    canonicalDigest(Object.fromEntries(Object.entries(value).filter(([key])=>key!=='decisionDigest')))!==value.decisionDigest){
    fail('P7_RUN_SEAL_DECISION_INVALID','Run Seal outcome or decision digest is invalid.');
  }
  return Object.freeze(value);
}
function sealDigests(decision,sealedStateRevision,candidateItems,releasedItems){
  const candidateReservationSetDigest=canonicalDigest({schema:'procurement.candidate-reservation-set@1',items:candidateItems});
  const releasedMaterialSetDigest=canonicalDigest({schema:'procurement.run-released-material-set@1',items:releasedItems});
  const summary={procurementRunId:decision.procurementRunId,sealedStateRevision,runBasisDigest:decision.expectedRunBasisDigest,
    sealDecisionDigest:decision.decisionDigest,sealOutcome:decision.sealOutcome,candidateReservationCount:candidateItems.length,
    candidateReservationSetDigest,releasedMaterialCount:releasedItems.length,releasedMaterialSetDigest};
  return Object.freeze({...summary,sealEvidenceDigest:canonicalDigest({schema:'procurement.run-seal-evidence@1',...summary})});
}
module.exports=Object.freeze({ProcurementRunSealContractError,sealDigests,validateProcurementRunSealDecision});
