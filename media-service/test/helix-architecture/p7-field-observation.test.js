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
const { createMaterialControlProjectionPort } = require('../../src/helix/foundation/persistence/material-control');
const { createFieldPageObserver } = require('../../src/helix/domains/procurement/capabilities/field-page-observer');
const { identityBasis, requestBasis } = require('../../src/helix/domains/procurement/model/field-observation-contracts');
const { evaluateExtractionEligibility } = require('../../src/helix/domains/procurement/model/extraction-eligibility');
const { createEligibilityReconcileStore } = require('../../src/helix/domains/procurement/persistence/eligibility-reconcile-store');
const { createFieldObservationCommitRegistration, createFieldObservationStore, FACT_SCHEMA, RESULT_SCHEMA } = require('../../src/helix/domains/procurement/persistence/field-observation-store');
const { createMaterialFieldStore } = require('../../src/helix/domains/procurement/persistence/material-field-store');
const observationTransaction = require('../../src/helix/contracts/transaction-contracts/helix.transaction.field-observation-page-commit/v1/contract.json');

const generatedRoot = path.resolve(__dirname, '../../src/helix/foundation/persistence/generated');
const schemaDdl = fs.readFileSync(path.join(generatedRoot, 'clean-schema.sql'), 'utf8');
const schemaManifest = JSON.parse(fs.readFileSync(path.join(generatedRoot, 'clean-schema.manifest.json'), 'utf8'));
const NOW = 1_700_040_000_000;
const hash = (value) => canonicalDigest({ value });
const profileHintSnapshot = Object.freeze({
  fieldId:'field-1',
  revision:1,
  contentProfileHint:'mixed',
  hintDigest:canonicalDigest({
    schema:'procurement.material-field-profile-hint@1',
    fieldId:'field-1',
    revision:1,
    contentProfileHint:'mixed',
  }),
});

function fieldRegistration() {
  const policyValue = { includedDirectories:[], excludedDirectories:[], allowedExtensions:['.mkv'], minimumSizeBytes:0, excludedMaterialKeys:[] };
  const accessBasis = { fieldId:'field-1', revision:1, endpointId:'endpoint-1', rootLocation:'/media/field-1',
    mountScopeId:'mount-1', mountScopeRevision:1, accessSchemaRef:'helix://fixtures/field-access/v1' };
  return { fieldId:'field-1', name:'Field One', contentProfileHint:'mixed', policy:{ extractionPolicyId:'policy-1', revision:1,
    policySchemaRef:'helix://contracts/domain-types/ExtractionPolicy/v1', policy:policyValue,
    policyDigest:canonicalDigest({ extractionPolicyId:'policy-1', revision:1, ...policyValue }) },
    access:{ ...accessBasis, accessDigest:canonicalDigest(accessBasis) } };
}
function accessHandle(access) {
  return { schemaRef:'helix://contracts/types/FieldAccessHandle/v1', schemaVersion:1, handleId:'field-access-handle-1',
    fieldId:access.fieldId, accessRevision:access.revision, accessDigest:access.accessDigest, endpointId:access.endpointId,
    rootLocation:access.rootLocation, mountScopeId:access.mountScopeId, mountScopeRevision:access.mountScopeRevision,
    allowedOperations:['read','list','stat','fingerprint'], containmentDigest:hash('containment'), expiresAtMs:NOW + 1_000_000 };
}
function pageRequest(workId, observationId, expectedRevision, pageOrdinal=0, cursorIn=null, pageBudget=100) {
  const value = { schemaRef:'helix://contracts/types/FieldObservationPageRequest/v1', schemaVersion:1,
    fieldObservationWorkId:workId, observationId, pageOrdinal, expectedObservationRevision:expectedRevision,
    profileHintSnapshot, cursorIn, pageBudget, requestDigest:'' };
  value.requestDigest = canonicalDigest(requestBasis(value)); return value;
}
function raw(name, overrides={}) { return { inode:overrides.inode || String(name.charCodeAt(0)),
  fingerprintAlgorithm:'middle-256k-sha256', fingerprintVersion:1,
  contentFingerprint:overrides.contentFingerprint || hash('content-'+name),
  location:overrides.location || '/media/field-1/'+name+'.mkv', sizeBytes:overrides.sizeBytes || 100,
  mtimeNs:overrides.mtimeNs || '9223372036854775807', ctimeNs:overrides.ctimeNs || '9223372036854775806',
  fingerprintVerifiedAtMs:NOW-10 }; }
