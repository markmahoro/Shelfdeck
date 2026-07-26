'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');
const { utf8Compare } = require('./libra-intake-contracts');
const { LibraDecisionContractError, REQUIREMENT_KEYS, buildDecisionInputSet } = require('./decision-front-half-contracts');

function fail(code,message,details){throw new LibraDecisionContractError(code,message,details);}
function without(value,...fields){return Object.fromEntries(Object.entries(value).filter(([key])=>!fields.includes(key)));}
function exactKeys(value,keys){return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every((key)=>Object.hasOwn(value,key));}
function sortedUnique(values,field){if(!Array.isArray(values))fail('P8_SPEC_REQUIREMENT_ARRAY','Requirement list is invalid.',{field});const normalized=[...values].sort(utf8Compare);if(new Set(normalized).size!==normalized.length||normalized.some((item)=>typeof item!=='string'||!item)||canonicalJson(normalized)!==canonicalJson(values))fail('P8_SPEC_REQUIREMENT_ARRAY','Requirement list must be unique UTF-8 ordered typed text.',{field});return normalized;}

function buildProductScope(subjectSnapshot,episodeKeys=[]){
  if(!subjectSnapshot||!['single','season'].includes(subjectSnapshot.structureKind)||!['movie','series','jav','western_adult'].includes(subjectSnapshot.contentProfile)||
      (subjectSnapshot.contentProfile==='series')!==(subjectSnapshot.structureKind==='season')||!Number.isSafeInteger(subjectSnapshot.intakeRevision)||subjectSnapshot.intakeRevision<1)fail('P8_PRODUCT_SCOPE_SUBJECT','Product Scope requires a frozen Subject snapshot.');
  const normalized=sortedUnique(episodeKeys,'episodeKeys');let scopeKind;
  if(subjectSnapshot.structureKind==='single'){if(normalized.length)fail('P8_PRODUCT_SCOPE_SINGLE','Single Product Scope cannot contain Episodes.');scopeKind='single';}
  else{if(normalized.length<1||normalized.length>1024)fail('P8_PRODUCT_SCOPE_SEASON','Season Product Scope requires 1..1024 Episodes.');scopeKind='episode_manifest';}
  const scopeDigest=canonicalDigest({schema:'libra.product-scope@1',subjectId:subjectSnapshot.subjectId,scopeKind,
    subjectIntakeRevision:subjectSnapshot.intakeRevision,episodeKeys:normalized});
  return Object.freeze({subjectId:subjectSnapshot.subjectId,scopeKind,subjectIntakeRevision:subjectSnapshot.intakeRevision,episodeKeys:normalized,scopeDigest});
}

function validateRequirements(value,profile,structure){
  if(!exactKeys(value,REQUIREMENT_KEYS))fail('P8_SPEC_REQUIREMENT_CLASSES','Acceptance Requirement Set must contain exactly six classes.');
  if(!value.identity||!value.structure||!value.metadata||!value.mandatoryMedia||!value.space||!value.inventory)fail('P8_SPEC_REQUIREMENT_CLASSES','Every Requirement class must be a typed object.');
  if(value.structure.structureKind!==structure)fail('P8_SPEC_STRUCTURE_REQUIREMENT','Structure Requirement conflicts with Subject structure.');
  for(const [owner,key] of [[value.metadata,'requiredFieldCodes'],[value.metadata,'requiredArtifactKinds'],[value.mandatoryMedia,'acceptedPrimaryAudioClasses'],[value.inventory,'requiredMaterializedArtifactKinds']])sortedUnique(owner[key],key);
  if(profile==='series'!== (structure==='season'))fail('P8_SPEC_PROFILE_STRUCTURE','Series is the only season content profile.');
  const hasGiB=value.space.maxSizeGiB!==null&&value.space.maxSizeGiB!==undefined,hasBytes=value.space.maxSizeBytes!==null&&value.space.maxSizeBytes!==undefined;
  if(hasGiB!==hasBytes)fail('P8_SPEC_SPACE_PAIR','Space limit fields must be jointly null or present.');
  if(hasGiB){const numeric=Number(value.space.maxSizeGiB);if(!Number.isFinite(numeric)||numeric<=0||!Number.isSafeInteger(value.space.maxSizeBytes)||value.space.maxSizeBytes!==numeric*1073741824)fail('P8_SPEC_SPACE_LIMIT','Space byte limit must exactly match GiB.');}
  return value;
}

