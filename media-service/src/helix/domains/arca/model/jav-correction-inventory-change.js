'use strict';
const {canonicalDigest,canonicalJson}=require('../../../contracts/canonical-json');
const {assertJavCorrectionVerifiedSource}=require('./jav-correction-execution-contract');
const {buildJavCorrectionProposal,buildJavCorrectionBasis}=require('./jav-identity-correction');
const {buildJavCorrectionMetadata}=require('./jav-correction-metadata');
const {buildJavCorrectionCast}=require('./jav-correction-cast');
const {metadataRecord,castRecord}=require('./jav-correction-stored-facts');
const {physicalIdentityFromInventoryRow}=require('./aftercare-contract');
const {readInventoryMapping,inventoryMappingFact}=require('../../../contracts/related-primary-mappings');
const fail=message=>{throw Object.assign(new TypeError(message),{code:'ARCA_JAV_CORRECTION_INVENTORY_INVALID'});};
function representationMember(row,ordinal) {
  return {ordinal,materialKey:row.material_key,role:row.role,episodeClaims:JSON.parse(row.episode_claims_json),
    endpointId:row.endpoint_id,location:row.location,bindingRevision:Number(row.binding_revision),
    physicalIdentity:physicalIdentityFromInventoryRow(row),digestHex:row.digest_hex,sizeBytes:Number(row.size_bytes)};
}
function castResolutions(cast) {
  if(!cast||!Array.isArray(cast.referenceProofs))fail('Correction cast is missing its exact public reference proofs.');
  return cast.referenceProofs.map(proof=>({relationId:proof.relationId,inputDigest:proof.inputDigest,result:proof.resolutionKind==='unresolved'?
    {kind:'unresolved',reasonCode:proof.reasonCode}:{schema:'people.media-cast-reference-proof@1',kind:'resolved',personId:proof.personId,
      personRevision:proof.personRevision,personFactDigest:proof.personFactDigest,reasonCode:proof.reasonCode,inputDigest:proof.inputDigest,proofDigest:proof.proofDigest}}));
}
function buildJavCorrectionInventoryChange({record,scope,raw,activeCases=[],controlProjections,verified,plan,manifest,publication,verification,cast,committedAtMs}) {
  assertJavCorrectionVerifiedSource(record,scope,verified);
  const basis=buildJavCorrectionBasis({raw:{...raw,correctionGate:null},activeCases,controlProjections}),q=verified.qualification,
    proposal=buildJavCorrectionProposal({basis:record.proof.basis,...q}),metadata=buildJavCorrectionMetadata({correctionId:record.correctionId,
      admissionDigest:record.admissionDigest,basis:record.proof.basis,proposal}),expectedCast=buildJavCorrectionCast({correctionId:record.correctionId,
      admissionDigest:record.admissionDigest,basis:record.proof.basis,proposal,resolutions:castResolutions(cast)}),
    {planDigest,...planBody}=plan,{manifestDigest,...manifestBody}=manifest;
  if(basis.basisDigest!==record.proof.basis.basisDigest||canonicalJson(expectedCast)!==canonicalJson(cast)||
      !Number.isSafeInteger(committedAtMs)||committedAtMs<0||planDigest!==canonicalDigest(planBody)||plan.scopeDigest!==scope.digest||
      plan.correctionId!==record.correctionId||plan.shelfEntryId!==record.shelfEntryId||plan.admissionDigest!==record.admissionDigest||
      plan.verifiedSourcePayloadDigest!==verified.payloadDigest||manifest.sourceProductManifestDigest!==planDigest||manifestDigest!==canonicalDigest(manifestBody)||
      manifest.membersDigest!==canonicalDigest({schema:'arca.staged-inventory-members@1',items:manifest.stagedMembers})||
      manifest.memberCount!==plan.members.length||manifest.stagedMembers.length!==plan.members.length||raw.materials.length!==plan.members.length||
      publication.scopeType!=='jav_identity_correction'||publication.scopeId!==record.correctionId||publication.scopeDigest!==planDigest||
      publication.targetCommitSlotId!==manifest.targetCommitSlotId||verification.result!=='passed'||verification.verificationKind!=='final_product'||
      verification.basisDigest!==scope.digest||verification.productManifestDigest!==planDigest||verification.relatedDispositionSetDigest!==basis.relatedSetDigest||
      verification.finalBindingSetDigest!==publication.finalBindingSetDigest||verification.memberEvidence.length!==plan.members.length)
    fail('Correction Inventory requires its complete current Basis, new source, cast and successful final verification.');
  const replacements=new Map(),materials=plan.members.map((member,index)=>{
    const original=raw.materials.find(row=>Number(row.ordinal)===index),staged=manifest.stagedMembers[index],evidence=verification.memberEvidence[index],
      identity=staged.physicalIdentity,replacement=['metadata_sidecar','poster','fanart'].includes(member.role),sourceKey=replacement?member.source.workspaceMaterialHandle.materialKey:original?.material_key,
      approved=record.proof.paths.find(item=>item.materialKey===original?.material_key);
    if(!original||member.ordinal!==index||!approved||approved.previousLocation!==original.location||approved.targetLocation!==member.targetLocation||approved.targetEndpointId!==member.targetEndpointId||
        canonicalDigest(member.original)!==canonicalDigest(basis.materials[index])||member.source.kind!==(replacement?'correction_artifact':'retained_inventory')||
        original.material_key!==member.original.physicalIdentity.materialKey||original.role!==member.role||staged.role!==member.role||
        staged.sourceMaterialKey!==sourceKey||staged.endpointId!==member.targetEndpointId||evidence.sourceProductMaterialKey!==sourceKey||evidence.role!==member.role||
        canonicalDigest(evidence.actualPhysicalIdentity)!==canonicalDigest(identity)||!verification.verifiedMaterialKeys.includes(identity.materialKey)||
        !/^[a-f0-9]{64}$/.test(staged.fullByteDigest||'')||replacement&&staged.fullByteDigest!==member.source.workspaceMaterialHandle.digestHex)
      fail('Final Inventory members must conserve all exact source, role, target and verified Physical identities.');
    replacements.set(original.material_key,identity.materialKey);
    const row={...original,inventory_revision:basis.inventoryRevision+1,ordinal:index,material_key:identity.materialKey,
      endpoint_id:staged.endpointId,location:member.targetLocation,binding_revision:Number(original.binding_revision)+1,
      mount_scope_id:identity.mountScopeId,inode:identity.inode,size_bytes:identity.sizeBytes,fingerprint_algorithm:identity.fingerprintAlgorithm,
      fingerprint_version:String(identity.fingerprintVersion),content_fingerprint:identity.contentFingerprint,digest_hex:staged.fullByteDigest,
      active_guard:original.role==='primary_payload'?1:0};
    physicalIdentityFromInventoryRow(row);return row;
  });
  const bindings=materials.map(row=>({materialKey:row.material_key,endpointId:row.endpoint_id,location:row.location,bindingRevision:Number(row.binding_revision)}));
  if(new Set(materials.map(row=>row.material_key)).size!==materials.length||canonicalDigest(bindings)!==verification.finalBindingSetDigest||
      canonicalDigest(materials.map(row=>row.material_key))!==canonicalDigest(verification.verifiedMaterialKeys))
    fail('Final Inventory bindings differ from the exact complete Verification.');
  const previousFacts=raw.facts.filter(row=>!['resolved_identity','product_metadata','media_cast'].includes(row.fact_kind)),
    facts=previousFacts.map(row=>{
      const {value:ignored,...stored}=row;
      if(row.fact_kind!=='related_primary_mapping')return stored;
      const previous=readInventoryMapping(row),value=inventoryMappingFact(previous,replacements.get(previous.relatedMaterialKey)||previous.relatedMaterialKey,
        replacements.get(previous.finalPrimaryMaterialKey)||previous.finalPrimaryMaterialKey);
      return {...stored,fact_json:canonicalJson(value),fact_digest:canonicalDigest(value)};
    });
  for(const [kind,schema,value] of [['resolved_identity','ArcaJavCorrectionIdentityFact',proposal.newIdentity],
    ['product_metadata','ArcaJavCorrectionMetadataRecord',metadataRecord(metadata,verified)],['media_cast','ArcaJavCorrectionCastRecord',castRecord(cast)]]) {
    facts.push({shelf_entry_id:basis.shelfEntryId,inventory_revision:basis.inventoryRevision+1,fact_kind:kind,
      fact_revision:Math.max(0,...raw.facts.filter(row=>row.fact_kind===kind).map(row=>Number(row.fact_revision)))+1,
      fact_schema_ref:'helix://contracts/application-types/'+schema+'/v1',fact_json:canonicalJson(value),
      episode_metadata_schema_ref:null,episode_metadata_json:null,fact_digest:canonicalDigest(value),source_package_id:basis.originalSourcePackageId,
      provenance_digest:verified.payloadDigest,committed_at_ms:committedAtMs});
  }
  const people=cast.relations.map(relation=>({relation_id:relation.relationId,shelf_entry_id:basis.shelfEntryId,inventory_revision:basis.inventoryRevision+1,
    person_id:relation.personId,display_name:relation.displayName,display_name_normalized:relation.displayNameNormalized,role:relation.role,relation_source:relation.source,
    provider_identity_schema_ref:relation.providerIdentities.length?'helix://contracts/types/ProviderIdentitySet/v1':null,
    provider_identity_json:relation.providerIdentities.length?canonicalJson(relation.providerIdentities):null,
    provider_identity_digest:relation.providerIdentities.length?canonicalDigest(relation.providerIdentities):null,origin_evidence_digest:relation.originEvidenceDigest,
    confidence_class:relation.confidenceClass,relation_digest:canonicalDigest(relation)})),
    representationDigest=canonicalDigest({schema:'arca.inventory-representation@1',shelfEntryId:basis.shelfEntryId,inventoryRevision:basis.inventoryRevision+1,
      sourcePackageId:basis.originalSourcePackageId,members:materials.map(representationMember),
      ...(facts.some(row=>row.fact_kind==='related_primary_mapping')?{relatedPrimaryMappingDigests:facts.filter(row=>row.fact_kind==='related_primary_mapping').map(row=>row.fact_digest)}:{})}),
    body={schema:'arca.jav-correction-inventory-change@1',correctionId:record.correctionId,shelfEntryId:basis.shelfEntryId,admissionDigest:record.admissionDigest,
      basisDigest:basis.basisDigest,scopeDigest:scope.digest,filePlanDigest:planDigest,verificationDigest:canonicalDigest(verification),
      originalCommitDigest:basis.originalCommitDigest,previousCanonicalIdentityRevision:basis.canonicalIdentityRevision,newCanonicalIdentityRevision:basis.canonicalIdentityRevision+1,
      previousInventoryRevision:basis.inventoryRevision,newInventoryRevision:basis.inventoryRevision+1,newIdentity:proposal.newIdentity,
      newCanonicalIdentityKey:proposal.newCanonicalIdentityKey,representationDigest,materials,related:raw.related.map(row=>({...row})),facts,people,committedAtMs};
  if(Buffer.byteLength(canonicalJson(body))>8*1024*1024)fail('Complete Correction Inventory change exceeds its bounded Entry scope.');
  return Object.freeze({...body,changeDigest:canonicalDigest(body)});
}
function buildJavCorrectionControlChanges(change,basis,projections) {
  const {changeDigest,...body}=change,byKey=new Map(projections.map(item=>[item.materialKey,item])),
    oldKeys=new Set(basis.materials.map(item=>item.physicalIdentity.materialKey)),newKeys=new Set(change.materials.map(row=>row.material_key)),
    scope={ownerDomain:'arca',scopeType:'shelf_entry',scopeId:basis.shelfEntryId},changes=[];
  if(changeDigest!==canonicalDigest(body)||change.basisDigest!==basis.basisDigest||change.shelfEntryId!==basis.shelfEntryId||
      basis.materials.length!==change.materials.length||newKeys.size!==change.materials.length||byKey.size!==projections.length||
      projections.length!==new Set([...oldKeys,...newKeys]).size||projections.some(item=>!oldKeys.has(item.materialKey)&&!newKeys.has(item.materialKey)))
    fail('Correction Control must cover only the complete frozen old and verified new Inventory sets.');
  for(const original of basis.materials) {
    const identity=original.physicalIdentity,projection=byKey.get(identity.materialKey);
    if(projection?.resultKind!=='available'||projection.controlState!=='controlled'||projection.ownerDomain!=='arca'||
        projection.ownerScopeType!=='shelf_entry'||projection.ownerScopeId!==basis.shelfEntryId||
        projection.controlRevision!==original.controlRevision||projection.projectionDigest!==original.controlProjectionDigest)
      fail('Original Control no longer belongs to the exact admitted Entry and revision.');
    changes.push({identity,action:newKeys.has(identity.materialKey)?'assert_same_field':'release',fromScope:scope,
      expectedRevision:projection.controlRevision,expectedProjectionDigest:projection.projectionDigest});
  }
  for(const row of change.materials) {
    if(oldKeys.has(row.material_key))continue;
    const identity=physicalIdentityFromInventoryRow(row),projection=byKey.get(row.material_key);
    if(projection?.resultKind!=='available'||projection.controlState!=='uncontrolled'||!Number.isSafeInteger(projection.controlRevision)||projection.controlRevision<0||
        !/^[a-f0-9]{64}$/.test(projection.projectionDigest||''))fail('A new correction member is unavailable or already controlled.');
    changes.push({identity,action:'acquire',toScope:scope,expectedRevision:projection.controlRevision,expectedProjectionDigest:projection.projectionDigest});
  }
  return Object.freeze(changes.sort((a,b)=>a.identity.materialKey<b.identity.materialKey?-1:1));
}
module.exports=Object.freeze({representationMember,buildJavCorrectionInventoryChange,buildJavCorrectionControlChanges});