function sortedEntries(materials) {
  return materials.map((material) => { const identity = { mountScopeId:'mount-1', inode:String(material.inode), sizeBytes:material.sizeBytes,
    fingerprintAlgorithm:'middle-256k-sha256', fingerprintVersion:1, contentFingerprint:material.contentFingerprint };
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
    .run(eventId,'plan-'+workId,'node-'+eventId,workId,'attempt-'+workId,'procurement','procurement.field.observation.page.commit@1',1,'executing','normal',1);
  db.close();
}
function seedAdditionalEvent(databasePath, workId, eventId) {
  const db=new Database(databasePath); db.prepare('INSERT INTO fx_workflow_events(event_id,plan_id,node_id,work_id,attempt_id,owner_domain,capability_ref,contract_version,state,priority_class,ready_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(eventId,'plan-'+workId,'node-'+eventId,workId,'attempt-'+workId,'procurement','procurement.field.observation.page.commit@1',1,'executing','normal',1); db.close();
}
async function fixture(run) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-field-observation-')); const databasePath=path.join(root,'shelfdeck.db');
  let clock=NOW; const kernel=openSqliteKernel({ Database,databasePath,schemaDdl,schemaManifest,now:()=>clock++ });
  const unitOfWork=createSqliteUnitOfWork({ kernel }); const fieldStore=createMaterialFieldStore({ schemaManifest,unitOfWork });
  const field=fieldStore.registerMaterialField(fieldRegistration()); const observationStore=createFieldObservationStore({ schemaManifest });
  const registry=createDomainCommitRegistry({ registrations:[createFieldObservationCommitRegistration(observationStore)] });
  const transactionRegistry=createCanonicalTransactionRegistry({ contracts:[observationTransaction] });
  const coordinator=createDomainCommitCoordinator({ schemaManifest,registry,transactionRegistry,unitOfWork });
  try { return await run({ databasePath,field,fieldStore,coordinator,kernel,unitOfWork }); }
  finally { kernel.close(); fs.rmSync(root,{recursive:true,force:true}); }
}
async function observe(field, request, materials, enumerationHasMore=false) {
  const entries=sortedEntries(materials); const observer=createFieldPageObserver({ now:()=>NOW,
    enumeratePage:async()=>({ items:entries,hasMore:enumerationHasMore }) });
  const draft=await observer.observe({ fieldAccessHandle:accessHandle(field.access),pageRequest:request });
  return Object.freeze({ ...draft.page, entries:Object.freeze(draft.entries) });
}
function commitRequest(page,eventId) {
  const compact={...page}; delete compact.entries;
  const handle={ schemaRef:'helix://contracts/types/DomainFactCommitHandle/v1',schemaVersion:1,handleId:'handle-'+page.observationId,
    ownerDomain:'procurement',aggregateType:'material_field_observation',aggregateId:page.fieldId,factType:'ObservationPageCommit',
    factSchemaRef:FACT_SCHEMA,resultSchemaRef:RESULT_SCHEMA,expectedRevision:page.expectedObservationRevision,
    payloadDigest:canonicalDigest(page),commitIdempotencyKey:'key-'+page.observationId,eventFenceDigest:hash('fence-'+page.observationId) };
  return { transactionId:'helix.transaction.field-observation-page-commit',supportingWorkId:page.fieldObservationWorkId,
    handle,payload:page,commitMarker:{commitMarker:'marker-'+page.observationId,effectId:null,commitDigest:hash('commit-'+page.observationId)},
    resultBinding:{resultId:'result-'+page.observationId,eventId,evidenceSchemaRef:compact.schemaRef,evidence:compact},outboxMessages:[] };
}

test('observes and atomically commits a durable bounded page with zero Outbox and lossless int64 persistence', async () => fixture(async ({databasePath,field,coordinator}) => {
  seedRuntime(databasePath,'work-1','event-1'); const page=await observe(field,pageRequest('work-1','observation-1',0),[raw('a'),raw('b')]);
  const request=commitRequest(page,'event-1'); const first=coordinator.execute(request); const replay=coordinator.execute(request);
  assert.equal(first.typedResult.revision,1); assert.equal(first.typedResult.entryCount,2); assert.equal(first.outboxResult,undefined);
  assert.deepEqual(replay.typedResult,first.typedResult); assert.equal(replay.typedEvidence.entryCount,2); assert.equal(Object.hasOwn(replay.typedEvidence,'entries'),false);
  const db=new Database(databasePath,{readonly:true}); db.defaultSafeIntegers(true);
  assert.equal(db.prepare('SELECT current_observation_revision value FROM proc_material_fields WHERE field_id=?').get('field-1').value,1n);
  assert.equal(db.prepare('SELECT mtime_ns value FROM proc_field_materials LIMIT 1').get().value,9223372036854775807n);
  assert.equal(db.prepare('SELECT COUNT(*) value FROM fx_outbox').get().value,0n);
  const binding=db.prepare('SELECT evidence_json,result_json FROM fx_event_result_bindings WHERE result_id=?').get('result-observation-1');
  const storedEvidence=JSON.parse(binding.evidence_json); assert.equal(storedEvidence.entryCount,2); assert.equal(Object.hasOwn(storedEvidence,'entries'),false);
  assert.deepEqual(JSON.parse(binding.result_json),first.typedResult); assert.equal(db.prepare('SELECT COUNT(*) count FROM proc_field_observation_entries').get().count,2n); db.close();
}));

test('preserves binding revision on refresh, increments it on rebound, and resets eligibility only on reality change', async () => fixture(async ({databasePath,field,coordinator}) => {
  seedRuntime(databasePath,'work-1','event-1'); const firstPage=await observe(field,pageRequest('work-1','observation-1',0),[raw('a')]);
  coordinator.execute(commitRequest(firstPage,'event-1'));
  const db=new Database(databasePath); db.prepare("UPDATE proc_field_materials SET eligibility_state='eligible' WHERE field_id='field-1'").run(); db.close();
  seedRuntime(databasePath,'work-2','event-2'); const refreshed=await observe(field,pageRequest('work-2','observation-2',1),[raw('a')]);
  let result=coordinator.execute(commitRequest(refreshed,'event-2')).typedResult; assert.equal(result.entryCount,1);
  seedRuntime(databasePath,'work-3','event-3'); const moved=await observe(field,pageRequest('work-3','observation-3',2),[raw('a',{location:'/media/field-1/moved/a.mkv'})]);
  result=coordinator.execute(commitRequest(moved,'event-3')).typedResult; assert.equal(result.entryCount,1);
  const inspect=new Database(databasePath,{readonly:true}); const row=inspect.prepare('SELECT eligibility_state,control_projection FROM proc_field_materials WHERE field_id=?').get('field-1');
  assert.equal(row.eligibility_state,'unknown'); assert.equal(row.control_projection,'unknown'); inspect.close();
}));

test('fails stale fences and paginates by byte/item budget without skipping the first excluded material', async () => fixture(async ({databasePath,field,coordinator}) => {
  const entries=Array.from({length:3},(_,index)=>raw(String.fromCharCode(97+index))); const page=await observe(field,pageRequest('work-1','observation-1',0,0,null,2),entries,true);
  assert.equal(page.entries.length,2); assert.equal(page.hasMore,true); assert.match(page.cursorOut,/^cursor-1-/);
  seedRuntime(databasePath,'work-1','event-1'); const stale={...page,expectedObservationRevision:1}; stale.pageDigest=canonicalDigest(require('../../src/helix/domains/procurement/model/field-observation-contracts').pageDigestBasis(stale)); stale.payloadDigest=stale.pageDigest;
  assert.throws(()=>coordinator.execute(commitRequest(stale,'event-1')),(error)=>error.code==='P7_FIELD_OBSERVATION_FENCE_CONFLICT');
  const inspect=new Database(databasePath,{readonly:true}); assert.equal(inspect.prepare('SELECT COUNT(*) count FROM proc_field_observations').get().count,0); assert.equal(inspect.prepare('SELECT COUNT(*) count FROM fx_commit_markers').get().count,0); inspect.close();
}));

test('keeps the Page receipt compact while detail rows remain relationized', async () => fixture(async ({field}) => {
  const materials=Array.from({length:40},(_,index)=>raw(String.fromCharCode(65+(index%26)),{
    inode:String(1000+index),
    location:'/media/field-1/'+String(index).padStart(3,'0')+'-'+('x'.repeat(1800))+'.mkv',
  }));
  const entries=sortedEntries(materials).map((entry)=>({...entry,cursor:'path:shared-batch-boundary'}));
  const observer=createFieldPageObserver({now:()=>NOW,enumeratePage:async()=>({items:entries,hasMore:true})});
  const draft=await observer.observe({fieldAccessHandle:accessHandle(field.access),pageRequest:pageRequest('work-1','observation-1',0)});
  assert.equal(draft.page.entryCount,40);
  assert.equal(Object.hasOwn(draft.page,'materialObservations'),false);
  assert.ok(Buffer.byteLength(JSON.stringify(draft.page),'utf8')<16*1024);
}));

test('rejects an Observation page when the Field Profile Hint changes after the physical read', async () => fixture(async ({databasePath,field,fieldStore,coordinator}) => {
  const page=await observe(field,pageRequest('work-1','observation-1',0),[raw('a')]);
  seedRuntime(databasePath,'work-1','event-1');
  const revisionCommand={
    schema:'procurement.material-field-profile-hint-revision-command@1',
    operation:'revise_profile_hint',
    fieldId:'field-1',
    expectedProfileHintRevision:1,
    newContentProfileHint:'western_adult',
  };
  fieldStore.reviseFieldProfileHint({
    fieldId:'field-1',
    expectedProfileHintRevision:1,
    newContentProfileHint:'western_adult',
    requestDigest:canonicalDigest(revisionCommand),
  });
  assert.throws(
    ()=>coordinator.execute(commitRequest(page,'event-1')),
    (error)=>error.code==='P7_FIELD_OBSERVATION_FENCE_CONFLICT',
  );
  const inspect=new Database(databasePath,{readonly:true});
  assert.equal(inspect.prepare('SELECT current_profile_hint_revision value FROM proc_material_fields').get().value,2);
  assert.equal(inspect.prepare('SELECT COUNT(*) count FROM proc_field_observations').get().count,0);
  assert.equal(inspect.prepare('SELECT COUNT(*) count FROM fx_commit_markers').get().count,0);
  inspect.close();
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

test('reconciles one terminal Field batch with same-transaction Control freshness and exact CAS', async () => fixture(async ({databasePath,field,coordinator,unitOfWork}) => {
  seedRuntime(databasePath,'work-1','event-1'); const page=await observe(field,pageRequest('work-1','observation-1',0),[raw('a')]);
  coordinator.execute(commitRequest(page,'event-1')); const snapshot=page.entries[0];
  const control=createMaterialControlProjectionPort({schemaManifest,unitOfWork}).getMaterialControlProjection(snapshot.identity.materialKey);
  const selectionBasis={materialKey:snapshot.identity.materialKey,activeSelections:[],hasConflict:false};
  const extractionPolicy={extractionPolicyId:field.policy.extractionPolicyId,revision:field.policy.revision,...field.policy.policy,policyDigest:field.policy.policyDigest};
  const decision=evaluateExtractionEligibility({fieldId:'field-1',fieldStatus:'active',materialKey:snapshot.identity.materialKey,
    expectedEligibilityRevision:1,accessRevision:1,accessDigest:field.access.accessDigest,terminalObservationRevision:1,
    fieldObservationWorkId:'work-1',materialBindingRevision:1,lastSnapshotDigest:snapshot.snapshotDigest,lastObservationId:'observation-1',
    appearedInTerminalWork:true,materialRelativeLocation:'a.mkv',sizeBytes:100,observedExtension:'.mkv',extractionPolicy,
    selectionSnapshot:{...selectionBasis,selectionBasisDigest:canonicalDigest(selectionBasis)},controlSnapshot:control});
  const basis={fieldId:'field-1',accessRevision:1,terminalObservationRevision:1,policyRevision:1,decisions:[decision]};
  const batch={...basis,batchDigest:canonicalDigest(basis)}; const store=createEligibilityReconcileStore({schemaManifest,unitOfWork});
  const mismatched={...basis,accessRevision:2}; mismatched.batchDigest=canonicalDigest(mismatched);
  assert.throws(()=>store.reconcile(mismatched),(error)=>error.code==='P7_ELIGIBILITY_BATCH_INVALID');
  const result=store.reconcile(batch); assert.equal(result.applied.length,1); assert.deepEqual(result.staleMaterialKeys,[]);
  const replay=store.reconcile(batch); assert.deepEqual(replay.applied,[]); assert.deepEqual(replay.noOpMaterialKeys,[snapshot.identity.materialKey]);
  const db=new Database(databasePath,{readonly:true}); const row=db.prepare('SELECT eligibility_revision,eligibility_state,eligibility_reason_code,control_projection FROM proc_field_materials').get(); db.close();
  assert.deepEqual(row,{eligibility_revision:2,eligibility_state:'eligible',eligibility_reason_code:'eligible',control_projection:'uncontrolled'});
  const outbox=new Database(databasePath,{readonly:true}); assert.equal(outbox.prepare('SELECT COUNT(*) count FROM fx_outbox').get().count,0); outbox.close();
}));

test('does not rewrite Eligibility when a later Observation has identical material-local facts', async () => fixture(async ({databasePath,field,coordinator,unitOfWork}) => {
  seedRuntime(databasePath,'work-1','event-1');
  const firstPage=await observe(field,pageRequest('work-1','observation-1',0),[raw('a')]);
  coordinator.execute(commitRequest(firstPage,'event-1'));
  const snapshot=firstPage.entries[0];
  const control=createMaterialControlProjectionPort({schemaManifest,unitOfWork}).getMaterialControlProjection(snapshot.identity.materialKey);
  const selectionBasis={materialKey:snapshot.identity.materialKey,activeSelections:[],hasConflict:false};
  const extractionPolicy={extractionPolicyId:field.policy.extractionPolicyId,revision:field.policy.revision,...field.policy.policy,policyDigest:field.policy.policyDigest};
  const decision=evaluateExtractionEligibility({fieldId:'field-1',fieldStatus:'active',materialKey:snapshot.identity.materialKey,
    expectedEligibilityRevision:1,accessRevision:1,accessDigest:field.access.accessDigest,terminalObservationRevision:1,
    fieldObservationWorkId:'work-1',materialBindingRevision:1,lastSnapshotDigest:snapshot.snapshotDigest,lastObservationId:'observation-1',
    appearedInTerminalWork:true,materialRelativeLocation:'a.mkv',sizeBytes:100,observedExtension:'.mkv',extractionPolicy,
    selectionSnapshot:{...selectionBasis,selectionBasisDigest:canonicalDigest(selectionBasis)},controlSnapshot:control});
  const basis={fieldId:'field-1',accessRevision:1,terminalObservationRevision:1,policyRevision:1,decisions:[decision]};
  const store=createEligibilityReconcileStore({schemaManifest,unitOfWork});
  const firstBatch={...basis,batchDigest:canonicalDigest(basis)}; const firstReconcile=store.reconcile(firstBatch);
  assert.deepEqual(firstReconcile.applied.map((item)=>item.materialKey),[snapshot.identity.materialKey]);
  const beforeDb=new Database(databasePath,{readonly:true});
  const before=beforeDb.prepare('SELECT eligibility_revision,eligibility_state,eligibility_basis_digest,eligibility_observation_revision FROM proc_field_materials').get();
  const beforeEntries=beforeDb.prepare('SELECT COUNT(*) count FROM proc_field_observation_entries').get().count; beforeDb.close();
  seedRuntime(databasePath,'work-2','event-2');
  const secondPage=await observe(field,pageRequest('work-2','observation-2',1),[raw('a')]);
  coordinator.execute(commitRequest(secondPage,'event-2'));
  const inspect=new Database(databasePath,{readonly:true});
  const after=inspect.prepare('SELECT eligibility_revision,eligibility_state,eligibility_basis_digest,eligibility_observation_revision FROM proc_field_materials').get();
  const afterEntries=inspect.prepare('SELECT COUNT(*) count FROM proc_field_observation_entries').get().count; inspect.close();
  assert.deepEqual(after,before);
  assert.equal(Number(afterEntries),Number(beforeEntries)+1);
}));