function validateStandard(projection){
  if(!projection||projection.status!=='active'||!projection.standard||projection.shelfId!==projection.standard.shelfId||
      projection.routingProjectionRevision<1||projection.standard.standardRevision<1||
      projection.standard.standardDigest!==canonicalDigest(without(projection.standard,'standardDigest'))||
      projection.projectionResultDigest!==canonicalDigest(without(projection,'projectionResultDigest')))fail('P8_SPEC_STANDARD_PROJECTION','Shelf Standard Projection is not internally consistent.');
  return projection.standard;
}

function ratingResolution(inputSet){
  const facts=inputSet.decisionFacts.filter((fact)=>fact.factKind==='rating');if(facts.length!==1)return null;const fact=facts[0];
  if(fact.resultKind==='not_found')return null;
  if(fact.resultKind!=='found'||!fact.resolvedValue||fact.resolvedValue.factKind!=='rating'||!Number.isSafeInteger(fact.resolvedValue.value)||fact.resolvedValue.value<1||fact.resolvedValue.value>5)fail('P8_SPEC_RATING_FACT','Rating Decision Fact is invalid.');
  return fact.resolvedValue.value;
}

function selectRequirements(profileRule,inputSet,structure){
  if(!profileRule||profileRule.profileRuleSetDigest!==canonicalDigest(without(profileRule,'profileRuleSetDigest')))fail('P8_SPEC_PROFILE_RULE_DIGEST','Profile Rule Set digest is invalid.');
  const kinds=sortedUnique(profileRule.decisionInputKinds,'decisionInputKinds');
  if(kinds.length===0){if(profileRule.decisionBranches.length!==0)return fail('P8_SPEC_PROFILE_BRANCH','Input-free Profile must use base requirements only.');return validateRequirements(profileRule.baseRequirements,profileRule.contentProfile,structure);}
  if(kinds.length!==1||kinds[0]!=='rating'||!Array.isArray(profileRule.decisionBranches)||profileRule.decisionBranches.length!==6)fail('P8_SPEC_PROFILE_BRANCH','Beta decision branch must be the complete rating set.');
  const rating=ratingResolution(inputSet);const branch=profileRule.decisionBranches.find((item)=>rating===null?item.conditionKind==='no_rating':item.conditionKind==='rating_equals'&&item.rating===rating);
  if(!branch)fail('P8_SPEC_PROFILE_BRANCH','Matching rating/no-rating branch is absent.');return validateRequirements(branch.requirements,profileRule.contentProfile,structure);
}

