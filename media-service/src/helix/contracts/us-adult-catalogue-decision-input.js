'use strict';

// Public, immutable input projected by Libra. This validates its envelope and
// exact technical references; only Libra can qualify the selected identity.
const {canonicalDigest,canonicalJson}=require('./canonical-json');
const {assertObservationHandle,CAPABILITY,resultRef}=require('./us-adult-catalogue-work-types');
const {compare,queryNames}=require('./us-adult-name-query');
const HASH=/^[a-f0-9]{64}$/;
const INPUT_KEYS=['schema','libraRunId','subjectId','runExecutionBasisDigest','resolvedIdentityDigest','catalogueBasisDigest',
  'observationResultRef','observationHandle','assessmentPolicyDigest','assessmentDigest','representativeImagePolicyDigest','winner','expectedChoiceHead'];
const RESULT_KEYS=['workId','attemptId','planId','eventId','resultId','capabilityRef','resultSchemaRef','resultDigest','inputBindingDigest'];
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
const text=(value,max=256)=>typeof value==='string'&&value.length>0&&value.length<=max;
const hash=value=>typeof value==='string'&&HASH.test(value);
const sortedUnique=(values,order)=>Array.isArray(values)&&values.every((value,index)=>!index||order(values[index-1],value)<0);
function fail(message){throw Object.assign(new TypeError(message),{code:'US_ADULT_CATALOGUE_DECISION_INPUT_INVALID'});}
function assertWinner(winner){
  if(!exact(winner,['identityKey','uid','name','aliases','groupIds','coverageStrata','supportingRepresentativeStrata'])||
    !text(winner.identityKey)||!text(winner.uid)||!text(winner.name,200)||!winner.name.trim()||!Array.isArray(winner.aliases)||
    winner.aliases.length>16||winner.aliases.some(alias=>!text(alias,200)||!alias.trim())||!sortedUnique(winner.aliases,compare)||
    !Array.isArray(winner.groupIds)||winner.groupIds.length<1||winner.groupIds.length>1280||winner.groupIds.some(group=>!text(group))||
    !sortedUnique(winner.groupIds,compare)||!Array.isArray(winner.coverageStrata)||winner.coverageStrata.length<3||winner.coverageStrata.length>20||
    !Array.isArray(winner.supportingRepresentativeStrata)||winner.supportingRepresentativeStrata.length<2||winner.supportingRepresentativeStrata.length>20||
    [winner.coverageStrata,winner.supportingRepresentativeStrata].some(items=>items.some(item=>!Number.isSafeInteger(item)||item<0||item>19)||
      !sortedUnique(items,(a,b)=>a-b))||winner.supportingRepresentativeStrata.some(item=>!winner.coverageStrata.includes(item)))
    fail('The selected directory identity and its independent temporal evidence are not complete.');
  queryNames(winner.name,winner.aliases);return winner;
}
function assertCatalogueDecisionInput(input,inputDigest){
  if(!exact(input,INPUT_KEYS)||input.schema!=='libra.us-adult-catalogue-decision-input@1'||!text(input.libraRunId)||!text(input.subjectId)||
    input.expectedChoiceHead!==null||!['runExecutionBasisDigest','resolvedIdentityDigest','catalogueBasisDigest','assessmentPolicyDigest','assessmentDigest','representativeImagePolicyDigest']
      .every(key=>hash(input[key]))||!hash(inputDigest)||canonicalDigest(input)!==inputDigest||Buffer.byteLength(canonicalJson(input))>256*1024||
    !exact(input.observationResultRef,RESULT_KEYS)||!['workId','attemptId','planId','eventId','resultId'].every(key=>text(input.observationResultRef[key]))||
    !['resultDigest','inputBindingDigest'].every(key=>hash(input.observationResultRef[key]))||input.observationResultRef.capabilityRef!==CAPABILITY||
    input.observationResultRef.resultSchemaRef!==resultRef(CAPABILITY))fail('The pre-People input or exact Observation Result binding changed.');
  const handle=assertObservationHandle(input.observationHandle);
  if(handle.libraRunId!==input.libraRunId||handle.runExecutionBasisDigest!==input.runExecutionBasisDigest||
    handle.basisDigest!==input.catalogueBasisDigest||handle.resultKind!=='observed'||canonicalDigest(handle)!==input.observationResultRef.resultDigest)
    fail('The Observation Handle differs from its exact Run, Basis or durable Result.');
  assertWinner(input.winner);return input;
}
module.exports=Object.freeze({assertCatalogueDecisionInput,assertWinner});
