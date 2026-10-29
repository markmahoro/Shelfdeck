'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { canonicalDigest: D, canonicalJson } = require('../../src/helix/contracts/canonical-json');
const { inventoryMappingFact, FACT_SCHEMA } = require('../../src/helix/contracts/related-primary-mappings');
const { committedRelatedMappings } = require('../../src/helix/domains/arca/model/committed-related-mappings');
function fixture() {
  const mapping = { sourceRelatedReferenceId: 'thumb-ref', relatedMaterialKey: D('product-thumb'),
    sourcePrimaryMaterialKey: D('original-video'), finalPrimaryMaterialKey: D('product-video'), namingKind: 'episode_thumb' };
  const value = inventoryMappingFact(mapping, D('placed-thumb'), D('placed-video'));
  const facts = [{ fact_kind: 'related_primary_mapping', fact_schema_ref: FACT_SCHEMA, fact_json: canonicalJson(value),
    fact_digest: D(value), source_package_id: 'package', provenance_digest: D('package') }];
  const materials = [{ material_key: D('placed-thumb'), role: 'sidecar', endpoint_id: 'disk', location: '/collection/one-thumb.jpg' },
    { material_key: D('placed-video'), role: 'primary_payload', endpoint_id: 'disk', location: '/collection/one.mp4' }];
  const decision = { members: materials.map((row, i) => ({ role: row.role, targetEndpointId: row.endpoint_id,
    targetLocation: row.location, sourceMaterialKey: i ? mapping.finalPrimaryMaterialKey : mapping.relatedMaterialKey })) };
  return { mapping, facts, materials, decision, sourcePackageId: 'package', packageDigest: D('package') };
}
test('historical representation recovers accepted keys from exact Arca placement evidence', () => {
  const f = fixture(); assert.deepEqual(committedRelatedMappings(f), [f.mapping]);
  f.facts.push({ ...f.facts[0], source_package_id: 'earlier-season-extension' });
  assert.deepEqual(committedRelatedMappings(f), [f.mapping]);
});
test('missing, ambiguous, foreign and altered placement evidence never get guessed', () => {
  for (const mutate of [f => f.decision.members.pop(), f => f.decision.members.push(f.decision.members[0]),
    f => f.facts[0].provenance_digest = D('foreign'), f => f.materials[0].location = '/elsewhere/thumb.jpg',
    f => f.materials[0].role = 'poster', f => f.facts.push(f.facts[0])]) {
    const f = fixture(); mutate(f); assert.throws(() => committedRelatedMappings(f), { code: 'ARCA_COMMITTED_RELATED_MAPPING_INVALID' });
  }
  const f = fixture(); f.facts[0].fact_digest = D('tampered');
  assert.throws(() => committedRelatedMappings(f));
});
