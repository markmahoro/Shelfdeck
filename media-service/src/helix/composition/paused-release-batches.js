'use strict';

const { createUnchangedPausedBatchProof } = require('../foundation/execution/unchanged-paused-batch-proof');
const archive = require('./catalog-transitions/published-terminal-contracts-20261018.json');
const archiveDigest = '02c61b170e4209eb07f6abb1172eece6e598ed06ab9ad9fa227a5fea32803a6c';
const scopes = Object.freeze([
  { ownerDomain: 'procurement', processType: 'material_field', workKind: 'field_observation',
    capabilityRefs: ['procurement.field.observation.page.commit@1'] },
  { ownerDomain: 'perception', processType: 'perception_acquisition', workKind: 'acquisition_page',
    capabilityRefs: ['perception.source.acquire@1', 'perception.record.normalize@1', 'perception.record.commit@1'] },
  { ownerDomain: 'arca', processType: 'arca_offdeck_automation', workKind: 'offdeck_duplicate_detection',
    capabilityRefs: ['arca.offdeck.duplicate.detect@1', 'arca.offdeck.duplicate_group.commit@1'] },
]);

function createPausedReleaseBatchProof(options) {
  return createUnchangedPausedBatchProof({ ...options, archive, archiveDigest, scopes });
}

module.exports = Object.freeze({ createPausedReleaseBatchProof });
