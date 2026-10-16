'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {createEventExecutionInputProvider}=require('../../src/helix/foundation/execution/event-execution-input-provider');
const {createAftercareProjections}=require('../../src/helix/domains/arca/planning/aftercare-projections');
const {P}=require('../../src/helix/domains/arca/planning/aftercare-planners');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
const schemaManifest=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../src/helix/foundation/persistence/generated/clean-schema.manifest.json')));

test('one preparation reuses Arca context but retry and another Event read new facts',()=>{
  let reads=0,revision=1,failed=false;
  const projections=createAftercareProjections({contextReader:{read(){reads++;if(failed)throw Error('corrupt facts');return {basis:{revision},inventoryRevision:{revision},standard:{revision}};}},
    evidenceReader:{resolveSource:x=>x},materialControlProjectionPort:{getMaterialControlProjections:()=>[]},controlScopeDigest:canonicalDigest});
  const provider=createEventExecutionInputProvider({schemaManifest,unitOfWork:{execute(){throw Error('Unexpected Foundation read');}},
    contractValidator:{validate:()=>{}},bindingProjectionRegistry:{resolve:ref=>projections.find(p=>p.projectionRef===ref).projection}});
  const snapshot={node:{input_binding_schema_ref:'fixture',input_bindings_json:JSON.stringify({schemaRef:'helix://foundation/types/EventInputBindingSet/v1',bindings:
    [P.basis,P.inventory,P.standard].map((projectionRef,i)=>({bindingKind:'projected_owner_facts',portName:'port'+i,ownerDomain:'arca',processType:'arca_shelf_entry',processId:'entry',projectionRef,parameters:{}}))})},
    event:{event_id:'event'},work:{work_id:'work',owner_domain:'arca',process_type:'arca_shelf_entry',process_id:'entry',basis_digest:'a'.repeat(64)},workAttempt:{attempt_id:'attempt'},plan:{plan_id:'plan'}};
  const first=provider.prepare({snapshot});assert.equal(reads,1);assert.deepEqual(first.namedInputs,{port0:{revision:1},port1:{revision:1},port2:{revision:1}});
  assert.ok(!JSON.stringify(first).includes('preparationScope'));
  revision=2;assert.equal(provider.prepare({snapshot}).namedInputs.port0.revision,2);assert.equal(reads,2);
  snapshot.event.event_id='another';revision=3;assert.equal(provider.prepare({snapshot}).namedInputs.port2.revision,3);assert.equal(reads,3);
  failed=true;assert.throws(()=>provider.prepare({snapshot}),/corrupt facts/);failed=false;
  revision=4;assert.equal(provider.prepare({snapshot}).namedInputs.port0.revision,4);assert.equal(reads,5);
});
