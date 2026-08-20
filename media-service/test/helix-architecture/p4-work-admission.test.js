'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { createWorkAdmission } = require('../../src/helix/foundation/execution/work-admission');
const { createRepositoryDefinition } = require('../../src/helix/foundation/persistence/owner-repository');
const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');

const generatedRoot = path.resolve(__dirname, '../../src/helix/foundation/persistence/generated');
const schemaDdl = fs.readFileSync(path.join(generatedRoot, 'clean-schema.sql'), 'utf8');
const schemaManifest = JSON.parse(fs.readFileSync(path.join(generatedRoot, 'clean-schema.manifest.json'), 'utf8'));

function definition(overrides = {}) {
  return {
    schemaRef: 'helix://foundation/types/SupportingWorkDefinition/v1', schemaVersion: 1, workId: 'work-1', ownerDomain: 'libra',
    processType: 'libra_run', processId: 'run-1', workKind: 'product_gap', workObjectiveTypeRef: 'helix://libra/work/ProductGap/v1',
    workObjectiveVersion: 1, executionBasisId: 'basis-1', executionBasisDigest: 'a'.repeat(64), dependencyRefs: [],
    priorityClass: 'normal_foreground', priorityRevision: 1, capabilityCatalogScope: 'libra', workspaceMaterialScope: [],
    idempotencyKey: 'work-key-1', concurrencyScope: 'run-1/product', outputContractRef: 'helix://libra/results/ProductGap/v1', ...overrides
  };
}

function fixture(run, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-work-admission-'));
  const databasePath = path.join(root, 'shelfdeck.db');
  let clock = 1700000001100;
  const kernel = openSqliteKernel({ Database, databasePath, schemaDdl, schemaManifest, now: () => clock++ });
  const unitOfWork = createSqliteUnitOfWork({ kernel });
  const admission = createWorkAdmission({
    schemaManifest, unitOfWork,
    eligibilityProvider: options.eligibilityProvider || { check: (request) => ({ eligible: true, basisDigest: request.executionBasisDigest }) },
    limits: options.limits || { globalOpenWorks: 10, ownerOpenWorks: 5, openEvents: 20 }
  });
  try { return run({ admission, databasePath, kernel, unitOfWork }); }
  finally { kernel.close(); fs.rmSync(root, { recursive: true, force: true }); }
}

function rows(databasePath, table) {
  const database = new Database(databasePath, { readonly: true });
  try { return database.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all(); }
  finally { database.close(); }
}

test('Admission atomically creates Supporting Work and typed Receipt with stable replay', () => {
  fixture(({ admission, databasePath }) => {
    assert.deepEqual(admission.submit(definition()), { kind: 'admitted', workId: 'work-1', state: 'admitted', replayed: false });
    assert.deepEqual(admission.submit(definition()), { kind: 'admitted', workId: 'work-1', state: 'admitted', replayed: true });
    const works = rows(databasePath, 'fx_supporting_works');
    const receipts = rows(databasePath, 'fx_command_receipts');
    assert.equal(works.length, 1);
    assert.equal(receipts.length, 1);
    assert.equal(works[0].created_at_ms, receipts[0].committed_at_ms);
    assert.equal(receipts[0].caller_scope, 'libra:run-1/product');
  });
});

test('same idempotency key with changed Definition is a stable conflict before writes', () => {
  fixture(({ admission, databasePath }) => {
    admission.submit(definition());
    assert.throws(() => admission.submit(definition({ workId: 'work-2', executionBasisDigest: 'b'.repeat(64) })),
      (error) => error.code === 'P4_WORK_ADMISSION_IDEMPOTENCY_CONFLICT');
    assert.equal(rows(databasePath, 'fx_supporting_works').length, 1);
    assert.equal(rows(databasePath, 'fx_command_receipts').length, 1);
  });
});

test('open concurrency scope and authoritative Work hard caps defer without creating facts', () => {
  fixture(({ admission, databasePath }) => {
    admission.submit(definition());
    assert.deepEqual(admission.submit(definition({ workId: 'work-2', idempotencyKey: 'work-key-2' })),
      { kind: 'deferred', reasonCode: 'CONCURRENCY_SCOPE_OPEN' });
    assert.equal(rows(databasePath, 'fx_supporting_works').length, 1);
  });
  fixture(({ admission, databasePath }) => {
    admission.submit(definition());
    assert.deepEqual(admission.submit(definition({ workId: 'work-2', idempotencyKey: 'work-key-2', concurrencyScope: 'run-1/other' })),
      { kind: 'deferred', reasonCode: 'WORK_HARD_CAP' });
    assert.equal(rows(databasePath, 'fx_command_receipts').length, 1);
  }, { limits: { globalOpenWorks: 1, ownerOpenWorks: 5, openEvents: 20 } });
});

