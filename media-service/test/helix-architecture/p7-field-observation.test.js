'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const { createCanonicalTransactionRegistry, createDomainCommitCoordinator, createDomainCommitRegistry } = require('../../src/helix/foundation/persistence/domain-commit-registry');
const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const { createFieldPageObserver } = require('../../src/helix/domains/procurement/capabilities/field-page-observer');
const { identityBasis, requestBasis } = require('../../src/helix/domains/procurement/model/field-observation-contracts');
const { createFieldObservationCommitRegistration, createFieldObservationStore, FACT_SCHEMA, RESULT_SCHEMA } = require('../../src/helix/domains/procurement/persistence/field-observation-store');
const { createMaterialFieldStore } = require('../../src/helix/domains/procurement/persistence/material-field-store');
const observationTransaction = require('../../src/helix/contracts/transaction-contracts/helix.transaction.field-observation-page-commit/v1/contract.json');

const generatedRoot = path.resolve(__dirname, '../../src/helix/foundation/persistence/generated');
const schemaDdl = fs.readFileSync(path.join(generatedRoot, 'clean-schema.sql'), 'utf8');
const schemaManifest = JSON.parse(fs.readFileSync(path.join(generatedRoot, 'clean-schema.manifest.json'), 'utf8'));
const NOW = 1_700_040_000_000;
const hash = (value) => canonicalDigest({ value });

function fieldRegistration() {
  const policyValue = { includedDirectories:[], excludedDirectories:[], allowedExtensions:['.mkv'], minimumSizeBytes:0, excludedMaterialKeys:[] };
  const accessBasis = { fieldId:'field-1', revision:1, endpointId:'endpoint-1', rootLocation:'/media/field-1',
    mountScopeId:'mount-1', mountScopeRevision:1, accessSchemaRef:'helix://fixtures/field-access/v1' };
  return { fieldId:'field-1', name:'Field One', policy:{ extractionPolicyId:'policy-1', revision:1,
    policySchemaRef:'helix://contracts/domain-types/ExtractionPolicy/v1', policy:policyValue,
    policyDigest:canonicalDigest({ extractionPolicyId:'policy-1', revision:1, ...policyValue }) },
    access:{ ...accessBasis, accessDigest:canonicalDigest(accessBasis) } };
}
function accessHandle(access) {
  return { schemaRef:'helix://contracts/types/FieldAccessHandle/v1', schemaVersion:1, handleId:'field-access-handle-1',
    fieldId:access.fieldId, accessRevision:access.revision, accessDigest:access.accessDigest, endpointId:access.endpointId,
    rootLocation:access.rootLocation, mountScopeId:access.mountScopeId, mountScopeRevision:access.mountScopeRevision,
    allowedOperations:['read','list','stat','hash'], containmentDigest:hash('containment'), expiresAtMs:NOW + 1_000_000 };
}
function pageRequest(workId, observationId, expectedRevision, pageOrdinal=0, cursorIn=null, pageBudget=100) {
  const value = { schemaRef:'helix://contracts/types/FieldObservationPageRequest/v1', schemaVersion:1,
    fieldObservationWorkId:workId, observationId, pageOrdinal, expectedObservationRevision:expectedRevision,
    cursorIn, pageBudget, requestDigest:'' };
  value.requestDigest = canonicalDigest(requestBasis(value)); return value;
}
function raw(name, overrides={}) { return { inode:overrides.inode || String(name.charCodeAt(0)), contentHash:overrides.contentHash || hash('content-'+name),
  location:overrides.location || '/media/field-1/'+name+'.mkv', sizeBytes:overrides.sizeBytes || 100,
  mtimeNs:overrides.mtimeNs || '9223372036854775807', ctimeNs:overrides.ctimeNs || '9223372036854775806',
  hashVerifiedAtMs:NOW-10 }; }
