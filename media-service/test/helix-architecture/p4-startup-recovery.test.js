'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { createStartupRecovery } = require('../../src/helix/foundation/execution/startup-recovery');
const {
  UAT_SOURCE_EXECUTION_CATALOG_DIGEST,
  PRE_PROJECTION_EXECUTION_CATALOG_DIGEST,
  verifyStartupPlanCatalog,
} = require('../../src/helix/composition/create-procurement-execution-runtime');
const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');

const generated = path.resolve(__dirname, '../../src/helix/foundation/persistence/generated');
const schemaDdl = fs.readFileSync(path.join(generated, 'clean-schema.sql'), 'utf8');
const schemaManifest = JSON.parse(fs.readFileSync(path.join(generated, 'clean-schema.manifest.json'), 'utf8'));
const HASH = 'a'.repeat(64);

function fixture(run, settings = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-startup-'));
  const databasePath = path.join(root, 'shelfdeck.db');
  const kernel = openSqliteKernel({ Database, databasePath, schemaDdl, schemaManifest, now: () => 1700000005000 });
  if (settings.seedEvent !== false) kernel.runPrimitive((transaction) => {
    const effectClass = settings.effectClass || 'pure_observation';
    const eventState = settings.eventState || 'executing';
    transaction.prepare("INSERT INTO fx_supporting_works(work_id,state) VALUES('work','running')").run();
    transaction.prepare("INSERT INTO fx_work_attempts(attempt_id,work_id,state) VALUES('work-attempt','work','running')").run();
    transaction.prepare("INSERT INTO fx_workflow_plans(plan_id,attempt_id,state) VALUES('plan','work-attempt','planned')").run();
    transaction.prepare("INSERT INTO fx_plan_nodes(plan_id,node_id,effect_class) VALUES('plan','node',?)")
      .run(effectClass);
    transaction.prepare("INSERT INTO fx_workflow_events(event_id,plan_id,node_id,work_id,attempt_id,owner_domain,capability_ref,state,retry_at_ms) VALUES('event','plan','node','work','work-attempt','libra','libra.fixture@1',?,?)")
      .run(eventState, eventState === 'waiting_for_external' ? (settings.retryAtMs || 999) : null);
    const attemptState = eventState === 'executing' ? 'executing' : 'completed';
    if (!settings.missingAttempt) transaction.prepare("INSERT INTO fx_event_attempts(event_attempt_id,event_id,ordinal,state,outcome_kind,started_at_ms) VALUES('event-attempt','event',1,?,?,1)")
      .run(attemptState, attemptState === 'completed' ? 'deferred' : null);
    if (settings.journal) transaction.prepare("INSERT INTO fx_effect_journal(effect_id,event_attempt_id,effect_class,idempotency_key,intent_digest,state,updated_at_ms) VALUES('effect','event-attempt',?,'key',?, ?,1)")
      .run(effectClass, HASH, settings.effectState || 'intended');
    if (settings.secondJournal) transaction.prepare("INSERT INTO fx_effect_journal(effect_id,event_attempt_id,effect_class,idempotency_key,intent_digest,state,updated_at_ms) VALUES('effect-2','event-attempt',?,'key-2',?,'intended',1)")
      .run(effectClass, HASH);
    if (settings.defer) transaction.prepare("INSERT INTO fx_resource_defer(event_id,resource_key,queue_class,local_priority,enqueued_at_ms,retry_at_ms,state) VALUES('event','cpu','normal_foreground',0,1,2,'waiting')").run();
    if (settings.circuit) transaction.prepare("INSERT INTO fx_circuit_states(circuit_key,state,reason_code,evidence_digest,opened_at_ms) VALUES(?, 'open','FAULT',?,1)")
      .run(settings.circuit, 'b'.repeat(64));
  });
  if (settings.seedEvent === false && settings.circuit) kernel.runPrimitive((transaction) => {
    transaction.prepare("INSERT INTO fx_circuit_states(circuit_key,state,reason_code,evidence_digest,opened_at_ms) VALUES(?, 'open','FAULT',?,1)")
      .run(settings.circuit, 'b'.repeat(64));
  });
  const recovery = createStartupRecovery({
    schemaManifest,
    unitOfWork: createSqliteUnitOfWork({ kernel }),
    registry: { resolve() { if (settings.unknownContract) throw new Error('unknown'); return {}; } },
    policyRegistry: { bindingFor() { return { retryPolicyRef: 'retry', timeoutPolicyRef: 'timeout' }; } },
    integrityVerifier: { verify: () => ({ ok: settings.integrity !== false }) },
    catalogVerifier: { verify: (snapshot) => {
      if (typeof settings.onCatalogSnapshot === 'function') settings.onCatalogSnapshot(snapshot);
      return settings.catalog !== false;
    } },
    effectReconciler: { async reconcile() {
      if (settings.reconcilerUnavailable) throw new Error('unavailable');
      return { decision: 'continue_forward', evidenceDigest: 'c'.repeat(64) };
    } }
  });
  try { return run(recovery); }
  finally { kernel.close(); fs.rmSync(root, { recursive: true, force: true }); }
}

