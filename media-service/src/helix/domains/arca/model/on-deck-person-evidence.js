'use strict';
const {canonicalDigest}=require('../../../contracts/canonical-json');

function relationEvidenceDigest(value) {
  return canonicalDigest({
    schema: 'arca.ondeck-person-evidence@1',
    shelfEntryId: value.shelfEntryId,
    inventoryRevision: value.inventoryRevision,
    relationId: value.relationId,
    relationDigest: value.relationDigest,
    originEvidenceDigest: value.originEvidenceDigest || null,
    displayName: value.displayName || null,
    displayNameNormalized: value.displayNameNormalized || null,
    role: value.role || null,
    providerIdentities: value.providerIdentities,
  });
}

module.exports=Object.freeze({relationEvidenceDigest});
