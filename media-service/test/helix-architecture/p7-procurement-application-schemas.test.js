'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const {buildProcurementApplicationSchemas,schemaDigest,typeId}=require('../../scripts/helix-architecture/procurement-application-schema-builder');
const root=path.resolve(__dirname,'../../src/helix/contracts');

test('materializes the non-Catalog Procurement application contracts reproducibly',()=>{
  const schemas=buildProcurementApplicationSchemas(); const registry=JSON.parse(fs.readFileSync(path.join(root,'procurement-application-type-registry.json'),'utf8'));
  assert.equal(registry.targetCount,11);
  for(const [name,schema] of Object.entries(schemas)) { const stored=JSON.parse(fs.readFileSync(path.join(root,'application-types',name,'v1','schema.json'),'utf8'));
    assert.deepEqual(stored,schema); const entry=registry.entries.find((item)=>item.id===name); assert.equal(entry.schemaId,typeId(name)); assert.equal(entry.digest.value,schemaDigest(schema)); }
});

test('Retry application schemas close create, consume evidence, and both terminal result variants',()=>{
  const schemas=buildProcurementApplicationSchemas();
  assert.equal(schemas.ProcurementRetryIntent.properties.members.minItems,1);
  assert.equal(schemas.ProcurementRetryIntent.properties.members.maxItems,1024);
  assert.equal(schemas.ProcurementRetryAdmissionHead.properties.terminalObservation.oneOf.length,2);
  assert.equal(schemas.ProcurementRetryConsumeMemberSnapshot.properties.consumeOutcome.enum.includes('stale'),true);
  assert.equal(schemas.ProcurementRetryIntentAvailableMessage.properties.messageKind.const,'procurement_retry_intent_available');
  assert.equal(schemas.ProcurementRetryAdmissionResult.allOf.length,1);
});

test('Run Basis schema requires complete heads and Selection while only retry correlation is optional',()=>{
  const schema=buildProcurementApplicationSchemas().ProcurementRunExecutionBasis;
  assert.equal(schema.properties.sourceRetryIntentId.type,'string'); assert.equal(schema.required.includes('sourceRetryIntentId'),false);
  assert.equal(schema.properties.selectedFieldMaterialSet.$ref,'helix://contracts/domain-types/SelectedFieldMaterialSet/v1');
  assert.equal(schema.properties.fieldStatus.const,'active');
});