test('empty durable runtime becomes ready while bootstrapping never supplies normal Work', async () => fixture(async (recovery) => {
  assert.equal(recovery.readiness().state, 'bootstrapping');
  assert.equal(recovery.readiness().normalSupplyAllowed, false);
  assert.deepEqual(await recovery.recover(), {
    state: 'ready', normalSupplyAllowed: true, findings: [], actions: [], durableDefers: 0, nonterminalWorks: 0, nonterminalEvents: 0,
    recoveredInMemoryLeases: 0, recoveredInMemoryPermits: 0, recoveredInMemoryWaiters: 0
  });
}, { seedEvent: false }));

test('catalog verification receives the immutable Plan execution context', async () => {
  let observed;
  await fixture(async (recovery) => { await recovery.recover(); }, {
    onCatalogSnapshot: (snapshot) => { observed = snapshot; },
  });
  assert.equal(observed.plan.plan_id, 'plan');
  assert.equal(observed.workAttempt.attempt_id, 'work-attempt');
  assert.equal(observed.work.work_id, 'work');
  assert.equal(observed.nodes[0].capability_ref, null);
  assert.equal(observed.events[0].capability_ref, 'libra.fixture@1');
});

test('the exact UAT source Catalog continues only when every immutable node still resolves exactly', () => {
  const current = 'c'.repeat(64);
  const node = Object.freeze({ plan_id: 'plan', node_id: 'node', capability_ref: 'libra.fixture@1',
    contract_version: 1, effect_class: 'pure_observation', input_bindings_json: JSON.stringify({bindings:[{
      projectionRef:'helix://libra/input-projections/Fixture/v1',
    }]}) });
  const event = Object.freeze({ plan_id: 'plan', node_id: 'node', owner_domain: 'libra', capability_ref: 'libra.fixture@1' });
  const base = Object.freeze({ plan: Object.freeze({ catalog_digest: UAT_SOURCE_EXECUTION_CATALOG_DIGEST }),
    work: Object.freeze({ owner_domain: 'libra' }), nodes: Object.freeze([node]), events: Object.freeze([event]) });
  const registry = { resolve(ref, owner) {
    assert.equal(ref, 'libra.fixture@1'); assert.equal(owner, 'libra');
    return { manifest: { contractVersion: 1, effectClass: 'pure_observation' } };
  } };
  const policyRegistry = { bindingFor: () => ({ retryPolicyRef: 'retry', timeoutPolicyRef: 'timeout' }) };
  const projections = { resolve: (ref) => ref === 'helix://libra/input-projections/Fixture/v1' ? {} : (()=>{throw new Error('unknown');})() };
  assert.equal(verifyStartupPlanCatalog(base, current, registry, policyRegistry,projections), true);
  assert.equal(verifyStartupPlanCatalog({ ...base, plan: { catalog_digest: current } }, current, registry, policyRegistry,projections), true);
  assert.equal(verifyStartupPlanCatalog({ ...base, nodes: [{ ...node, effect_class: 'workspace_write' }] },
    current, registry, policyRegistry,projections), false);
  assert.equal(verifyStartupPlanCatalog({ ...base, events: [] }, current, registry, policyRegistry,projections), false);
  assert.equal(verifyStartupPlanCatalog({ ...base, nodes:[{...node,input_bindings_json:JSON.stringify({bindings:[{
    projectionRef:'helix://libra/input-projections/Missing/v1'}]})}]},current,registry,policyRegistry,projections),false);
});