function sortedEntries(materials) {
  return materials.map((material) => { const identity = { mountScopeId:'mount-1', inode:String(material.inode), contentHashAlgorithm:'sha256', contentHash:material.contentHash };
    return { material, key:canonicalDigest(identityBasis(identity)) }; }).sort((a,b) => Buffer.compare(Buffer.from(a.key),Buffer.from(b.key)))
    .map((entry,index) => ({ cursor:'cursor-'+index+'-'+entry.key, material:entry.material }));
}
function seedRuntime(databasePath, workId, eventId) {
  const db = new Database(databasePath);
  db.prepare('INSERT INTO fx_supporting_works(work_id,owner_domain,process_type,process_id,work_kind,basis_digest,priority_class,state,idempotency_key,created_at_ms,updated_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(workId,'procurement','material-field','field-1','field-observation',hash(workId),'normal','running','key-'+workId,1,1);
  db.prepare('INSERT INTO fx_work_attempts(attempt_id,work_id,ordinal,basis_digest,state,started_at_ms) VALUES(?,?,?,?,?,?)').run('attempt-'+workId,workId,1,hash(workId),'running',1);
  db.prepare('INSERT INTO fx_workflow_plans(plan_id,attempt_id,planner_ref,planner_version,catalog_digest,basis_digest,graph_digest,state,created_at_ms) VALUES(?,?,?,?,?,?,?,?,?)')
    .run('plan-'+workId,'attempt-'+workId,'procurement-field@1',1,hash('catalog'),hash(workId),hash('graph-'+workId),'planned',1);
  db.prepare('INSERT INTO fx_workflow_events(event_id,plan_id,node_id,work_id,attempt_id,owner_domain,capability_ref,contract_version,state,priority_class,ready_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(eventId,'plan-'+workId,'node-'+eventId,workId,'attempt-'+workId,'procurement','procurement.field.observation.commit@1',1,'executing','normal',1);
  db.close();
}
function seedAdditionalEvent(databasePath, workId, eventId) {
  const db=new Database(databasePath); db.prepare('INSERT INTO fx_workflow_events(event_id,plan_id,node_id,work_id,attempt_id,owner_domain,capability_ref,contract_version,state,priority_class,ready_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(eventId,'plan-'+workId,'node-'+eventId,workId,'attempt-'+workId,'procurement','procurement.field.observation.commit@1',1,'executing','normal',1); db.close();
}
async function fixture(run) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-field-observation-')); const databasePath=path.join(root,'shelfdeck.db');
  let clock=NOW; const kernel=openSqliteKernel({ Database,databasePath,schemaDdl,schemaManifest,now:()=>clock++ });
  const unitOfWork=createSqliteUnitOfWork({ kernel }); const fieldStore=createMaterialFieldStore({ schemaManifest,unitOfWork });
  const field=fieldStore.registerMaterialField(fieldRegistration()); const observationStore=createFieldObservationStore({ schemaManifest });
  const registry=createDomainCommitRegistry({ registrations:[createFieldObservationCommitRegistration(observationStore)] });
  const transactionRegistry=createCanonicalTransactionRegistry({ contracts:[observationTransaction] });
  const coordinator=createDomainCommitCoordinator({ schemaManifest,registry,transactionRegistry,unitOfWork });
  try { return await run({ databasePath,field,fieldStore,coordinator,kernel }); }
  finally { kernel.close(); fs.rmSync(root,{recursive:true,force:true}); }
}
async function observe(field, request, materials, enumerationHasMore=false) {
  const entries=sortedEntries(materials); const observer=createFieldPageObserver({ now:()=>NOW,
    enumeratePage:async()=>({ items:entries,hasMore:enumerationHasMore }) });
  return observer.observe({ fieldAccessHandle:accessHandle(field.access),pageRequest:request });
}
function commitRequest(page,eventId) {
  const handle={ schemaRef:'helix://contracts/types/DomainFactCommitHandle/v1',schemaVersion:1,handleId:'handle-'+page.observationId,
    ownerDomain:'procurement',aggregateType:'material_field_observation',aggregateId:page.fieldId,factType:'FieldObservationPage',
    factSchemaRef:FACT_SCHEMA,resultSchemaRef:RESULT_SCHEMA,expectedRevision:page.expectedObservationRevision,
    payloadDigest:canonicalDigest(page),commitIdempotencyKey:'key-'+page.observationId,eventFenceDigest:hash('fence-'+page.observationId) };
  return { transactionId:'helix.transaction.field-observation-page-commit',supportingWorkId:page.fieldObservationWorkId,
    handle,payload:page,commitMarker:{commitMarker:'marker-'+page.observationId,effectId:null,commitDigest:hash('commit-'+page.observationId)},
    resultBinding:{resultId:'result-'+page.observationId,eventId,evidenceSchemaRef:page.schemaRef,evidence:page},outboxMessages:[] };
}

test('observes and atomically commits a durable bounded page with zero Outbox and lossless int64 persistence', async () => fixture(async ({databasePath,field,coordinator}) => {
  seedRuntime(databasePath,'work-1','event-1'); const page=await observe(field,pageRequest('work-1','observation-1',0),[raw('a'),raw('b')]);
  const request=commitRequest(page,'event-1'); const first=coordinator.execute(request); const replay=coordinator.execute(request);
  assert.equal(first.typedResult.revision,1); assert.equal(first.typedResult.acceptedMaterials.length,2); assert.equal(first.outboxResult,undefined);
  assert.deepEqual(replay.typedResult,first.typedResult); assert.deepEqual(replay.typedEvidence,page);
  const db=new Database(databasePath,{readonly:true}); db.defaultSafeIntegers(true);
  assert.equal(db.prepare('SELECT current_observation_revision value FROM proc_material_fields WHERE field_id=?').get('field-1').value,1n);
  assert.equal(db.prepare('SELECT mtime_ns value FROM proc_field_materials LIMIT 1').get().value,9223372036854775807n);
  assert.equal(db.prepare('SELECT COUNT(*) value FROM fx_outbox').get().value,0n);
  const binding=db.prepare('SELECT evidence_json,result_json FROM fx_event_result_bindings WHERE result_id=?').get('result-observation-1');
  assert.deepEqual(JSON.parse(binding.evidence_json),page); assert.deepEqual(JSON.parse(binding.result_json),first.typedResult); db.close();
}));

test('preserves binding revision on refresh, increments it on rebound, and resets eligibility only on reality change', async () => fixture(async ({databasePath,field,coordinator}) => {
  seedRuntime(databasePath,'work-1','event-1'); const firstPage=await observe(field,pageRequest('work-1','observation-1',0),[raw('a')]);
  coordinator.execute(commitRequest(firstPage,'event-1'));
  const db=new Database(databasePath); db.prepare("UPDATE proc_field_materials SET eligibility_state='eligible' WHERE field_id='field-1'").run(); db.close();
  seedRuntime(databasePath,'work-2','event-2'); const refreshed=await observe(field,pageRequest('work-2','observation-2',1),[raw('a')]);
  let result=coordinator.execute(commitRequest(refreshed,'event-2')).typedResult; assert.equal(result.acceptedMaterials[0].changeKind,'refreshed'); assert.equal(result.acceptedMaterials[0].bindingRevision,1);
  seedRuntime(databasePath,'work-3','event-3'); const moved=await observe(field,pageRequest('work-3','observation-3',2),[raw('a',{location:'/media/field-1/moved/a.mkv'})]);
  result=coordinator.execute(commitRequest(moved,'event-3')).typedResult; assert.equal(result.acceptedMaterials[0].changeKind,'rebound'); assert.equal(result.acceptedMaterials[0].bindingRevision,2);
  const inspect=new Database(databasePath,{readonly:true}); const row=inspect.prepare('SELECT eligibility_state,control_projection FROM proc_field_materials WHERE field_id=?').get('field-1');
  assert.equal(row.eligibility_state,'unknown'); assert.equal(row.control_projection,'unknown'); inspect.close();
}));

test('fails stale fences and paginates by byte/item budget without skipping the first excluded material', async () => fixture(async ({databasePath,field,coordinator}) => {
  const entries=Array.from({length:3},(_,index)=>raw(String.fromCharCode(97+index))); const page=await observe(field,pageRequest('work-1','observation-1',0,0,null,2),entries,true);
  assert.equal(page.materialObservations.length,2); assert.equal(page.hasMore,true); assert.match(page.cursorOut,/^cursor-1-/);
  seedRuntime(databasePath,'work-1','event-1'); const stale={...page,expectedObservationRevision:1}; stale.pageDigest=canonicalDigest(require('../../src/helix/domains/procurement/model/field-observation-contracts').pageDigestBasis(stale)); stale.payloadDigest=stale.pageDigest;
  assert.throws(()=>coordinator.execute(commitRequest(stale,'event-1')),(error)=>error.code==='P7_FIELD_OBSERVATION_FENCE_CONFLICT');
  const inspect=new Database(databasePath,{readonly:true}); assert.equal(inspect.prepare('SELECT COUNT(*) count FROM proc_field_observations').get().count,0); assert.equal(inspect.prepare('SELECT COUNT(*) count FROM fx_commit_markers').get().count,0); inspect.close();
}));

test('enforces same-work page continuity, exact access head, and the canonical zero-Outbox contract', async () => fixture(async ({databasePath,field,fieldStore,coordinator}) => {
  seedRuntime(databasePath,'work-1','event-1'); seedAdditionalEvent(databasePath,'work-1','event-2');
  const first=await observe(field,pageRequest('work-1','observation-1',0,0,null,1),[raw('a'),raw('b')],true);
  coordinator.execute(commitRequest(first,'event-1'));
  const second=await observe(field,pageRequest('work-1','observation-2',1,1,first.cursorOut,1),[raw('b')]);
  const forbidden={...commitRequest(second,'event-2'),outboxMessages:[{messageId:'forbidden'}]};
  assert.throws(()=>coordinator.execute(forbidden),(error)=>error.code==='P3_DOMAIN_COMMIT_OUTBOX_FORBIDDEN');
  const accessBasis={ fieldId:'field-1',revision:2,endpointId:'endpoint-2',rootLocation:'/media/field-1',mountScopeId:'mount-1',mountScopeRevision:2,accessSchemaRef:'helix://fixtures/field-access/v1' };
  fieldStore.reviseFieldAccess({fieldId:'field-1',expectedAccessRevision:1,access:{...accessBasis,accessDigest:canonicalDigest(accessBasis)}});
  assert.throws(()=>coordinator.execute(commitRequest(second,'event-2')),(error)=>error.code==='P7_FIELD_OBSERVATION_FENCE_CONFLICT');
  const inspect=new Database(databasePath,{readonly:true}); assert.equal(inspect.prepare('SELECT current_observation_revision value FROM proc_material_fields').get().value,1); assert.equal(inspect.prepare('SELECT COUNT(*) count FROM proc_field_observations').get().count,1); inspect.close();
}));
