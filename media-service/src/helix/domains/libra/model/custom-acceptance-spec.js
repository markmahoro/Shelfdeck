'use strict';

const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {validateRequirements}=require('./acceptance-spec-contracts');
const {assertCustomTargetPreview,assertCustomTargetIntent}=require('./custom-target-records');
const DRAFT_SCHEMA='helix://contracts/types/AcceptanceSpecDraft/v1';
const SPEC_SCHEMA='libra.acceptance-spec@1';
const DRAFT_KEYS=['schemaRef','schemaVersion','draftId','draftKind','basisDigest','producedAtMs','subjectId','targetShelfId',
  'contentProfile','structureKind','productScope','shelfRoutingProjectionRevision','shelfProjectionDigest','shelfStandardRevision',
  'shelfStandardDigest','decisionBasisId','decisionBasisDigest','requirements','specDigest'];
function fail(code){throw Object.assign(new Error(code),{code});}
function without(value,...keys){return Object.fromEntries(Object.entries(value).filter(([key])=>!keys.includes(key)));}
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function uint(value,minimum=0){if(!Number.isSafeInteger(value)||value<minimum)fail('LIBRA_CUSTOM_SPEC_PUBLICATION_INVALID');return value;}
function checkStandardSpec(value){
  if(!value||value.schemaRef!==SPEC_SCHEMA||canonicalJson(Object.keys(value).sort())!==
      canonicalJson([...DRAFT_KEYS,'draftDigest','acceptanceSpecId','specRevision','recordDigest','publishedAtMs'].sort())||
      value.schemaVersion!==1||value.draftKind!=='libra_acceptance_spec')fail('LIBRA_CUSTOM_SPEC_BASE_INVALID');
  const draft={...without(value,'acceptanceSpecId','specRevision','recordDigest','publishedAtMs'),schemaRef:DRAFT_SCHEMA},
    draftBase=without(draft,'draftDigest');
  uint(value.specRevision,1);uint(value.producedAtMs);uint(value.publishedAtMs);
  validateRequirements(value.requirements,value.contentProfile,value.structureKind);
  const semantic={schema:'libra.acceptance-spec-semantic@1',targetShelfId:value.targetShelfId,contentProfile:value.contentProfile,
    structureKind:value.structureKind,productScope:{scopeKind:value.productScope?.scopeKind,episodeKeys:value.productScope?.episodeKeys},requirements:value.requirements};
  if(value.draftDigest!==canonicalDigest(draftBase)||value.specDigest!==canonicalDigest(semantic)||
      value.recordDigest!==canonicalDigest({schema:'libra.acceptance-spec-record@1',specRevision:value.specRevision,draft})||
      value.acceptanceSpecId!==canonicalDigest({schema:'libra.acceptance-spec-id@1',subjectId:value.subjectId,specRevision:value.specRevision,
        decisionBasisId:value.decisionBasisId,recordDigest:value.recordDigest})||
      value.draftId!==canonicalDigest({schema:'libra.acceptance-spec-draft-id@1',subjectId:value.subjectId,decisionBasisId:value.decisionBasisId}))
    fail('LIBRA_CUSTOM_SPEC_BASE_INVALID');
  return value;
}
function buildCustomAcceptanceSpec({baseSpec,preview,intent,specRevision,producedAtMs,publishedAtMs}){
  checkStandardSpec(baseSpec);preview=assertCustomTargetPreview(preview);intent=assertCustomTargetIntent(intent,preview);
  const basis=preview.basis;
  if(baseSpec.acceptanceSpecId!==basis.baseAcceptanceSpecId||baseSpec.recordDigest!==basis.baseSpecRecordDigest||
      baseSpec.specDigest!==basis.baseSpecDigest||baseSpec.subjectId!==basis.subjectId||baseSpec.targetShelfId!==basis.shelfId||
      baseSpec.shelfStandardRevision!==basis.shelfStandardRevision||baseSpec.shelfStandardDigest!==basis.shelfStandardDigest||
      baseSpec.contentProfile!==basis.contentProfile||baseSpec.structureKind!==basis.structureKind||
      baseSpec.productScope.scopeDigest!==basis.productScopeDigest||canonicalJson(baseSpec.requirements)!==canonicalJson(preview.baseRequirements)||
      canonicalJson([...baseSpec.productScope.episodeKeys].sort())!==canonicalJson(preview.episodeScopes.map(scope=>scope.episodeKey).sort()))
    fail('LIBRA_CUSTOM_SPEC_BASIS_MISMATCH');
  uint(specRevision,baseSpec.specRevision+1);uint(producedAtMs);uint(publishedAtMs);
  const requirements=validateRequirements(intent.target.requirements,baseSpec.contentProfile,baseSpec.structureKind),
    episodeMetadataOverrides=intent.target.episodeMetadataOverrides,
    customTargetRef={schemaRef:'libra.custom-target-reference@1',intentId:intent.intentId,intentDigest:intent.intentDigest,targetRevision:intent.revision,
      previewDigest:preview.previewDigest,targetRequirementsDigest:intent.target.targetRequirementsDigest},
    originalTarget={acceptanceSpecId:baseSpec.acceptanceSpecId,specRevision:baseSpec.specRevision,recordDigest:baseSpec.recordDigest,
      specDigest:baseSpec.specDigest,requirements:baseSpec.requirements},
    targetInputDigest=canonicalDigest({schema:'libra.custom-acceptance-spec-input@1',baseSpecRecordDigest:baseSpec.recordDigest,
      customTargetRef,identityDigest:basis.identityDigest,materialSetDigest:basis.materialSetDigest,productScopeDigest:basis.productScopeDigest}),
    specDigest=canonicalDigest({schema:'libra.acceptance-spec-semantic@1',targetKind:'user_custom',targetShelfId:baseSpec.targetShelfId,
      contentProfile:baseSpec.contentProfile,structureKind:baseSpec.structureKind,
      productScope:{scopeKind:baseSpec.productScope.scopeKind,episodeKeys:baseSpec.productScope.episodeKeys},requirements,episodeMetadataOverrides}),
    draftBase={...without(baseSpec,'acceptanceSpecId','specRevision','recordDigest','publishedAtMs','draftDigest'),schemaRef:DRAFT_SCHEMA,
      draftId:canonicalDigest({schema:'libra.custom-acceptance-spec-draft-id@1',subjectId:baseSpec.subjectId,
        decisionBasisId:baseSpec.decisionBasisId,targetInputDigest}),producedAtMs,targetKind:'user_custom',customTargetRef,originalTarget,
      targetInputDigest,requirements,episodeMetadataOverrides,specDigest},
    draft={...draftBase,draftDigest:canonicalDigest(draftBase)},
    recordDigest=canonicalDigest({schema:'libra.acceptance-spec-record@1',specRevision,draft}),
    acceptanceSpecId=canonicalDigest({schema:'libra.acceptance-spec-id@1',subjectId:baseSpec.subjectId,specRevision,
      decisionBasisId:baseSpec.decisionBasisId,recordDigest}),
    spec={...draft,schemaRef:SPEC_SCHEMA,acceptanceSpecId,specRevision,recordDigest,publishedAtMs};
  if(Buffer.byteLength(canonicalJson(spec))>65536)fail('LIBRA_CUSTOM_SPEC_LIMIT');
  return freeze(JSON.parse(canonicalJson(spec)));
}
function assertCustomAcceptanceSpec({spec,baseSpec,preview,intent}){
  const rebuilt=buildCustomAcceptanceSpec({baseSpec,preview,intent,specRevision:spec?.specRevision,
    producedAtMs:spec?.producedAtMs,publishedAtMs:spec?.publishedAtMs});
  if(canonicalJson(spec)!==canonicalJson(rebuilt))fail('LIBRA_CUSTOM_SPEC_RECORD_INVALID');
  return rebuilt;
}

module.exports=Object.freeze({buildCustomAcceptanceSpec,assertCustomAcceptanceSpec});
