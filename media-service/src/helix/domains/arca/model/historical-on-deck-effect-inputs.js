'use strict';

// Read-only historical witness for UAT-261. Never use for new execution or approval.
// Source: b8fbee1a95e41efa3ee55c93eb42e80927cc79a7, on-deck-projections.js.
// UAT-172 records its authorization gap; reconstruction cannot cure that gap.
const {canonicalDigest}=require('../../../contracts/canonical-json');
const {requiresInputSettlement}=require('./offload-settlement');
const stable=(prefix,value)=>prefix+canonicalDigest(value).slice(0,40);
const withDigest=value=>Object.freeze({...value,digest:canonicalDigest(value)});
function settlementHandles(c,materialKey) { const source=(c.packageValue.offloadContextManifest?.members||[]).find((item)=>item.materialKey===materialKey&&
  requiresInputSettlement(item));
  if(!source)throw new Error('Settlement Material is outside the approved Off-load Context.');
  const handle=Object.freeze({schemaRef:'helix://contracts/types/PhysicalMaterialReadHandle/v1',schemaVersion:1,
    handleId:stable('arca-settlement-read-',{run:c.responsibility.onDeckRunId,key:source.materialKey}),identity:source.physicalIdentity,ownerDomain:'arca',
    ownerScope:Object.freeze({scopeType:'on_deck_custody',scopeId:c.responsibility.custodyId}),bindingRevision:source.bindingRevision,endpointId:source.endpointId,
    location:source.location,mountScopeRevision:1,expectedSizeBytes:source.physicalIdentity.sizeBytes,expectedMtimeNs:0,expectedCtimeNs:0,fingerprintVerifiedAtMs:0,
    readScope:'exact_input_settlement',expiresAtMs:Number.MAX_SAFE_INTEGER,fenceDigest:canonicalDigest({run:c.responsibility.onDeckRunId,memberDigest:source.memberDigest})});
  const role=source.contextRole==='original_input'?'primary_payload':source.contextRole==='structural_dependency'?'structural_dependency':'exclusive_related';
  const finalMember=c.settlementFinalMember;
  if(!finalMember)throw new Error('Settlement source-to-final mapping is absent from the Final Inventory Decision.');
  if(finalMember.sourceMaterialKey!==source.finalProductMaterialKey)throw new Error('Settlement source-to-final mapping drifted from the bounded Final Inventory member.');
  const memberBody={ordinal:0,materialKey:source.materialKey,role,sourceRelatedReferenceId:source.sourceRelatedReferenceId,materialHandle:handle,
    finalMaterialKey:source.finalProductMaterialKey,finalTargetLocation:finalMember.targetLocation,settlementExpectation:source.settlementExpectation,
    dispositionMemberRef:source.memberDigest,sourceToFinalMappingDigest:source.derivedAuthorityDigest||canonicalDigest(source),
    finalProductVerificationDigest:c.packageValue.productionAttestation.productConformanceEvidenceDigest};
  const member=Object.freeze({...memberBody,memberDigest:canonicalDigest(memberBody)}),members=Object.freeze([member]),memberSetDigest=canonicalDigest({schema:'arca.settlement-members@1',items:members});
  const body={schemaRef:'helix://contracts/domain-types/OldPrimaryStructuralExclusiveRelatedHandles/v1',schemaVersion:1,
    objectId:c.responsibility.onDeckRunId+':settlement:'+materialKey,revision:1,onDeckRunId:c.responsibility.onDeckRunId,
    approvalScopeDigest:canonicalDigest({schema:'arca.settlement-approval-scope@1',onDeckRunId:c.responsibility.onDeckRunId,materialKey,memberSetDigest}),
    members,memberSetDigest,handleSetDigest:canonicalDigest({schema:'arca.settlement-handles@1',items:[handle.fenceDigest]})};return withDigest(body); }

module.exports=Object.freeze({settlementHandles});