test('a retired pre-projection Catalog is accepted only for terminal immutable Attempts', () => {
  const current = 'c'.repeat(64);
  const terminalEvent = Object.freeze({ plan_id:'old-plan',node_id:'node',state:'failed' });
  const base = Object.freeze({
    plan:Object.freeze({catalog_digest:PRE_PROJECTION_EXECUTION_CATALOG_DIGEST}),
    workAttempt:Object.freeze({state:'failed'}),
    events:Object.freeze([terminalEvent]),
  });
  assert.equal(verifyStartupPlanCatalog(base,current,{},{}),true);
  assert.equal(verifyStartupPlanCatalog({...base,workAttempt:{state:'running'}},current,{},{}),false);
  assert.equal(verifyStartupPlanCatalog({...base,events:[{...terminalEvent,state:'ready'}]},current,{},{}),false);
});

test('pure crash is classified safe_retry but readiness remains recovering until action converges', async () => fixture(async (recovery) => {
  const result = await recovery.recover();
  assert.equal(result.state, 'recovering');
  assert.equal(result.normalSupplyAllowed, false);
  assert.equal(result.actions[0].decision, 'safe_retry');
}));

test('non-pure recovery uses exact Effect reconciler and committed Effect is never rerun', async () => {
  await fixture(async (recovery) => {
    const result = await recovery.recover();
    assert.equal(result.state, 'recovering');
    assert.equal(result.actions[0].decision, 'continue_forward');
  }, { effectClass: 'material_commit', journal: true });
  await fixture(async (recovery) => {
    assert.equal((await recovery.recover()).actions[0].decision, 'already_committed');
  }, { effectClass: 'domain_fact_commit', journal: true, effectState: 'committed' });
});

test('executing Attempt with an abandoned Effect is completed, not a host fault', async () => fixture(async (recovery) => {
  const result = await recovery.recover();
  assert.equal(result.state, 'recovering');
  assert.equal(result.normalSupplyAllowed, false);
  assert.deepEqual(result.findings, []);
  assert.equal(result.actions[0].decision, 'already_failed');
  assert.equal(result.actions[0].effectId, 'effect');
}, { effectClass: 'workspace_write', journal: true, effectState: 'failed' }));

test('crash before non-pure intent is distinct from unknown effect point', async () => fixture(async (recovery) => {
  const result = await recovery.recover();
  assert.equal(result.actions[0].decision, 'safe_retry_before_intent');
  assert.equal(result.state, 'recovering');
}, { effectClass: 'external_request' }));

