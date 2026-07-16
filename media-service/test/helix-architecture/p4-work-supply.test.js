'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { createWorkSupplyController } = require('../../src/helix/foundation/execution/work-supply-controller');
const { createRepositoryDefinition } = require('../../src/helix/foundation/persistence/owner-repository');
const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');

const generatedRoot = path.resolve(__dirname, '../../src/helix/foundation/persistence/generated');
const schemaDdl = fs.readFileSync(path.join(generatedRoot, 'clean-schema.sql'), 'utf8');
const schemaManifest = JSON.parse(fs.readFileSync(path.join(generatedRoot, 'clean-schema.manifest.json'), 'utf8'));
const limits = Object.freeze({
  openWorkSoft: 2, openWorkHard: 3, activeAttemptSoft: 2, activeAttemptHard: 3,
  dispatchableEventSoft: 2, dispatchableEventHard: 3, backgroundWorkSoft: 2, backgroundWorkHard: 3
});

function fixture(run, now = 120000) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-work-supply-'));
  const databasePath = path.join(root, 'shelfdeck.db');
  const kernel = openSqliteKernel({ Database, databasePath, schemaDdl, schemaManifest, now: () => 1700000001300 });
  const unitOfWork = createSqliteUnitOfWork({ kernel });
  const seed = createRepositoryDefinition({
    repositoryId: 'supply_seed', owner: 'execution-foundation', schemaManifest,
    statements: {
      work: { kind: 'insert', tableId: 'fx_supporting_works', columns: ['work_id', 'owner_domain', 'priority_class', 'state', 'idempotency_key'] },
      attempt: { kind: 'insert', tableId: 'fx_work_attempts', columns: ['attempt_id', 'work_id', 'state'] },
      plan: { kind: 'insert', tableId: 'fx_workflow_plans', columns: ['plan_id', 'attempt_id', 'state'] },
      event: { kind: 'insert', tableId: 'fx_workflow_events', columns: ['event_id', 'plan_id', 'owner_domain', 'priority_class', 'state'] },
      event_attempt: { kind: 'insert', tableId: 'fx_event_attempts', columns: ['event_attempt_id', 'event_id', 'ordinal', 'state', 'started_at_ms'] },
      circuit: { kind: 'insert', tableId: 'fx_circuit_states', columns: ['circuit_key', 'state'] }
    }
  });
  function seedRows(callback) {
    unitOfWork.execute([{
      participantId: 'supply_seed', owner: 'execution-foundation', repositories: [seed],
      execute(context) { callback(context.repository('supply_seed')); }
    }]);
  }
  const controller = createWorkSupplyController({ schemaManifest, unitOfWork, limits, now: () => now });
  try { return run({ controller, databasePath, seedRows }); }
  finally { kernel.close(); fs.rmSync(root, { recursive: true, force: true }); }
}

function addWork(repository, id, priority = 'normal_foreground', state = 'admitted', owner = 'libra') {
  repository.invoke('work', { work_id: id, owner_domain: owner, priority_class: priority, state, idempotency_key: 'key-' + id });
}

function addEventGraph(repository, id, priority = 'normal_foreground', state = 'ready') {
  addWork(repository, 'work-' + id, priority, 'running');
  repository.invoke('attempt', { attempt_id: 'attempt-' + id, work_id: 'work-' + id, state: 'running' });
  repository.invoke('plan', { plan_id: 'plan-' + id, attempt_id: 'attempt-' + id, state: 'planned' });
  repository.invoke('event', { event_id: 'event-' + id, plan_id: 'plan-' + id, owner_domain: 'libra', priority_class: priority, state });
}

test('Supply permits eligible Work Attempt from persisted target and produces stable snapshot', () => {
  fixture(({ controller, databasePath, seedRows }) => {
    seedRows((repository) => addWork(repository, 'target'));
    const first = controller.evaluate({ supplyKind: 'work_attempt', targetId: 'target' });
    const second = controller.evaluate({ supplyKind: 'work_attempt', targetId: 'target' });
    assert.equal(first.kind, 'permitted');
    assert.equal(first.lane, 'normal');
    assert.equal(first.snapshotDigest, second.snapshotDigest);
    const database = new Database(databasePath, { readonly: true });
    assert.equal(database.prepare('SELECT COUNT(*) count FROM fx_supporting_works').get().count, 1);
    database.close();
  });
});

