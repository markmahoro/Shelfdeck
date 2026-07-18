'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createCandidateDeliveryReader } = require('../../src/helix/domains/procurement/persistence/candidate-delivery-reader');

const manifest=JSON.parse(fs.readFileSync(path.resolve(__dirname,
  '../../src/helix/foundation/persistence/generated/clean-schema.manifest.json'),'utf8'));

test('Candidate Delivery reader is Procurement-owned and reads only the eight formal Owner tables', () => {
  const reader=createCandidateDeliveryReader({ schemaManifest:manifest, unitOfWork:{ execute(){ return { candidate_delivery_read:null }; } } });
  assert.deepEqual(reader.repositoryManifest,{ owner:'procurement',tableIds:[
    'proc_candidate_deliveries','proc_candidate_packages','proc_candidate_primary_material_episode_claims',
    'proc_candidate_primary_materials','proc_candidate_related_references','proc_candidate_season_continuity_claims',
    'proc_procurement_runs','proc_run_materials'
  ] });
  const source=fs.readFileSync(path.resolve(__dirname,
    '../../src/helix/domains/procurement/persistence/candidate-delivery-reader.js'),'utf8');
  assert.doesNotMatch(source,/tableId:'(fx_|libra_|arca_|people_|perception_)/);
  assert.doesNotMatch(source,/kind:'(insert|update|delete)'/);
});
