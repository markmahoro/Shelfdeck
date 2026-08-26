'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { createProgressReporter } = require('../../src/helix/foundation/execution/progress-reporter');
const { createRepositoryDefinition } = require('../../src/helix/foundation/persistence/owner-repository');
const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');

const generatedRoot = path.resolve(__dirname, '../../src/helix/foundation/persistence/generated');
const schemaDdl = fs.readFileSync(path.join(generatedRoot, 'clean-schema.sql'), 'utf8');
const schemaManifest = JSON.parse(fs.readFileSync(path.join(generatedRoot, 'clean-schema.manifest.json'), 'utf8'));

function sample(overrides = {}) {
  return { mode: 'determinate', currentValue: 1, totalValue: 10, unit: 'items', rate: 1, etaMs: 9000,
    sourceSequence: 'seq-1', progressBucket: '10-percent', terminal: false, ...overrides };
}

function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-progress-'));
  const databasePath = path.join(root, 'shelfdeck.db'); let now = 10000;
  const kernel = openSqliteKernel({ Database, databasePath, schemaDdl, schemaManifest, now: () => 1700000001600 });
  const unitOfWork = createSqliteUnitOfWork({ kernel });
  const seed = createRepositoryDefinition({ repositoryId: 'progress_seed', owner: 'execution-foundation', schemaManifest, statements: {
    work: { kind: 'insert', tableId: 'fx_supporting_works', columns: ['work_id', 'owner_domain', 'priority_class', 'state', 'idempotency_key'] },
    work_attempt: { kind: 'insert', tableId: 'fx_work_attempts', columns: ['attempt_id', 'work_id', 'state'] },
    plan: { kind: 'insert', tableId: 'fx_workflow_plans', columns: ['plan_id', 'attempt_id', 'state'] },
    event: { kind: 'insert', tableId: 'fx_workflow_events', columns: [
      'event_id', 'plan_id', 'node_id', 'work_id', 'owner_domain', 'priority_class', 'state', 'ready_at_ms', 'retry_at_ms', 'current_progress_revision'
    ] },
    event_attempt: { kind: 'insert', tableId: 'fx_event_attempts', columns: ['event_attempt_id', 'event_id', 'ordinal', 'state', 'started_at_ms'] }
  } });
  unitOfWork.execute([{ participantId: 'progress_seed', owner: 'execution-foundation', repositories: [seed], execute(context) {
    const repository = context.repository('progress_seed');
    repository.invoke('work', { work_id: 'work', owner_domain: 'libra', priority_class: 'normal_foreground', state: 'running', idempotency_key: 'work' });
    repository.invoke('work_attempt', { attempt_id: 'work-attempt', work_id: 'work', state: 'running' });
    repository.invoke('plan', { plan_id: 'plan', attempt_id: 'work-attempt', state: 'planned' });
    repository.invoke('event', { event_id: 'event', plan_id: 'plan', node_id: 'node', work_id: 'work', owner_domain: 'libra',
      priority_class: 'normal_foreground', state: 'executing', ready_at_ms: 1, retry_at_ms: null, current_progress_revision: null });
    repository.invoke('event_attempt', { event_attempt_id: 'event-attempt', event_id: 'event', ordinal: 1, state: 'executing', started_at_ms: 1 });
  } }]);
  const reporter = createProgressReporter({ schemaManifest, unitOfWork, eventId: 'event', eventAttemptId: 'event-attempt', now: () => now });
  try { return run({ reporter, databasePath, setNow: (value) => { now = value; },
    createReporter: (eventAttemptId) => createProgressReporter({ schemaManifest, unitOfWork,
      eventId:'event', eventAttemptId, now:() => now }) }); }
  finally { kernel.close(); fs.rmSync(root, { recursive: true, force: true }); }
}

test('Progress sample and current pointer commit atomically with monotonic revision', () => {
  fixture(({ reporter, databasePath, setNow }) => {
    assert.deepEqual(reporter.report(sample()), { sampled: true, replayed: false, revision: 1 });
    setNow(15000);
    assert.deepEqual(reporter.report(sample({ currentValue: 2, sourceSequence: 'seq-2', progressBucket: '20-percent' })),
      { sampled: true, replayed: false, revision: 2 });
    const database = new Database(databasePath, { readonly: true });
    try {
      assert.equal(database.prepare('SELECT current_progress_revision value FROM fx_workflow_events WHERE event_id=?').get('event').value, 2);
      assert.equal(database.prepare('SELECT COUNT(*) count FROM fx_event_progress').get().count, 2);
    } finally { database.close(); }
  });
});

