'use strict';

const {canonicalDigest}=require('../../../contracts/canonical-json');
const {offloadProductKeys}=require('../../../contracts/offload-product-targets');
const {requiresInputSettlement}=require('./offload-settlement');
const stable=(prefix,value)=>prefix+canonicalDigest(value).slice(0,40);
const withDigest=value=>Object.freeze({...value,digest:canonicalDigest(value)});

function assertSettlementAuthorization(value,role=null){
  const primary=['old_primary_input','old_primary_and_exclusive_related'];
  const related=['exclusive_related_input','old_primary_and_exclusive_related'];
  const allowed=!role||(role==='original_input'||role==='structural_dependency'?primary:role==='related_input'?related:[]).includes(value?.authorizationScopeKind);
  if(value?.state!=='enabled'||!allowed)throw Object.assign(new Error('Current Input Settlement Authorization does not cover this member.'),{code:'ARCA_INPUT_SETTLEMENT_AUTHORIZATION_REQUIRED'});
}

function settlementHandles(c,materialKey,verification,authorization) { assertSettlementAuthorization(authorization);
  if(verification?.schemaRef!=='helix://contracts/types/FinalProductVerification/v1'||verification.result!=='passed'||
    verification.productManifestDigest!==c.packageValue.productMaterialManifest.manifestDigest)throw new Error('Settlement requires this package Final Product Verification.');
  const source=(c.packageValue.offloadContextManifest?.members||[]).find((item)=>item.materialKey===materialKey&&
  requiresInputSettlement(item));
  if(!source)throw new Error('Settlement Material is outside the approved Off-load Context.');
  assertSettlementAuthorization(authorization,source.contextRole);
  if(source.contextRole==='related_input'&&(!source.sourceRelatedReferenceId||!source.derivedAuthorityDigest))throw new Error('Related Settlement lacks exclusive derived authority.');
  const keys=offloadProductKeys(source);
  if(keys.some(key=>verification.verifiedMaterialKeys?.filter(actual=>actual===key).length!==1))
    throw new Error('Every Settlement successor must occur exactly once in Final Product Verification.');
  const handle=Object.freeze({schemaRef:'helix://contracts/types/PhysicalMaterialReadHandle/v1',schemaVersion:1,
    handleId:stable('arca-settlement-read-',{run:c.responsibility.onDeckRunId,key:source.materialKey}),identity:source.physicalIdentity,ownerDomain:'arca',
    ownerScope:Object.freeze({scopeType:'on_deck_custody',scopeId:c.responsibility.custodyId}),bindingRevision:source.bindingRevision,endpointId:source.endpointId,
    location:source.location,mountScopeRevision:1,expectedSizeBytes:source.physicalIdentity.sizeBytes,expectedMtimeNs:0,expectedCtimeNs:0,fingerprintVerifiedAtMs:0,
    readScope:'exact_input_settlement',expiresAtMs:Number.MAX_SAFE_INTEGER,fenceDigest:canonicalDigest({run:c.responsibility.onDeckRunId,memberDigest:source.memberDigest})});
  const role=source.contextRole==='original_input'?'primary_payload':source.contextRole==='structural_dependency'?'structural_dependency':'exclusive_related';
  const finals=keys.length===1?[c.settlementFinalMember]:c.settlementFinalMembers;
  if(!Array.isArray(finals)||finals.length!==keys.length||finals.some((item,index)=>
    !item||item.sourceMaterialKey!==keys[index]||typeof item.targetLocation!=='string'||!item.targetLocation.length||item.targetLocation.length>4096))
    throw new Error('Settlement source-to-final mapping drifted from the complete bounded Final Inventory members.');
  if(keys.length>1&&source.sourceRelatedReferenceId!==null)throw new Error('Multiple Settlement targets cannot carry a Related reference.');
  const targets=keys.length===1?{finalMaterialKey:keys[0],finalTargetLocation:finals[0].targetLocation}:
    {finalTargets:Object.freeze(finals.map(item=>Object.freeze({materialKey:item.sourceMaterialKey,targetLocation:item.targetLocation})))};
  const memberBody={ordinal:0,materialKey:source.materialKey,role,sourceRelatedReferenceId:source.sourceRelatedReferenceId,materialHandle:handle,
    ...targets,settlementExpectation:source.settlementExpectation,
    dispositionMemberRef:source.memberDigest,sourceToFinalMappingDigest:source.derivedAuthorityDigest||canonicalDigest(source),
    finalProductVerificationDigest:canonicalDigest(verification)};
  const member=Object.freeze({...memberBody,memberDigest:canonicalDigest(memberBody)}),members=Object.freeze([member]),memberSetDigest=canonicalDigest({schema:'arca.settlement-members@1',items:members});
  const body={schemaRef:'helix://contracts/domain-types/OldPrimaryStructuralExclusiveRelatedHandles/v1',schemaVersion:1,
    objectId:c.responsibility.onDeckRunId+':settlement:'+materialKey,revision:1,onDeckRunId:c.responsibility.onDeckRunId,
    approvalScopeDigest:canonicalDigest({schema:'arca.settlement-approval-scope@1',onDeckRunId:c.responsibility.onDeckRunId,materialKey,memberSetDigest,authorizationDigest:authorization.authorizationDigest}),
    members,memberSetDigest,handleSetDigest:canonicalDigest({schema:'arca.settlement-handles@1',items:[handle.fenceDigest]})};return withDigest(body); }

function isSettlementAuthorityUnavailable(error){return ['ARCA_INPUT_SETTLEMENT_AUTHORIZATION_REQUIRED','ARCA_INPUT_SETTLEMENT_APPROVAL_REQUIRED'].includes(error?.code);}
module.exports=Object.freeze({settlementHandles,assertSettlementAuthorization,isSettlementAuthorityUnavailable});
