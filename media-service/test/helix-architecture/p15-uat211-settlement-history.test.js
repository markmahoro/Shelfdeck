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

function seriesEvidence(mutate=()=>{}){
  const keys=[canonicalDigest('first'),canonicalDigest('second')].sort(),targets=keys.map((materialKey,index)=>
    ({materialKey,targetLocation:'/season/'+index+'.mkv',finalRealityDigest:canonicalDigest('observed'+index)}));
  const record={schemaRef:'arca://types/PostDeleteReality/v1',schemaVersion:1,recordKind:'post-delete-reality',entries:[
    {key:'absent',value:true},{key:'disposition',value:'settled_to_final'},{key:'final_verified',value:true},
    {key:'source_to_final_mapping_digest',value:canonicalDigest('mapping')},{key:'final_targets',value:targets},
    {key:'final_reality_digest',value:canonicalDigest({schema:'arca.settlement-final-targets@1',members:targets})}]};
  mutate(record);
  const body={schemaRef:'helix://contracts/types/SettlementDeletionEvidence/v1',schemaVersion:1,producerRef:capabilityRef,
    evidenceKind:'input_settlement',materialKey:'old',observedAtMs:10,postDeleteReality:{...record,recordDigest:canonicalDigest(record)}};
  return {...body,payloadDigest:canonicalDigest(body)};
}
test('Series completed source bindings retire only after complete target evidence and preserve current Inventory',()=>{
  const f=fixture(seriesEvidence());f.raw.oldBindings[0].role='offload:original_input';
  const filtered=excludeCompletedSettlementBindings(f.raw,f.reader);
  assert.deepEqual(filtered.oldBindings.map(row=>row.material_key),['unfinished']);assert.equal(filtered.materials,f.raw.materials);
  const paths=[];observeKnownOldBindings(filtered,location=>{paths.push(location);throw Object.assign(new Error('missing'),{code:'ENOENT'});});
  assert.deepEqual(paths,['/source/unfinished.mkv']);
});
test('Series history rejects truncated, reordered, duplicated or scalar-mixed target evidence even with fresh envelope digests',()=>{
  const changes=[record=>record.entries.find(row=>row.key==='final_targets').value.pop(),
    record=>record.entries.find(row=>row.key==='final_targets').value.reverse(),
    record=>{const rows=record.entries.find(row=>row.key==='final_targets').value;rows[1]=rows[0];},
    record=>record.entries.push({key:'final_material_key',value:canonicalDigest('first')}),
    record=>record.entries.find(row=>row.key==='final_reality_digest').value=canonicalDigest('stale'),
    record=>record.entries.find(row=>row.key==='final_targets').value[1].targetLocation='',
    record=>record.entries.push(record.entries[0])];
  for(const change of changes){const f=fixture(seriesEvidence(change));assert.equal(excludeCompletedSettlementBindings(f.raw,f.reader).oldBindings.length,2);}
  const f=fixture(seriesEvidence());f.raw.onDeckCommit.committed_at_ms=9;
  assert.equal(excludeCompletedSettlementBindings(f.raw,f.reader).oldBindings.length,2);
});
