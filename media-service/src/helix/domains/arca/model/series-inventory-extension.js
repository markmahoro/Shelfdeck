'use strict';
const {canonicalJson}=require('../../../contracts/canonical-json');

function validateSeriesExtension({entry,materials,packageValue}) {
  if(!entry||entry.structure_kind!=='season'||entry.status!=='active')
    throw new Error('Series extension requires an active exact Season Entry.');
  const existingKeys=new Set(materials.filter(item=>item.role==='primary_payload')
    .flatMap(item=>JSON.parse(item.episode_claims_json).items.map(claim=>claim.episodeKey)));
  const incoming=packageValue.productMaterialManifest.members.filter(item=>item.role==='primary_payload');
  if(!incoming.length||incoming.some(item=>!item.episodeClaims?.length||item.episodeClaims.some(claim=>existingKeys.has(claim.episodeKey))))
    throw Object.assign(new Error('Series extension overlaps the committed Episode scope.'),{code:'ARCA_SERIES_EPISODE_OVERLAP'});
}

function isRetainedSeriesMaterial(previous,member) {
  if(!previous)return false;
  const row=previous.materials.find(item=>item.material_key===member.physicalIdentity.materialKey);
  if(!row)return false;
  if(row.role==='primary_payload'||row.role!==member.role||row.endpoint_id!==member.endpointId||row.location!==member.location||
      Number(row.size_bytes)!==member.physicalIdentity.sizeBytes||row.content_fingerprint!==member.physicalIdentity.contentFingerprint||
      canonicalJson(JSON.parse(row.episode_claims_json))!==canonicalJson(member.episodeClaims))
    throw new Error('Retained Series Material differs from the exact committed Inventory member.');
  return true;
}
function inventoryMemberFromRow(row) {
  return {ordinal:Number(row.ordinal),materialKey:row.material_key,role:row.role,episodeClaims:JSON.parse(row.episode_claims_json),
    endpointId:row.endpoint_id,location:row.location,bindingRevision:Number(row.binding_revision),digestHex:row.digest_hex,sizeBytes:Number(row.size_bytes),
    physicalIdentity:{schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v2',schemaVersion:2,materialKey:row.material_key,
      mountScopeId:row.mount_scope_id,inode:row.inode,sizeBytes:Number(row.size_bytes),fingerprintAlgorithm:row.fingerprint_algorithm,
      fingerprintVersion:Number(row.fingerprint_version),contentFingerprint:row.content_fingerprint}};
}
function extendInventory(previous,incoming) {
  if(!previous)return incoming;
  const members=previous.materials.map(inventoryMemberFromRow);
  for(const member of incoming) {
    if(isRetainedSeriesMaterial(previous,member))continue;
    if(members.some(item=>item.location===member.location))throw new Error('Series extension collides with an existing Inventory target.');
    members.push(member);
  }
  return Object.freeze(members.map((member,ordinal)=>Object.freeze({...member,ordinal})));
}
module.exports=Object.freeze({validateSeriesExtension,isRetainedSeriesMaterial,extendInventory});