test('sixteen reserved slots remain available to Handoff Acceptance after 240 ordinary Works', () => {
  fixture(({ admission, databasePath }) => {
    for (let index = 0; index < 240; index += 1) {
      assert.equal(admission.submit(definition({
        workId: 'ordinary-' + index,
        idempotencyKey: 'ordinary-key-' + index,
        concurrencyScope: 'ordinary/' + index,
      })).kind, 'admitted');
    }
    assert.deepEqual(admission.submit(definition({
      workId: 'ordinary-over-reserve', idempotencyKey: 'ordinary-over-reserve-key',
      concurrencyScope: 'ordinary/over-reserve',
    })), { kind: 'deferred', reasonCode: 'WORK_RESERVED_CAPACITY' });
    for (let index = 0; index < 16; index += 1) {
      assert.equal(admission.submit(definition({
        workId: 'acceptance-' + index,
        idempotencyKey: 'acceptance-key-' + index,
        concurrencyScope: 'acceptance/' + index,
        priorityClass: 'handoff_acceptance',
      })).kind, 'admitted');
    }
    assert.deepEqual(admission.submit(definition({
      workId: 'acceptance-over-hard-cap', idempotencyKey: 'acceptance-over-hard-cap-key',
      concurrencyScope: 'acceptance/over-hard-cap', priorityClass: 'handoff_acceptance',
    })), { kind: 'deferred', reasonCode: 'WORK_HARD_CAP' });
    assert.equal(rows(databasePath, 'fx_supporting_works').length, 256);
  }, { limits: { globalOpenWorks: 256, ownerOpenWorks: 256, openEvents: 256, reservedOpenWorks: 16 } });
});

test('open Circuit defers before Work/Receipt insertion', () => {
  fixture(({ admission, databasePath, unitOfWork }) => {
    const circuit = createRepositoryDefinition({
      repositoryId: 'test_circuit', owner: 'execution-foundation', schemaManifest,
      statements: { insert: { kind: 'insert', tableId: 'fx_circuit_states', columns: [
        'circuit_key', 'state', 'reason_code', 'evidence_digest', 'opened_at_ms', 'reviewed_at_ms'
      ] } }
    });
    unitOfWork.execute([{
      participantId: 'test_circuit', owner: 'execution-foundation', repositories: [circuit], execute(context) {
        context.repository('test_circuit').invoke('insert', {
          circuit_key: 'owner/libra/work-admission', state: 'open', reason_code: 'test', evidence_digest: 'c'.repeat(64),
          opened_at_ms: context.commitTimeMs, reviewed_at_ms: null
        });
      }
    }]);
    assert.deepEqual(admission.submit(definition()), { kind: 'deferred', reasonCode: 'CIRCUIT_OPEN' });
    assert.equal(rows(databasePath, 'fx_supporting_works').length, 0);
    assert.equal(rows(databasePath, 'fx_command_receipts').length, 0);
  });
});

test('authoritative persisted Event hard cap defers new Work supply', () => {
  fixture(({ admission, databasePath, unitOfWork }) => {
    const runtime = createRepositoryDefinition({
      repositoryId: 'test_runtime_seed', owner: 'execution-foundation', schemaManifest,
      statements: {
        work: { kind: 'insert', tableId: 'fx_supporting_works', columns: ['work_id', 'owner_domain', 'state', 'idempotency_key'] },
        attempt: { kind: 'insert', tableId: 'fx_work_attempts', columns: ['attempt_id', 'work_id', 'state'] },
        plan: { kind: 'insert', tableId: 'fx_workflow_plans', columns: ['plan_id', 'attempt_id', 'state'] },
        event: { kind: 'insert', tableId: 'fx_workflow_events', columns: ['event_id', 'plan_id', 'state'] }
      }
    });
    unitOfWork.execute([{
      participantId: 'test_runtime_seed', owner: 'execution-foundation', repositories: [runtime], execute(context) {
        const repository = context.repository('test_runtime_seed');
        repository.invoke('work', { work_id: 'existing-work', owner_domain: 'arca', state: 'running', idempotency_key: 'existing-key' });
        repository.invoke('attempt', { attempt_id: 'existing-attempt', work_id: 'existing-work', state: 'running' });
        repository.invoke('plan', { plan_id: 'existing-plan', attempt_id: 'existing-attempt', state: 'planned' });
        repository.invoke('event', { event_id: 'existing-event', plan_id: 'existing-plan', state: 'ready' });
      }
    }]);
    assert.deepEqual(admission.submit(definition()), { kind: 'deferred', reasonCode: 'EVENT_HARD_CAP' });
    assert.equal(rows(databasePath, 'fx_command_receipts').length, 0);
  }, { limits: { globalOpenWorks: 10, ownerOpenWorks: 5, openEvents: 1 } });
});

test('invalid Definition or Process/Basis eligibility returns invalid_contract without database writes', () => {
  fixture(({ admission, databasePath }) => {
    assert.equal(admission.submit(definition({ capabilityRef: 'libra.media.transcode@1' })).kind, 'invalid_contract');
    assert.equal(rows(databasePath, 'fx_supporting_works').length, 0);
  });
  fixture(({ admission, databasePath }) => {
    assert.deepEqual(admission.submit(definition()), { kind: 'invalid_contract', reasonCode: 'PROCESS_TERMINAL' });
    assert.equal(rows(databasePath, 'fx_command_receipts').length, 0);
  }, { eligibilityProvider: { check: () => ({ eligible: false, reasonCode: 'PROCESS_TERMINAL', basisDigest: 'a'.repeat(64) }) } });
});

test('Work insert failure rolls back Receipt and never creates Business Process facts', () => {
  fixture(({ admission, databasePath }) => {
    admission.submit(definition());
    assert.throws(() => admission.submit(definition({ idempotencyKey: 'work-key-2', concurrencyScope: 'run-1/other' })),
      /UNIQUE constraint failed: fx_supporting_works.work_id/);
    assert.equal(rows(databasePath, 'fx_command_receipts').length, 1);
    for (const table of ['libra_runs', 'libra_subjects', 'arca_aftercare_cases', 'proc_procurement_runs']) {
      assert.equal(rows(databasePath, table).length, 0, table);
    }
  });
});
