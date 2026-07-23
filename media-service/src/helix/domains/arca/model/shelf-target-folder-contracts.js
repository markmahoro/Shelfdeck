'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');

const EVIDENCE_SCHEMA_REF =
  'helix://contracts/implementation/ArcaShelfTargetReadinessEvidence/v1';

function targetDigest(shelfId, target) {
  return canonicalDigest({
    schema: 'arca.shelf-physical-target-folder@1',
    shelfId,
    endpointId: target.endpointId,
    rootLocation: target.rootLocation,
    mountScopeId: target.mountScopeId,
    mountScopeRevision: target.mountScopeRevision,
  });
}

module.exports = Object.freeze({
  EVIDENCE_SCHEMA_REF,
  targetDigest,
});
