'use strict';
const { readInventoryMapping } = require('../../../contracts/related-primary-mappings');

function fail() { throw Object.assign(new Error('Committed thumbnail association cannot be reconstructed from its exact placement decision.'),
  { code: 'ARCA_COMMITTED_RELATED_MAPPING_INVALID' }); }

// The Commit representation includes the accepted product's keys. Inventory
// facts contain the placed physical keys instead. The immutable Arca placement
// decision is the exact bridge; neither current filenames nor another Owner's
// mutable state may be used to guess that association.
function committedRelatedMappings({ facts, materials, decision, sourcePackageId, packageDigest }) {
  const rows = facts.filter(row => row.fact_kind === 'related_primary_mapping' && row.source_package_id === sourcePackageId);
  if (!rows.length) return [];
  if (!decision || !Array.isArray(decision.members)) fail();
  function sourceKey(physicalKey, role) {
    const matches = materials.filter(row => row.material_key === physicalKey && row.role === role);
    if (matches.length !== 1) fail();
    const material = matches[0];
    const approved = decision.members.filter(member => member.targetEndpointId === material.endpoint_id &&
      member.targetLocation === material.location && member.role === role);
    if (approved.length !== 1 || !/^[a-f0-9]{64}$/.test(approved[0].sourceMaterialKey || '')) fail();
    return approved[0].sourceMaterialKey;
  }
  const mappings = rows.map(row => {
    if (row.provenance_digest !== packageDigest) fail();
    const mapping = readInventoryMapping(row);
    return { sourceRelatedReferenceId: mapping.sourceRelatedReferenceId,
      relatedMaterialKey: sourceKey(mapping.relatedMaterialKey, 'sidecar'),
      sourcePrimaryMaterialKey: mapping.sourcePrimaryMaterialKey,
      finalPrimaryMaterialKey: sourceKey(mapping.finalPrimaryMaterialKey, 'primary_payload'),
      namingKind: mapping.namingKind };
  }).sort((a, b) => Buffer.from(a.relatedMaterialKey).compare(Buffer.from(b.relatedMaterialKey)));
  if (new Set(mappings.map(row => row.relatedMaterialKey)).size !== mappings.length) fail();
  return mappings;
}

module.exports = Object.freeze({ committedRelatedMappings });
