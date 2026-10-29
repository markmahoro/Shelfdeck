'use strict';

const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {applyCustomRequirementChanges}=require('../../../contracts/custom-acceptance-requirements');
const {assertCustomAcceptanceHandoff,buildCustomAcceptanceHandoff}=require('../../../contracts/custom-acceptance-handoff');
const {packageContentProfile}=require('./product-content-profile');
const SHA=/^[a-f0-9]{64}$/;
const DRAFT_SCHEMA='helix://contracts/types/AcceptanceSpecDraft/v1';
const RECORD_KEYS=['schemaRef','schemaVersion','draftId','draftKind','basisDigest','producedAtMs','subjectId','targetShelfId',
  'contentProfile','structureKind','productScope','shelfRoutingProjectionRevision','shelfProjectionDigest','shelfStandardRevision',
  'shelfStandardDigest','decisionBasisId','decisionBasisDigest','requirements','specDigest','draftDigest','acceptanceSpecId',
  'specRevision','recordDigest','publishedAtMs'];
const CUSTOM_KEYS=['targetKind','customTargetRef','originalTarget','targetInputDigest','episodeMetadataOverrides'];
function fail(){throw Object.assign(new Error('Arca custom target evidence is incomplete or inconsistent.'),{code:'ARCA_CUSTOM_TARGET_INVALID'});}
function same(left,right){return canonicalJson(left)===canonicalJson(right);}
function without(value,...keys){return Object.fromEntries(Object.entries(value).filter(([key])=>!keys.includes(key)));}
function exact(value,keys){return value&&typeof value==='object'&&!Array.isArray(value)&&same(Object.keys(value).sort(),[...keys].sort());}
function digestRecord(value,key){return value&&SHA.test(value[key]||'')&&value[key]===canonicalDigest(without(value,key));}
function integer(value,min=0){return Number.isSafeInteger(value)&&value>=min;}
function proof(value){return exact(value,['commandReceiptId','requestDigest','committedAtMs'])&&SHA.test(value.commandReceiptId||'')&&
  SHA.test(value.requestDigest||'')&&integer(value.committedAtMs);}
function verifySpec(spec,custom){
  if(!exact(spec,[...RECORD_KEYS,...(custom?CUSTOM_KEYS:[])])||spec.schemaRef!=='libra.acceptance-spec@1'||spec.schemaVersion!==1||
      spec.draftKind!=='libra_acceptance_spec'||!integer(spec.specRevision,1)||!integer(spec.producedAtMs)||!integer(spec.publishedAtMs)||
      spec.contentProfile!=='movie'||spec.structureKind!=='single'||custom&&spec.targetKind!=='user_custom')fail();
  const scope=spec.productScope;
  if(!exact(scope,['subjectId','scopeKind','subjectIntakeRevision','episodeKeys','scopeDigest'])||scope.subjectId!==spec.subjectId||
      scope.scopeKind!=='single'||!integer(scope.subjectIntakeRevision,1)||!same(scope.episodeKeys,[])||
      scope.scopeDigest!==canonicalDigest({schema:'libra.product-scope@1',subjectId:scope.subjectId,scopeKind:scope.scopeKind,
        subjectIntakeRevision:scope.subjectIntakeRevision,episodeKeys:scope.episodeKeys}))fail();
  const semantic={schema:'libra.acceptance-spec-semantic@1',...(custom?{targetKind:'user_custom'}:{}),
    targetShelfId:spec.targetShelfId,contentProfile:spec.contentProfile,structureKind:spec.structureKind,
    productScope:{scopeKind:scope.scopeKind,episodeKeys:scope.episodeKeys},requirements:spec.requirements,
    ...(custom?{episodeMetadataOverrides:spec.episodeMetadataOverrides}:{})},
    draft={...without(spec,'acceptanceSpecId','specRevision','recordDigest','publishedAtMs'),schemaRef:DRAFT_SCHEMA};
  if(spec.specDigest!==canonicalDigest(semantic)||spec.draftDigest!==canonicalDigest(without(draft,'draftDigest'))||
      spec.recordDigest!==canonicalDigest({schema:'libra.acceptance-spec-record@1',specRevision:spec.specRevision,draft})||
      spec.acceptanceSpecId!==canonicalDigest({schema:'libra.acceptance-spec-id@1',subjectId:spec.subjectId,specRevision:spec.specRevision,
        decisionBasisId:spec.decisionBasisId,recordDigest:spec.recordDigest}))fail();
}

