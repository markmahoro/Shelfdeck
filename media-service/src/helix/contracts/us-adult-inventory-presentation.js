'use strict';
const { canonicalDigest, canonicalJson } = require('./canonical-json');
const { originalNameProvenance, buildUsAdultTitle } = require('./us-adult-presentation');
const SCHEMA = 'helix://contracts/domain-types/UsAdultInventoryPresentation/v1';
const FIELDS = 'actorName,actorRelationDigest,aftercareCaseId,canonicalIdentityDigest,inventoryRevision,originalName,personId,representationDigest,schemaRef,schemaVersion,shelfEntryId,snapshotDigest';

function assertUsAdultInventoryPresentation(value, scope) {
  const fail = () => { throw Object.assign(new TypeError('Inventory naming must bind the exact Arca Case, Entry and frozen original-name proof.'),
    { code: 'ARCA_US_ADULT_PRESENTATION_SCOPE_INVALID' }); };
  if (!value || Object.keys(value).sort().join(',') !== FIELDS || value.schemaRef !== SCHEMA || value.schemaVersion !== 1 ||
      !Number.isSafeInteger(value.inventoryRevision) || value.inventoryRevision < 1 ||
      ['shelfEntryId', 'aftercareCaseId', 'personId'].some(key => typeof value[key] !== 'string' || !value[key] || value[key].length > 256) ||
      ['actorRelationDigest', 'canonicalIdentityDigest', 'representationDigest', 'snapshotDigest'].some(key => !/^[a-f0-9]{64}$/.test(value[key])) ||
      value.shelfEntryId !== scope?.shelfEntryId || value.aftercareCaseId !== scope?.aftercareCaseId) fail();
  const { snapshotDigest, ...body } = value;
  if (snapshotDigest !== canonicalDigest(body) || Buffer.byteLength(canonicalJson(value)) > 16 * 1024) fail();
  const original = originalNameProvenance(value.originalName?.originalFileName);
  if (original.originalFileName.length > 1024) fail();
  if (scope.originalName && (scope.originalName.originalFileName !== original.originalFileName ||
      scope.originalName.provenanceDigest !== original.provenanceDigest)) fail();
  buildUsAdultTitle({ actorName: value.actorName, originalName: value.originalName });
  return value;
}

module.exports = Object.freeze({ SCHEMA, assertUsAdultInventoryPresentation });