test('waiting external requires one Effect while resource wait requires one durable defer', async () => {
  await fixture(async (recovery) => {
    const result = await recovery.recover();
    assert.equal(result.state, 'ready');
    assert.equal(result.normalSupplyAllowed, true);
    assert.deepEqual(result.actions, []);
  }, { eventState: 'waiting_for_external', effectClass: 'pure_observation' });
  await fixture(async (recovery) => {
    const result = await recovery.recover();
    assert.equal(result.state, 'recovering');
    assert.equal(result.actions[0].decision, 'continue_forward');
  }, { eventState: 'waiting_for_external', effectClass: 'external_request', journal: true });
  await fixture(async (recovery) => {
    const result = await recovery.recover();
    assert.equal(result.state, 'faulted');
    assert.equal(result.findings[0], 'WAITING_EFFECT_MISSING:event');
  }, { eventState: 'waiting_for_external', effectClass: 'external_request' });
  await fixture(async (recovery) => {
    const result = await recovery.recover();
    assert.equal(result.state, 'ready');
    assert.equal(result.durableDefers, 1);
  }, { eventState: 'waiting_for_resource', defer: true });
  await fixture(async (recovery) => {
    assert.equal((await recovery.recover()).findings.includes('RESOURCE_DEFER_CARDINALITY:event'), true);
  }, { eventState: 'waiting_for_resource' });
});

test('input wait without an Event Attempt remains recoverable through its durable retry time', async () => fixture(async (recovery) => {
  assert.deepEqual(await recovery.recover(), {
    state: 'ready', normalSupplyAllowed: true, findings: [], actions: [], durableDefers: 0, nonterminalWorks: 1, nonterminalEvents: 1,
    recoveredInMemoryLeases: 0, recoveredInMemoryPermits: 0, recoveredInMemoryWaiters: 0
  });
}, { eventState: 'waiting_for_external', missingAttempt: true, retryAtMs: 999 }));

test('multiple effects, unavailable reconciler, unknown contract, global Circuit, and integrity drift fail closed', async () => {
  for (const [settings, finding] of [
    [{ effectClass: 'material_commit', journal: true, secondJournal: true }, 'MULTIPLE_EFFECTS_PER_ATTEMPT:event'],
    [{ effectClass: 'material_commit', journal: true, reconcilerUnavailable: true }, 'RECONCILER_UNAVAILABLE:event'],
    [{ unknownContract: true }, 'UNKNOWN_EVENT_CONTRACT:event']
  ]) await fixture(async (recovery) => {
    const result = await recovery.recover();
    assert.equal(result.normalSupplyAllowed, false);
    assert.equal(result.findings.includes(finding), true);
  }, settings);
  await fixture(async (recovery) => assert.equal((await recovery.recover()).state, 'faulted'), { circuit: 'foundation/event-dispatch' });
  await fixture(async (recovery) => assert.equal((await recovery.recover()).state, 'faulted'), { integrity: false });
  await fixture(async (recovery) => assert.equal((await recovery.recover()).findings.includes('PLAN_CATALOG_DRIFT:plan'), true), { catalog: false });
  await fixture(async (recovery) => assert.equal((await recovery.recover()).findings.includes('ORPHAN_OR_UNKNOWN_EVENT_FACT:event'), true),
    { effectClass: 'unknown_effect' });
  await fixture(async (recovery) => assert.equal(
    (await recovery.recover()).findings.includes('NONTERMINAL_EFFECT_WITHOUT_RECOVERY_EVENT:effect'), true),
  { eventState: 'failed', effectClass: 'material_commit', journal: true });
});

test('scoped Circuit yields degraded fail-closed readiness and no in-memory guard resurrection', async () => fixture(async (recovery) => {
  const result = await recovery.recover();
  assert.equal(result.state, 'degraded');
  assert.equal(result.normalSupplyAllowed, false);
  assert.equal(result.recoveredInMemoryLeases + result.recoveredInMemoryPermits + result.recoveredInMemoryWaiters, 0);
}, { seedEvent: false, circuit: 'owner/libra/event-dispatch' }));

test('startup source is read-only classification and contains no bulk reset or in-memory guard restore', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../src/helix/foundation/execution/startup-recovery.js'), 'utf8').toLowerCase();
  for (const forbidden of ["kind: 'update'", 'state: \'ready\'', 'recoverpermit', 'recoverwaiter', '../domains', 'fallback']) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});