// Only a structural precheck for a Movie. The caller must obtain confirmation
// from Libra's public reader, bind the formal Handoff references, and recheck
// its read fence during the Arca transaction. Conformance and safety are
// separate real-product checks; this function does not accept or commit one.
function verifyArcaCustomAcceptanceTarget({packageValue,shelf,confirmation}){
  if(!packageValue||!shelf||confirmation?.kind!=='ready'||!confirmation.readFence||!confirmation.evidence||!confirmation.records)fail();
  const {evidence,records}=confirmation,{spec,baseSpec,preview,intent}=records,
    snapshot=packageValue.productionProvenance?.acceptanceRequirementSnapshot,structure=packageValue.productStructureSnapshot;
  if(!exact(evidence,['schemaRef','subjectId','productScopeDigest','acceptanceSpecId','acceptanceSpecRecordDigest','intentId','intentDigest',
        'previewDigest','baseAcceptanceSpecId','baseSpecRecordDigest','actorId','previewProof','confirmationProof','publicationProof','evidenceDigest'])||
      !digestRecord(evidence,'evidenceDigest')||evidence.schemaRef!=='libra.custom-target-confirmation-evidence@1'||
      !proof(evidence.previewProof)||!proof(evidence.confirmationProof)||!proof(evidence.publicationProof)||
      !digestRecord(preview,'previewDigest')||!digestRecord(intent,'intentDigest')||!snapshot||!structure)fail();
  verifySpec(baseSpec,false);verifySpec(spec,true);
  if(packageContentProfile(packageValue)!=='movie'||shelf.status!=='active'||shelf.shelfId!==spec.targetShelfId||
      shelf.currentStandardRevision!==spec.shelfStandardRevision||shelf.standard?.digest!==spec.shelfStandardDigest||
      baseSpec.targetShelfId!==spec.targetShelfId||baseSpec.shelfStandardRevision!==spec.shelfStandardRevision||
      baseSpec.shelfStandardDigest!==spec.shelfStandardDigest||baseSpec.subjectId!==spec.subjectId||
      !same(baseSpec.productScope,spec.productScope)||spec.specRevision<=baseSpec.specRevision||
      packageValue.subjectId!==spec.subjectId||packageValue.shelfId!==spec.targetShelfId||
      packageValue.acceptanceSpecRef?.id!==spec.acceptanceSpecId||packageValue.acceptanceSpecRef?.recordDigest!==spec.recordDigest||
      packageValue.resolvedIdentitySnapshot?.factDigest!==intent.basis?.identityDigest||
      !digestRecord(structure,'productStructureDigest')||structure.contentProfile!=='movie'||structure.structureKind!=='single'||
      structure.productScopeDigest!==spec.productScope.scopeDigest||!integer(structure.primaryMaterialCount,1)||
      !integer(structure.structuralDependencyCount)||!digestRecord(snapshot,'snapshotDigest')||
      snapshot.schemaRef!=='helix://contracts/domain-types/AcceptanceRequirementSnapshot/v1'||snapshot.schemaVersion!==1||
      snapshot.acceptanceSpecId!==spec.acceptanceSpecId||snapshot.acceptanceSpecRecordDigest!==spec.recordDigest||
      snapshot.targetShelfId!==spec.targetShelfId||snapshot.contentProfile!=='movie'||snapshot.structureKind!=='single'||
      snapshot.shelfStandardRevision!==spec.shelfStandardRevision||snapshot.shelfStandardDigest!==spec.shelfStandardDigest||
      !same(snapshot.requirements,spec.requirements)||!same(snapshot.customAcceptanceHandoff,buildCustomAcceptanceHandoff(spec)))fail();
  const basis=preview.basis,ref=spec.customTargetRef;
  if(!basis||!same(basis,intent.basis)||basis.subjectId!==spec.subjectId||basis.productScopeDigest!==spec.productScope.scopeDigest||
      basis.baseAcceptanceSpecId!==baseSpec.acceptanceSpecId||basis.baseSpecRecordDigest!==baseSpec.recordDigest||
      basis.baseSpecDigest!==baseSpec.specDigest||basis.shelfId!==spec.targetShelfId||basis.shelfStandardRevision!==spec.shelfStandardRevision||
      basis.shelfStandardDigest!==spec.shelfStandardDigest||basis.contentProfile!=='movie'||basis.structureKind!=='single'||
      !['no_offer','not_accepted'].includes(basis.handoffState)||!integer(basis.customTargetRevision)||intent.revision!==basis.customTargetRevision+1||
      typeof intent.actorId!=='string'||!intent.actorId.trim()||intent.actorId.length>256||
      typeof intent.idempotencyKey!=='string'||!intent.idempotencyKey.trim()||intent.idempotencyKey.length>128||
      preview.actorId!==intent.actorId||intent.actorId!==evidence.actorId||intent.acknowledged!==true||
      intent.subjectId!==basis.subjectId||intent.libraRunId!==basis.libraRunId||intent.previewDigest!==preview.previewDigest||
      !same(preview.baseRequirements,baseSpec.requirements)||!same(preview.episodeScopes,[])||
      !Array.isArray(preview.proposals)||!preview.proposals.length||preview.proposals.length>256||
      !Array.isArray(intent.selectedChangeDigests)||!intent.selectedChangeDigests.length||intent.selectedChangeDigests.length>256||
      new Set(intent.selectedChangeDigests).size!==intent.selectedChangeDigests.length||
      !same([...intent.selectedChangeDigests].sort(),intent.selectedChangeDigests))fail();
  const byDigest=new Map();
  for(const proposal of preview.proposals){
    if(!exact(proposal,['change','evidenceRefs','changeDigest'])||!Array.isArray(proposal.evidenceRefs)||!proposal.evidenceRefs.length||
        proposal.changeDigest!==canonicalDigest({change:proposal.change,evidenceRefs:proposal.evidenceRefs})||byDigest.has(proposal.changeDigest))fail();
    byDigest.set(proposal.changeDigest,proposal.change);
  }
  if(intent.selectedChangeDigests.some(digest=>!byDigest.has(digest))||
      intent.requestDigest!==canonicalDigest({subjectId:intent.subjectId,libraRunId:intent.libraRunId,previewDigest:preview.previewDigest,
        selectedChangeDigests:intent.selectedChangeDigests,acknowledged:true})||
      intent.intentId!==canonicalDigest({schema:'libra.custom-target-command-id@1',subjectId:intent.subjectId,actorId:intent.actorId,
        idempotencyKey:intent.idempotencyKey}))fail();
  const target=applyCustomRequirementChanges({requirements:baseSpec.requirements,
    changes:intent.selectedChangeDigests.map(digest=>byDigest.get(digest)),episodeScopes:preview.episodeScopes});
  if(!same(intent.target,target)||!same(spec.requirements,target.requirements)||
      !same(spec.episodeMetadataOverrides,target.episodeMetadataOverrides)||
      !same(spec.originalTarget,{acceptanceSpecId:baseSpec.acceptanceSpecId,specRevision:baseSpec.specRevision,
        recordDigest:baseSpec.recordDigest,specDigest:baseSpec.specDigest,requirements:baseSpec.requirements})||
      !same(ref,{schemaRef:'libra.custom-target-reference@1',intentId:intent.intentId,intentDigest:intent.intentDigest,
        targetRevision:intent.revision,previewDigest:preview.previewDigest,targetRequirementsDigest:target.targetRequirementsDigest})||
      spec.targetInputDigest!==canonicalDigest({schema:'libra.custom-acceptance-spec-input@1',baseSpecRecordDigest:baseSpec.recordDigest,
        customTargetRef:ref,identityDigest:basis.identityDigest,materialSetDigest:basis.materialSetDigest,productScopeDigest:basis.productScopeDigest})||
      spec.draftId!==canonicalDigest({schema:'libra.custom-acceptance-spec-draft-id@1',subjectId:spec.subjectId,
        decisionBasisId:spec.decisionBasisId,targetInputDigest:spec.targetInputDigest})||
      baseSpec.draftId!==canonicalDigest({schema:'libra.acceptance-spec-draft-id@1',subjectId:baseSpec.subjectId,decisionBasisId:baseSpec.decisionBasisId})||
      evidence.subjectId!==spec.subjectId||evidence.productScopeDigest!==spec.productScope.scopeDigest||
      evidence.acceptanceSpecId!==spec.acceptanceSpecId||evidence.acceptanceSpecRecordDigest!==spec.recordDigest||
      evidence.baseAcceptanceSpecId!==baseSpec.acceptanceSpecId||evidence.baseSpecRecordDigest!==baseSpec.recordDigest||
      evidence.intentId!==intent.intentId||evidence.intentDigest!==intent.intentDigest||evidence.previewDigest!==preview.previewDigest||
      evidence.previewProof.requestDigest!==canonicalDigest({schema:'libra.custom-target-preview-request@1',
        subjectId:intent.subjectId,libraRunId:intent.libraRunId})||
      evidence.confirmationProof?.commandReceiptId!==canonicalDigest({schema:'libra.custom-target-command-receipt@1',kind:'intent',
        actorId:intent.actorId,idempotencyKey:intent.idempotencyKey})||evidence.confirmationProof.requestDigest!==intent.requestDigest||
      evidence.publicationProof?.commandReceiptId!==canonicalDigest({schema:'libra.custom-spec-command-id@1',intentId:intent.intentId})||
      evidence.publicationProof.requestDigest!==canonicalDigest({schema:'libra.custom-target.spec.publish@1',
        intentId:intent.intentId,intentDigest:intent.intentDigest})||
      evidence.publicationProof.committedAtMs!==spec.publishedAtMs)fail();
  const body={schemaRef:'arca.custom-acceptance-target-basis@1',subjectId:spec.subjectId,shelfId:spec.targetShelfId,
    shelfStandardRevision:spec.shelfStandardRevision,shelfStandardDigest:spec.shelfStandardDigest,productScopeDigest:spec.productScope.scopeDigest,
    acceptanceSpecId:spec.acceptanceSpecId,acceptanceSpecRecordDigest:spec.recordDigest,originalSpecId:baseSpec.acceptanceSpecId,
    originalSpecRecordDigest:baseSpec.recordDigest,intentId:intent.intentId,intentDigest:intent.intentDigest,
    confirmationEvidenceDigest:evidence.evidenceDigest,targetRequirementsDigest:target.targetRequirementsDigest,
    originalRequirements:baseSpec.requirements,customRequirements:target.requirements};
  return Object.freeze({...body,basisDigest:canonicalDigest(body)});
}

