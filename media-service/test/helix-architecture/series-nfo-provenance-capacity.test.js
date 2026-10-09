'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Ajv = require('ajv/dist/2020');
const { buildDomainInputSchemas } = require('../../scripts/helix-architecture/domain-input-schema-builder');
const { buildResultTypeSchemas } = require('../../scripts/helix-architecture/result-type-schema-builder');
const schemas = [
  ['promotion', buildDomainInputSchemas().LibraDeliverablePromotionDecision.properties.productionProvenance],
  ['handoff', buildResultTypeSchemas().OnDeckProductPackage.properties.productionProvenance]
];
for (const [name, schema] of schemas) {
  test(name + ' NFO provenance has exact Series and non-Series cardinality boundaries', () => {
    assert.equal(schema.properties.sourceNfoObservations.items.$ref, 'helix://contracts/types/MetadataObservation/v1');
    // Isolate cardinality from the independently validated Observation item graph.
    const boundary = { type:'object', properties:{
      sourceNfoObservations:{...schema.properties.sourceNfoObservations,items:{type:'object'}},
      acceptanceRequirementSnapshot:{type:'object'}
    }, allOf:schema.allOf };
    const validate = new Ajv({strict:false}).compile(boundary);
    for (const count of [0,16,17,77,1024,1025]) {
      for (const contentProfile of ['series','movie','jav','western_adult']) {
        assert.equal(validate({acceptanceRequirementSnapshot:{contentProfile},
          sourceNfoObservations:Array.from({length:count},()=>({}))}),
          count <= (contentProfile==='series'?1024:16), contentProfile+':'+count);
      }
    }
    assert.equal(validate({acceptanceRequirementSnapshot:{},sourceNfoObservations:Array(17).fill({})}),false);
  });
}
test('NFO provenance capacity is identical across promotion and Handoff B', () => {
  assert.deepEqual(schemas[0][1].allOf,schemas[1][1].allOf);
  assert.deepEqual(schemas[0][1].properties.sourceNfoObservations,schemas[1][1].properties.sourceNfoObservations);
});