test('current returns only the latest persisted sample for the exact Event Attempt', () => {
  fixture(({ reporter, setNow }) => {
    assert.equal(reporter.current(),null);
    reporter.report(sample());
    setNow(15000);
    reporter.report(sample({currentValue:2,sourceSequence:'seq-2',progressBucket:'20-percent'}));
    assert.deepEqual(reporter.current(),{
      revision:2,mode:'determinate',currentValue:2,totalValue:10,unit:'items',rate:1,etaMs:9000,
      sourceSequence:'seq-2',progressBucket:'20-percent',sampledAtMs:15000,
    });
  });
});

test('Event progress floor survives a failed Attempt and rejects a lower retry sample', () => {
  fixture(({ reporter, databasePath, setNow, createReporter }) => {
    reporter.report(sample({ currentValue:6.3, totalValue:10, sourceSequence:'attempt-1-63', progressBucket:'percent-63' }));
    const database = new Database(databasePath);
    try {
      database.prepare("UPDATE fx_event_attempts SET state='completed' WHERE event_attempt_id='event-attempt'").run();
      database.prepare(`INSERT INTO fx_event_attempts
        (event_attempt_id,event_id,ordinal,state,started_at_ms) VALUES (?,?,?,?,?)`)
        .run('event-attempt-2','event',2,'executing',2);
    } finally { database.close(); }
    const retry = createReporter('event-attempt-2');
    assert.equal(retry.current(), null);
    assert.deepEqual(retry.floor(), {
      revision:1, mode:'determinate', currentValue:6.3, totalValue:10, unit:'items', rate:1, etaMs:9000,
      sourceSequence:'attempt-1-63', progressBucket:'percent-63', sampledAtMs:10000,
    });
    setNow(15000);
    assert.throws(() => retry.report(sample({ currentValue:0, sourceSequence:'attempt-2-zero', progressBucket:'percent-0' })),
      { code:'P4_PROGRESS_REGRESSION' });
    assert.deepEqual(retry.report(sample({ currentValue:6.4, sourceSequence:'attempt-2-64', progressBucket:'percent-64' })),
      { sampled:true, replayed:false, revision:2 });
  });
});

test('same source sequence replays exact value and rejects changed value', () => {
  fixture(({ reporter }) => {
    reporter.report(sample());
    assert.deepEqual(reporter.report(sample()), { sampled: false, replayed: true, revision: 1 });
    assert.throws(() => reporter.report(sample({ currentValue: 2 })), { code: 'P4_PROGRESS_SOURCE_SEQUENCE_CONFLICT' });
  });
});

test('five-second limit suppresses same bucket but permits deterministic bucket and terminal samples', () => {
  fixture(({ reporter, setNow }) => {
    reporter.report(sample()); setNow(11000);
    assert.equal(reporter.report(sample({ currentValue: 1.5, sourceSequence: 'seq-2' })).reasonCode, 'SAMPLE_INTERVAL');
    assert.equal(reporter.report(sample({ currentValue: 2, sourceSequence: 'seq-3', progressBucket: '20-percent' })).sampled, true);
    setNow(11500);
    assert.equal(reporter.report(sample({ currentValue: 10, sourceSequence: 'seq-4', progressBucket: '20-percent', terminal: true })).sampled, true);
  });
});

test('invalid, non-finite, regressing, or fake indeterminate progress fails closed', () => {
  fixture(({ reporter, setNow }) => {
    reporter.report(sample({ currentValue: 5 })); setNow(16000);
    assert.throws(() => reporter.report(sample({ currentValue: 4, sourceSequence: 'seq-2' })), { code: 'P4_PROGRESS_REGRESSION' });
    assert.throws(() => reporter.report(sample({ currentValue: Infinity })), { code: 'P4_PROGRESS_SAMPLE_INVALID' });
    assert.throws(() => reporter.report(sample({ mode: 'indeterminate' })), { code: 'P4_PROGRESS_INDETERMINATE_INVALID' });
  });
});

test('ProgressReporter source has no Repository exposure, result mutation, authorization, or Business write', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../src/helix/foundation/execution/progress-reporter.js'), 'utf8').toLowerCase();
  for (const forbidden of ['../domains', 'outcome_kind', 'authorization', 'business process', 'result_json']) assert.equal(source.includes(forbidden), false, forbidden);
});