function assertArcaCustomAcceptanceBasis({packageValue,shelf,basis}){
  const snapshot=packageValue?.productionProvenance?.acceptanceRequirementSnapshot,ref=snapshot?.customAcceptanceHandoff;
  try{assertCustomAcceptanceHandoff(ref);}catch{fail();}
  if(!ref||!exact(basis,['schemaRef','subjectId','shelfId','shelfStandardRevision','shelfStandardDigest','productScopeDigest',
      'acceptanceSpecId','acceptanceSpecRecordDigest','originalSpecId','originalSpecRecordDigest','intentId','intentDigest',
      'confirmationEvidenceDigest','targetRequirementsDigest','originalRequirements','customRequirements','basisDigest'])||
      !digestRecord(basis,'basisDigest')||basis.schemaRef!=='arca.custom-acceptance-target-basis@1'||
      basis.subjectId!==packageValue.subjectId||basis.shelfId!==packageValue.shelfId||basis.shelfId!==shelf?.shelfId||
      basis.shelfStandardRevision!==snapshot.shelfStandardRevision||basis.shelfStandardDigest!==snapshot.shelfStandardDigest||
      !digestRecord(snapshot,'snapshotDigest')||basis.productScopeDigest!==ref.productScopeDigest||
      basis.productScopeDigest!==packageValue.productStructureSnapshot?.productScopeDigest||
      basis.acceptanceSpecId!==snapshot.acceptanceSpecId||basis.acceptanceSpecId!==ref.customSpec?.acceptanceSpecId||
      basis.acceptanceSpecRecordDigest!==snapshot.acceptanceSpecRecordDigest||basis.originalSpecId!==ref.originalSpec?.acceptanceSpecId||
      basis.acceptanceSpecRecordDigest!==ref.customSpec?.recordDigest||
      basis.originalSpecRecordDigest!==ref.originalSpec?.recordDigest||basis.intentId!==ref.customTargetRef?.intentId||
      basis.intentDigest!==ref.customTargetRef?.intentDigest||basis.targetRequirementsDigest!==ref.customTargetRef?.targetRequirementsDigest||
      !SHA.test(basis.confirmationEvidenceDigest||'')||!same(basis.customRequirements,snapshot.requirements))fail();
  return basis;
}

module.exports=Object.freeze({verifyArcaCustomAcceptanceTarget,assertArcaCustomAcceptanceBasis});
