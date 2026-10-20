'use strict';
const {canonicalDigest:D,canonicalJson}=require('../../../contracts/canonical-json');
const {physicalIdentityFromInventoryRow}=require('./aftercare-contract');
const {readInventoryMapping,inventoryMappingFact}=require('../../../contracts/related-primary-mappings');
function fail(message){throw Object.assign(new Error(message),{code:'ARCA_US_ADULT_INVENTORY_INVALID'});}
function buildInventoryChange({context,intent,selection,plan,facts,verification,committedAtMs}){
  const raw=context.raw,previous=intent.inventoryRevision,next=previous+1,{planDigest,...planBody}=plan,
    {finalRealityDigest,...verifiedBody}=verification;
  if(raw.entry.current_inventory_revision!==previous||raw.inventory.representation_digest!==intent.representationDigest||
      planDigest!==D(planBody)||plan.intentDigest!==intent.intentDigest||plan.selectionDigest!==selection.selectionDigest||
      verification.schema!=='arca.us-adult-final-files@1'||verification.planDigest!==planDigest||
      verification.aftercareCaseId!==selection.aftercareCaseId||finalRealityDigest!==D(verifiedBody)||
      raw.materials.length!==plan.members.length||verification.members.length!==plan.members.length||
      !Number.isSafeInteger(committedAtMs)||committedAtMs<0)fail('Inventory change requires its complete frozen Plan and verified original Entry.');
  const replacements=new Map(),materials=plan.members.map((member,index)=>{
    const row=raw.materials.find(item=>Number(item.ordinal)===index),actual=verification.members[index],identity=actual.physicalIdentity;
    if(!row||member.ordinal!==index||actual.ordinal!==index||row.role!==member.role||actual.role!==member.role||
        D(physicalIdentityFromInventoryRow(row))!==D(member.original.physicalIdentity)||row.location!==member.original.location||
        Number(row.binding_revision)!==member.original.bindingRevision||actual.previousMaterialKey!==row.material_key||
        actual.endpointId!==member.targetEndpointId||actual.targetLocation!==member.targetLocation||actual.location!==member.targetLocation||
        actual.bindingRevision!==Number(row.binding_revision)+1||!/^[a-f0-9]{64}$/.test(actual.fullByteDigest)||
        member.source.kind==='actor_artifact'&&actual.fullByteDigest!==member.source.workspaceMaterialHandle.digestHex)
      fail('Verified Inventory must conserve every original member, target and prepared artifact.');
    replacements.set(row.material_key,identity.materialKey);
    return {...row,ordinal:index,active_guard:row.role==='primary_payload'?1:0,inventory_revision:next,material_key:identity.materialKey,location:actual.targetLocation,endpoint_id:actual.endpointId,
      binding_revision:actual.bindingRevision,mount_scope_id:identity.mountScopeId,inode:identity.inode,size_bytes:identity.sizeBytes,
      fingerprint_algorithm:identity.fingerprintAlgorithm,fingerprint_version:String(identity.fingerprintVersion),
      content_fingerprint:identity.contentFingerprint,digest_hex:actual.fullByteDigest};
  });
  if(new Set(materials.map(row=>row.material_key)).size!==materials.length)fail('Distinct Inventory members cannot collapse into one Physical identity.');
  const updatedFacts=raw.facts.map(row=>{
    const {value:ignored,...stored}=row;
    if(['product_metadata','media_cast'].includes(row.fact_kind)){
      const fact=facts[row.fact_kind==='media_cast'?'cast':'metadata'],{factDigest,...body}=fact;
      if(factDigest!==D(body)||fact.sourceFactDigest!==row.fact_digest||fact.selectionDigest!==selection.selectionDigest||
          fact.intentDigest!==intent.intentDigest||fact.canonicalIdentityDigest!==intent.canonicalIdentityDigest)
        fail('Actor Facts do not extend their exact original Inventory facts.');
      return {...stored,inventory_revision:next,fact_revision:Number(row.fact_revision)+1,fact_schema_ref:fact.schemaRef,
        fact_json:canonicalJson(fact),fact_digest:D(fact),provenance_digest:selection.selectionDigest,committed_at_ms:committedAtMs};
    }
    if(row.fact_kind!=='related_primary_mapping')return stored;
    const old=readInventoryMapping(row),fact=inventoryMappingFact(old,replacements.get(old.relatedMaterialKey)||old.relatedMaterialKey,
      replacements.get(old.finalPrimaryMaterialKey)||old.finalPrimaryMaterialKey);
    return {...stored,fact_json:canonicalJson(fact),fact_digest:D(fact)};
  }),people=facts.cast.relations.map(relation=>({relation_id:relation.relationId,person_id:relation.personId,display_name:relation.displayName,
    display_name_normalized:relation.displayNameNormalized,role:relation.role,relation_source:relation.source,provider_identity_schema_ref:null,
    provider_identity_json:null,provider_identity_digest:null,origin_evidence_digest:relation.originEvidenceDigest,
    confidence_class:relation.confidenceClass,relation_digest:D(relation)}));
  if(people.length!==1||people[0].person_id!==selection.personSnapshot.personId)fail('US Adult Inventory must have its one frozen selected actor.');
  const related=raw.related.map(row=>{
    const moved=plan.members.find(member=>member.original.location===row.location&&row.endpoint_id===raw.materials[member.ordinal].endpoint_id);
    return {...row,primary_ordinal:Number(row.primary_ordinal),...(moved?{location:moved.targetLocation,endpoint_id:moved.targetEndpointId}:{})};
  }),body={aftercareCaseId:selection.aftercareCaseId,shelfEntryId:intent.shelfEntryId,previousInventoryRevision:previous,
    materials,related,facts:updatedFacts,people,committedAtMs};
  return {...body,representationDigest:D({schema:'arca.us-adult-inventory-representation@1',intentDigest:intent.intentDigest,
    selectionDigest:selection.selectionDigest,planDigest,finalRealityDigest,inventoryRevision:next,materials,related,
    factDigests:updatedFacts.map(row=>row.fact_digest),people})};
}
function buildControlChanges({context,change,projections}){
  const old=new Map(context.raw.materials.map(row=>[row.material_key,row])),fresh=new Map(change.materials.map(row=>[row.material_key,row])),
    keys=[...new Set([...old.keys(),...fresh.keys()])].sort(),byKey=new Map(projections.map(item=>[item.materialKey,item])),
    scope={ownerDomain:'arca',scopeType:'shelf_entry',scopeId:context.shelfEntryId};
  if(keys.length!==projections.length||byKey.size!==keys.length)fail('Control projections must cover the complete old and new Inventory.');
  return keys.map(key=>{
    const projection=byKey.get(key),row=old.get(key)||fresh.get(key);
    if(projection?.resultKind!=='available'||!Number.isSafeInteger(projection.controlRevision)||
        (old.has(key)?projection.controlState!=='controlled'||projection.ownerDomain!=='arca'||projection.ownerScopeType!=='shelf_entry'||projection.ownerScopeId!==context.shelfEntryId:
        projection.controlState!=='uncontrolled'))fail('Actor Inventory no longer has the exact old Control and available new identities.');
    return {identity:physicalIdentityFromInventoryRow(row),action:old.has(key)?fresh.has(key)?'assert_same_field':'release':'acquire',
      ...(old.has(key)?{fromScope:scope}:{toScope:scope}),expectedRevision:projection.controlRevision,expectedProjectionDigest:projection.projectionDigest};
  });
}
module.exports=Object.freeze({buildInventoryChange,buildControlChanges});