test('soft cap defers normal supply but preserves reserved safety and handoff lanes', () => {
  fixture(({ controller, seedRows }) => {
    seedRows((repository) => {
      addWork(repository, 'normal');
      addWork(repository, 'filler');
      addWork(repository, 'safety', 'safety_liveness');
    });
    assert.deepEqual(controller.evaluate({ supplyKind: 'work_attempt', targetId: 'normal' }).kind, 'deferred');
    const safety = controller.evaluate({ supplyKind: 'work_attempt', targetId: 'safety' });
    assert.equal(safety.kind, 'deferred');
    assert.equal(safety.reasonCode, 'SUPPLY_HARD_CAP');
  });
  fixture(({ controller, seedRows }) => {
    seedRows((repository) => {
      addWork(repository, 'normal');
      addWork(repository, 'safety', 'safety_liveness');
    });
    assert.equal(controller.evaluate({ supplyKind: 'work_attempt', targetId: 'normal' }).reasonCode, 'SUPPLY_SOFT_CAP');
    assert.equal(controller.evaluate({ supplyKind: 'work_attempt', targetId: 'safety' }).lane, 'reserved');
  });
});

test('hard caps block every new lane without deleting or changing Work', () => {
  fixture(({ controller, databasePath, seedRows }) => {
    seedRows((repository) => {
      addWork(repository, 'target', 'handoff_acceptance');
      addWork(repository, 'two');
      addWork(repository, 'three');
    });
    assert.deepEqual(controller.evaluate({ supplyKind: 'work_attempt', targetId: 'target' }).reasonCode, 'SUPPLY_HARD_CAP');
    const database = new Database(databasePath, { readonly: true });
    assert.equal(database.prepare('SELECT COUNT(*) count FROM fx_supporting_works').get().count, 3);
    database.close();
  });
});

test('minimum background lane opens after 60 seconds only when no reserved Event is ready', () => {
  fixture(({ controller, seedRows }) => {
    seedRows((repository) => {
      addEventGraph(repository, 'background', 'background_observation');
      addWork(repository, 'filler');
    });
    const decision = controller.evaluate({ supplyKind: 'event_dispatch', targetId: 'event-background' });
    assert.equal(decision.kind, 'permitted');
    assert.equal(decision.lane, 'minimum_background');
  }, 120000);
  fixture(({ controller, seedRows }) => {
    seedRows((repository) => {
      addEventGraph(repository, 'background', 'background_observation');
      addEventGraph(repository, 'safety', 'safety_liveness');
    });
    assert.equal(controller.evaluate({ supplyKind: 'event_dispatch', targetId: 'event-background' }).reasonCode, 'SUPPLY_SOFT_CAP');
  }, 120000);
  fixture(({ controller, seedRows }) => {
    seedRows((repository) => {
      addEventGraph(repository, 'background', 'background_observation');
      addWork(repository, 'filler');
      repository.invoke('event_attempt', {
        event_attempt_id: 'event-attempt-background', event_id: 'event-background', ordinal: 1, state: 'completed', started_at_ms: 90000
      });
    });
    assert.equal(controller.evaluate({ supplyKind: 'event_dispatch', targetId: 'event-background' }).reasonCode, 'SUPPLY_SOFT_CAP');
  }, 120000);
});

test('Circuit and target state defer or reject supply without Planner/Capability decisions', () => {
  fixture(({ controller, seedRows }) => {
    seedRows((repository) => {
      addWork(repository, 'target');
      repository.invoke('circuit', { circuit_key: 'owner/libra/work-supply', state: 'open' });
    });
    assert.deepEqual(controller.evaluate({ supplyKind: 'work_attempt', targetId: 'target' }), { kind: 'deferred', reasonCode: 'CIRCUIT_OPEN' });
    assert.equal(controller.evaluate({ supplyKind: 'work_attempt', targetId: 'missing' }).kind, 'ineligible');
  });
});

test('Supply source has no Planner, Capability selection, capacity decision, deletion, or Business write', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../src/helix/foundation/execution/work-supply-controller.js'), 'utf8').toLowerCase();
  for (const parts of [['planner', '.'], ['capability', 'ref'], ['permit', 'capacity'], ['delete', ' from'], ['../domains']]) {
    assert.equal(source.includes(parts.join('')), false, parts.join(''));
  }
});