function resolveAcceptanceSpec(value){
  const inputSet=buildDecisionInputSet(value.inputSet);const basis=value.decisionBasis;
  if(inputSet.basisKind!=='acceptance_spec'||inputSet.readiness.result!=='ready'||!basis||
      basis.inputSetDigest!==inputSet.inputSetDigest||basis.basisKind!=='acceptance_spec'||basis.readiness!=='ready'||basis.routingDecisionId!==inputSet.routingDecision.routingDecisionId||
      basis.basisDigest!==canonicalDigest({schema:'libra.decision-basis@1',decisionBasisId:basis.decisionBasisId,subjectId:basis.subjectId,basisKind:basis.basisKind,basisRevision:basis.basisRevision,
        expectedHeadRevision:basis.expectedHeadRevision,expectedHeadSnapshotDigest:basis.expectedHeadSnapshotDigest,
        readiness:basis.readiness,unresolvedReasonCode:basis.unresolvedReasonCode,routingDecisionId:basis.routingDecisionId,queryResultSetDigest:basis.queryResultSetDigest,
        routingInputDigest:basis.routingInputDigest,specInputDigest:basis.specInputDigest,productScopeDigest:basis.productScopeDigest,inputSetDigest:basis.inputSetDigest}))fail('P8_SPEC_BASIS','Acceptance Spec Resolver requires the exact ready Basis.');
  const projection=inputSet.shelfStandardProjection,standard=validateStandard(projection),routing=inputSet.routingDecision,subject=inputSet.subjectSnapshot,scope=inputSet.productScope;
  if(routing.targetShelfId!==projection.shelfId||scope.subjectId!==subject.subjectId||scope.subjectIntakeRevision!==subject.intakeRevision||
      scope.scopeDigest!==canonicalDigest({schema:'libra.product-scope@1',subjectId:scope.subjectId,scopeKind:scope.scopeKind,subjectIntakeRevision:scope.subjectIntakeRevision,episodeKeys:scope.episodeKeys}))fail('P8_SPEC_SCOPE_FRESHNESS','Routing, Standard, Subject, or Product Scope is stale.');
  const profiles=standard.profileRuleSets;if(!Array.isArray(profiles)||profiles.length<1||profiles.length>4)fail('P8_SPEC_PROFILE_SET','Shelf Standard profile set is invalid.');
  const profile=profiles.find((item)=>item.contentProfile===subject.contentProfile);if(!profile)fail('P8_SPEC_PROFILE_RULE_NOT_FOUND','Shelf Standard has no matching content profile.');
  const requirements=selectRequirements(profile,inputSet,subject.structureKind);
  const specDigest=canonicalDigest({schema:'libra.acceptance-spec-semantic@1',targetShelfId:routing.targetShelfId,contentProfile:subject.contentProfile,
    structureKind:subject.structureKind,productScope:{scopeKind:scope.scopeKind,episodeKeys:scope.episodeKeys},requirements});
  const draftBase={schemaRef:'helix://contracts/types/AcceptanceSpecDraft/v1',schemaVersion:1,draftId:canonicalDigest({schema:'libra.acceptance-spec-draft-id@1',subjectId:subject.subjectId,decisionBasisId:basis.decisionBasisId}),
    draftKind:'libra_acceptance_spec',basisDigest:basis.basisDigest,producedAtMs:value.producedAtMs,subjectId:subject.subjectId,targetShelfId:routing.targetShelfId,
    contentProfile:subject.contentProfile,structureKind:subject.structureKind,productScope:scope,shelfRoutingProjectionRevision:projection.routingProjectionRevision,
    shelfProjectionDigest:projection.projectionDigest,shelfStandardRevision:standard.standardRevision,shelfStandardDigest:standard.standardDigest,
    decisionBasisId:basis.decisionBasisId,decisionBasisDigest:basis.basisDigest,requirements,specDigest};
  const draftDigest=canonicalDigest(draftBase),draft={...draftBase,draftDigest};const specRevision=value.specRevision;
  if(!Number.isSafeInteger(specRevision)||specRevision<1||!Number.isSafeInteger(value.publishedAtMs)||value.publishedAtMs<0)fail('P8_SPEC_PUBLICATION_CONTEXT','Spec revision and publication time are required.');
  const recordDigest=canonicalDigest({schema:'libra.acceptance-spec-record@1',specRevision,draft});
  const acceptanceSpecId=canonicalDigest({schema:'libra.acceptance-spec-id@1',subjectId:subject.subjectId,specRevision,decisionBasisId:basis.decisionBasisId,recordDigest});
  const spec=Object.freeze({...draft,schemaRef:'libra.acceptance-spec@1',
    acceptanceSpecId,specRevision,recordDigest,publishedAtMs:value.publishedAtMs});
  if(Buffer.byteLength(canonicalJson(spec),'utf8')>65536)fail('P8_SPEC_LIMIT','Acceptance Spec exceeds 64 KiB.');return spec;
}

module.exports=Object.freeze({buildProductScope,resolveAcceptanceSpec,validateRequirements});
