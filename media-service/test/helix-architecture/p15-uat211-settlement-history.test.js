'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const { excludeCompletedSettlementBindings } = require('../../src/helix/domains/arca/model/completed-settlement-bindings');
const { observeKnownOldBindings } = require('../../src/helix/domains/arca/model/known-old-binding');
const capabilityRef = 'arca.ondeck.input_settlement.delete@1';

function evidence(overrides = {}) {
  const record = { schemaRef:'arca://types/PostDeleteReality/v1', schemaVersion:1,
    recordKind:'post-delete-reality', entries:Object.entries({ absent:true, disposition:'settled_to_final',
      final_verified:true, source_to_final_mapping_digest:'mapping', final_material_key:'final',
      final_target_location:'/shelf/movie.nfo', final_reality_digest:'reality', ...overrides })
      .map(([key, value]) => ({ key, value })) };
  const body = { schemaRef:'helix://contracts/types/SettlementDeletionEvidence/v1', schemaVersion:1,
    producerRef:capabilityRef, evidenceKind:'input_settlement', materialKey:'old', observedAtMs:10,
    postDeleteReality:{ ...record, recordDigest:canonicalDigest(record) } };
  return { ...body, payloadDigest:canonicalDigest(body) };
}
function fixture(result = evidence(), outcomeKind = 'succeeded') {
  const raw = { onDeckCommit:{ on_deck_run_id:'original-run', committed_at_ms:20 },
    materials:[{ material_key:'current', location:'/shelf/movie.nfo' }],
    oldBindings:[{ material_key:'old', role:'offload:exclusive_related', location:'/source/old.nfo' },
      { material_key:'unfinished', role:'offload:original_input', location:'/source/unfinished.mkv' }] };
  const reader = { listWorks(scope) {
    assert.deepEqual(scope, { ownerDomain:'arca', processType:'arca_ondeck_run', processId:'original-run', workKind:'on_deck_execution' });
    return [{ work_id:'original-work' }];
  }, read(id) { assert.equal(id, 'original-work'); return [{ capabilityRef, outcomeKind, result }]; } };
  return { raw, reader };
}

test('UAT-211 completed exact old material is never probed again; unfinished and current members remain', () => {
  const { raw, reader } = fixture();
  const filtered = excludeCompletedSettlementBindings(raw, reader);
  assert.deepEqual(filtered.oldBindings.map(item => item.material_key), ['unfinished']);
  assert.equal(filtered.materials, raw.materials);
  assert.equal(raw.oldBindings.length, 2);
  const locations = [];
  const observations = observeKnownOldBindings(filtered, location => {
    locations.push(location);
    throw Object.assign(new Error('missing'), { code:'ENOENT' });
  });
  assert.deepEqual(locations, ['/source/unfinished.mkv']);
  assert.equal(observations[0].kind, 'absent');
});

test('UAT-211 failed, incomplete, forged or different-material evidence never retires an obligation', () => {
  for (const [result, outcome] of [[evidence(), 'failed'], [evidence({ absent:false }), 'succeeded'],
    [evidence({ final_verified:false }), 'succeeded'], [evidence({ disposition:'retained_as_final' }), 'succeeded'],
    [{ ...evidence(), materialKey:'other' }, 'succeeded'], [{ ...evidence(), payloadDigest:'forged' }, 'succeeded'],
    [evidence({ final_target_location:null }), 'succeeded']]) {
    const { raw, reader } = fixture(result, outcome);
    assert.equal(excludeCompletedSettlementBindings(raw, reader).oldBindings.length, 2);
  }
});

test('UAT-211 current Inventory and non-offload Bindings are never removed by historical completion', () => {
  const { raw, reader } = fixture();
  raw.materials[0].material_key = 'old';
  raw.oldBindings[0].role = 'current_product';
  const filtered = excludeCompletedSettlementBindings(raw, reader);
  assert.equal(filtered.materials.length, 1);
  assert.equal(filtered.oldBindings.length, 2);
});
