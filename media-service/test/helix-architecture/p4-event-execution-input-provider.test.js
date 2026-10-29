'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { canonicalDigest, canonicalJson } = require('../../src/helix/contracts/canonical-json');
const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const { createEventExecutionInputProvider, eventExecutionIdempotencyKey } = require('../../src/helix/foundation/execution/event-execution-input-provider');

const generated = path.resolve(__dirname, '../../src/helix/foundation/persistence/generated');
const schemaDdl = fs.readFileSync(path.join(generated, 'clean-schema.sql'), 'utf8');
const schemaManifest = JSON.parse(fs.readFileSync(path.join(generated, 'clean-schema.manifest.json'), 'utf8'));

test('projection Owner scope is shared only within one Event input preparation',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-owner-projection-scope-')),databasePath=path.join(root,'shelfdeck.db');
  const kernel=openSqliteKernel({Database,databasePath,schemaDdl,schemaManifest,now:()=>10}),unitOfWork=createSqliteUnitOfWork({kernel});
  try{
    const database=new Database(databasePath),result={draft:'frozen'};database.pragma('foreign_keys = OFF');
    database.prepare(`INSERT INTO fx_event_result_bindings
      (result_id,event_id,outcome_kind,result_schema_ref,result_json,result_digest,evidence_schema_ref,evidence_json,evidence_digest,committed_at_ms)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run('result-1','resolve','succeeded','helix://fixture/Draft/v1',canonicalJson(result),canonicalDigest(result),
        'helix://fixture/Draft/v1',canonicalJson(result),canonicalDigest(result),1);database.close();
    const seen=[],options={schemaManifest,unitOfWork,contractValidator:{validate:(_ref,value)=>value},
      bindingProjectionRegistry:{resolve(){return {project({ownerScope,sourceResult}){seen.push(ownerScope);return sourceResult||{ok:true};}};}}};
    const ownerBindings=['query','recordSet','rule'].map(portName=>({portName,bindingKind:'projected_owner_facts',ownerDomain:'perception',
      processType:'perception_resolution',processId:'subject:fixture',projectionRef:'helix://fixture/projection/v1',parameters:{}}));
    const resultBindings=['draft','handle'].map(portName=>({portName,bindingKind:'projected_event_result',eventId:'resolve',
      resultSchemaRef:'helix://fixture/Draft/v1',projectionRef:'helix://fixture/projection/v1',parameters:{}}));
    const snapshot=(eventId,bindings,workAttemptId='attempt-1')=>({node:{input_bindings_json:canonicalJson({schemaRef:'helix://foundation/types/EventInputBindingSet/v1',schemaVersion:1,bindings}),
      input_binding_schema_ref:'helix://fixture/Inputs/v1'},event:{event_id:eventId},work:{work_id:'work-1',owner_domain:'perception',
      process_type:'perception_resolution',process_id:'subject:fixture',basis_digest:'a'.repeat(64)},workAttempt:{attempt_id:workAttemptId},plan:{plan_id:'plan-1'}});
    const provider=createEventExecutionInputProvider(options),samePreparationScope=Object.freeze({});
    provider.prepare({snapshot:snapshot('resolve',ownerBindings),preparationScope:samePreparationScope});
    assert.equal(seen[0],seen[1]);assert.equal(seen[1],seen[2]);
    provider.prepare({snapshot:snapshot('commit',resultBindings),preparationScope:samePreparationScope});
    assert.equal(seen[3],seen[4]);assert.notEqual(seen[0],seen[3]);
    provider.prepare({snapshot:snapshot('commit',resultBindings),preparationScope:samePreparationScope});
    assert.equal(seen[5],seen[6]);assert.notEqual(seen[3],seen[5]);
    provider.prepare({snapshot:snapshot('commit',resultBindings,'attempt-2'),preparationScope:samePreparationScope});
    assert.notEqual(seen[5],seen[7]);
    createEventExecutionInputProvider(options).prepare({snapshot:snapshot('commit',resultBindings),preparationScope:samePreparationScope});
    assert.notEqual(seen[7],seen[9]);assert.equal(new Set([seen[0],seen[3],seen[5],seen[7],seen[9]]).size,5);
  }finally{kernel.close();fs.rmSync(root,{recursive:true,force:true});}
});

test('Event input provider resolves predecessor typed Result plus literal ports from durable bindings', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-event-input-'));
  const databasePath = path.join(root, 'shelfdeck.db');
  const kernel = openSqliteKernel({ Database, databasePath, schemaDdl, schemaManifest, now: () => 10 });
  const unitOfWork = createSqliteUnitOfWork({ kernel });
  try {
    const result = { page: 1 };
    const database = new Database(databasePath);
    database.pragma('foreign_keys = OFF');
    database.prepare(`INSERT INTO fx_event_result_bindings
      (result_id,event_id,outcome_kind,result_schema_ref,result_json,result_digest,evidence_schema_ref,evidence_json,evidence_digest,committed_at_ms)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run('result-1', 'event-observe', 'succeeded', 'helix://fixture/Page/v1', canonicalJson(result),
      canonicalDigest(result), 'helix://fixture/Page/v1', canonicalJson(result), canonicalDigest(result), 1);
    database.close();
    const validated = [];
    const provider = createEventExecutionInputProvider({ schemaManifest, unitOfWork, contractValidator: {
      validate(schemaRef, value) { validated.push({ schemaRef, value }); return value; },
    } });
    const bindingSet = { schemaRef: 'helix://foundation/types/EventInputBindingSet/v1', schemaVersion: 1, bindings: [
      { portName: 'page', bindingKind: 'event_result', eventId: 'event-observe', resultSchemaRef: 'helix://fixture/Page/v1' },
      { portName: 'handle', bindingKind: 'literal', value: { id: 'handle-1' } },
    ] };
    const prepared = provider.prepare({ snapshot: {
      node: { input_bindings_json: canonicalJson(bindingSet), input_binding_schema_ref: 'helix://fixture/CommitInputs/v1' },
      event: { event_id: 'event-commit' },
      work: { work_id: 'work-1', owner_domain: 'procurement', process_type: 'material_field', process_id: 'field-1',
        basis_digest: 'a'.repeat(64) },
      workAttempt: { attempt_id: 'attempt-1' }, plan: { plan_id: 'plan-1' },
    } });
    assert.deepEqual(prepared.namedInputs, { page: result, handle: { id: 'handle-1' } });
    assert.deepEqual(validated, [{ schemaRef: 'helix://fixture/CommitInputs/v1', value: prepared.namedInputs }]);
    assert.equal(prepared.idempotencyKey, eventExecutionIdempotencyKey({
      eventId: 'event-commit', workAttemptId: 'attempt-1', planId: 'plan-1',
    }));
    assert.equal(prepared.idempotencyKey, eventExecutionIdempotencyKey({
      eventId: 'event-commit', workAttemptId: 'attempt-1', planId: 'plan-1', eventAttemptOrdinal: 1,
    }));
    assert.notEqual(prepared.idempotencyKey, eventExecutionIdempotencyKey({
      eventId: 'event-commit', workAttemptId: 'attempt-1', planId: 'plan-1', eventAttemptOrdinal: 2,
    }));
    const retried = provider.prepare({ snapshot: {
      node: { input_bindings_json: canonicalJson(bindingSet), input_binding_schema_ref: 'helix://fixture/CommitInputs/v1' },
      event: { event_id: 'event-commit' },
      work: { work_id: 'work-1', owner_domain: 'procurement', process_type: 'material_field', process_id: 'field-1',
        basis_digest: 'a'.repeat(64) },
      workAttempt: { attempt_id: 'attempt-1' }, plan: { plan_id: 'plan-1' },
      nextOrdinal: 2,
    } });
    assert.equal(retried.idempotencyKey, eventExecutionIdempotencyKey({
      eventId: 'event-commit', workAttemptId: 'attempt-1', planId: 'plan-1', eventAttemptOrdinal: 2,
    }));
    const recovered = provider.prepare({ snapshot: {
      node: { input_bindings_json: canonicalJson(bindingSet), input_binding_schema_ref: 'helix://fixture/CommitInputs/v1' },
      event: { event_id: 'event-commit' },
      work: { work_id: 'work-1', owner_domain: 'procurement', process_type: 'material_field', process_id: 'field-1',
        basis_digest: 'a'.repeat(64) },
      workAttempt: { attempt_id: 'attempt-1' }, plan: { plan_id: 'plan-1' },
      activeAttempt: { ordinal: 2, event_attempt_id: 'event-attempt-2' },
    } });
    assert.equal(recovered.idempotencyKey, retried.idempotencyKey);
  } finally {
    kernel.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Event input provider projects an ordered set of predecessor Results without coordinator assembly', () => {
  const preparationScope = Object.freeze({});
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-event-input-set-'));
  const databasePath = path.join(root, 'shelfdeck.db');
  const kernel = openSqliteKernel({ Database, databasePath, schemaDdl, schemaManifest, now: () => 10 });
  const unitOfWork = createSqliteUnitOfWork({ kernel });
  try {
    const database = new Database(databasePath);
    database.pragma('foreign_keys = OFF');
    for (const [ordinal, eventId] of ['event-a', 'event-b'].entries()) {
      const result = { ordinal };
      database.prepare(`INSERT INTO fx_event_result_bindings
        (result_id,event_id,outcome_kind,result_schema_ref,result_json,result_digest,evidence_schema_ref,evidence_json,evidence_digest,committed_at_ms)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(`result-${ordinal}`, eventId, 'succeeded', 'helix://fixture/Item/v1', canonicalJson(result),
        canonicalDigest(result), 'helix://fixture/Item/v1', canonicalJson(result), canonicalDigest(result), 1);
    }
    database.close();
    const provider = createEventExecutionInputProvider({ schemaManifest, unitOfWork,
      contractValidator: { validate(_schemaRef, value) { return value; } },
      bindingProjectionRegistry: { resolve(ref) {
        assert.equal(ref, 'helix://fixture/projections/collect/v1');
        return { project({ sourceResults, parameters, preparationScope:actualScope, targetEventId }) {
          assert.equal(actualScope, preparationScope);
          assert.equal(targetEventId, 'event-target');
          return { values: sourceResults.map((source) => source.result.ordinal), label: parameters.label };
        } };
      } },
    });
    const bindingSet = { schemaRef: 'helix://foundation/types/EventInputBindingSet/v1', schemaVersion: 1, bindings: [{
      portName: 'batch', bindingKind: 'projected_event_results', projectionRef: 'helix://fixture/projections/collect/v1',
      parameters: { label: 'ordered' }, eventResults: [
        { eventId: 'event-b', resultSchemaRef: 'helix://fixture/Item/v1' },
        { eventId: 'event-a', resultSchemaRef: 'helix://fixture/Item/v1' },
      ],
    }] };
    const prepared = provider.prepare({ preparationScope, snapshot: {
      node: { input_bindings_json: canonicalJson(bindingSet), input_binding_schema_ref: 'helix://fixture/BatchInputs/v1' },
      event: { event_id: 'event-target' },
      work: { work_id: 'work-1', owner_domain: 'procurement', process_type: 'run', process_id: 'run-1', basis_digest: 'a'.repeat(64) },
      workAttempt: { attempt_id: 'attempt-1' }, plan: { plan_id: 'plan-1' },
    } });
    assert.deepEqual(prepared.namedInputs, { batch: { values: [1, 0], label: 'ordered' } });
  } finally {
    kernel.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Event input provider projects durable Results from the owning Work across immutable Plan attempts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-event-work-results-'));
  const databasePath = path.join(root, 'shelfdeck.db');
  const kernel = openSqliteKernel({ Database, databasePath, schemaDdl, schemaManifest, now: () => 10 });
  const unitOfWork = createSqliteUnitOfWork({ kernel });
  try {
    const provider = createEventExecutionInputProvider({ schemaManifest, unitOfWork,
      contractValidator: { validate(_schemaRef, value) { return value; } },
      workResultReader: { read(workId) { assert.equal(workId, 'work-1'); return Object.freeze([
        Object.freeze({ eventId:'prior-a', outcomeKind:'succeeded', resultSchemaRef:'helix://fixture/A/v1', result:Object.freeze({ value:1 }),
          inputBindings:Object.freeze({bindings:Object.freeze([Object.freeze({portName:'source',bindingKind:'literal',value:'frozen'})])}) }),
        Object.freeze({ eventId:'prior-b', outcomeKind:'failed', resultSchemaRef:'helix://fixture/A/v1', result:Object.freeze({ value:2 }) }),
      ]); } },
      bindingProjectionRegistry: { resolve() { return { project({ sourceResults, sourceWorkId }) {
        return { sourceWorkId, values:sourceResults.map((item)=>item.result.value),
          frozenInputs:sourceResults.map((item)=>item.inputBindings.bindings[0].value) };
      } }; } },
    });
    const bindingSet={schemaRef:'helix://foundation/types/EventInputBindingSet/v1',schemaVersion:1,bindings:[{
      portName:'continued',bindingKind:'projected_work_results',sourceWorkId:'work-1',
      resultSchemaRefs:['helix://fixture/A/v1'],projectionRef:'helix://fixture/projections/continued/v1',parameters:{page:1},
    }]};
    const prepared=provider.prepare({snapshot:{
      node:{input_bindings_json:canonicalJson(bindingSet),input_binding_schema_ref:'helix://fixture/ContinuedInputs/v1'},
      event:{event_id:'event-page-1'},work:{work_id:'work-1',owner_domain:'procurement',process_type:'run',process_id:'run-1',basis_digest:'a'.repeat(64)},
      workAttempt:{attempt_id:'attempt-2'},plan:{plan_id:'plan-2'},
    }});
    assert.deepEqual(prepared.namedInputs,{continued:{sourceWorkId:'work-1',values:[1],frozenInputs:['frozen']}});
  } finally {
    kernel.close();
    fs.rmSync(root,{recursive:true,force:true});
  }
});
