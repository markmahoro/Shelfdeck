'use strict';
const {readInventoryArtifactScope}=require('./inventory-artifact-scope');
function representationMember(item, ordinal) {
  const artifactScope=readInventoryArtifactScope(item);
  return Object.freeze({
    ...(artifactScope?{artifactScope}:{}),
    ordinal,
    materialKey: item.material_key,
    role: item.role,
    episodeClaims: JSON.parse(item.episode_claims_json),
    endpointId: item.endpoint_id,
    location: item.location,
    bindingRevision: Number(item.binding_revision),
    physicalIdentity: Object.freeze({
      schemaRef: 'helix://contracts/types/PhysicalMaterialIdentity/v2',
      schemaVersion: 2,
      materialKey: item.material_key,
      mountScopeId: item.mount_scope_id,
      inode: item.inode,
      sizeBytes: Number(item.size_bytes),
      fingerprintAlgorithm: item.fingerprint_algorithm,
      fingerprintVersion: Number(item.fingerprint_version),
      contentFingerprint: item.content_fingerprint,
    }),
    digestHex: item.digest_hex,
    sizeBytes: Number(item.size_bytes),
  });
}
module.exports=Object.freeze({representationMember});
