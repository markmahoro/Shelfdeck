'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { createStartupRecovery } = require('../../src/helix/foundation/execution/startup-recovery');
const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');

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
    transaction.prepare("INSERT INTO fx_supporting_works(work_id,state) VALUES('work',?)")
      .run(settings.workState || 'running');
    transaction.prepare("INSERT INTO fx_work_attempts(attempt_id,work_id,state) VALUES('work-attempt','work',?)")
      .run(settings.workAttemptState || 'running');
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
    if (settings.supersededFailedJournal) {
      transaction.prepare("INSERT INTO fx_event_attempts(event_attempt_id,event_id,ordinal,state,outcome_kind,started_at_ms) VALUES('event-attempt-old','event',0,'completed','failed',1)").run();
      transaction.prepare("INSERT INTO fx_effect_journal(effect_id,event_attempt_id,effect_class,idempotency_key,intent_digest,state,updated_at_ms) VALUES('effect-old','event-attempt-old',?,'key-old',?,'reconcile_required',1)")
        .run(effectClass, HASH);
    }
    if (settings.defer) transaction.prepare("INSERT INTO fx_resource_defer(event_id,resource_key,queue_class,local_priority,enqueued_at_ms,retry_at_ms,state) VALUES('event','cpu','normal_foreground',0,1,2,'waiting')").run();
    if (settings.circuit) transaction.prepare("INSERT INTO fx_circuit_states(circuit_key,state,reason_code,evidence_digest,opened_at_ms) VALUES(?, 'open','FAULT',?,1)")
      .run(settings.circuit, 'b'.repeat(64));
  });
  if (settings.seedEvent === false && settings.circuit) kernel.runPrimitive((transaction) => {
    transaction.prepare("INSERT INTO fx_circuit_states(circuit_key,state,reason_code,evidence_digest,opened_at_ms) VALUES(?, 'open','FAULT',?,1)")
      .run(settings.circuit, 'b'.repeat(64));
  });
  if (settings.standaloneJournal) kernel.runPrimitive((transaction) => {
    transaction.prepare("INSERT INTO fx_effect_journal(effect_id,event_attempt_id,effect_class,idempotency_key,intent_digest,state,external_receipt_ref,output_digest,verified_at_ms,updated_at_ms) VALUES('standalone-effect',NULL,?,'standalone-key',?,?,?, ?,1,1)")
      .run(settings.standaloneEffectClass || 'standalone.cleanup', HASH,
        settings.standaloneEffectState || 'committed',
        settings.standaloneEffectState === 'committed' ? 'receipt' : null,
        settings.standaloneEffectState === 'committed' ? HASH : null);
  });
  settings.setup?.(kernel);
  const recovery = createStartupRecovery({
    schemaManifest,
    unitOfWork: createSqliteUnitOfWork({ kernel }),
    registry: { resolve() { if (settings.unknownContract) throw new Error('unknown'); return {}; } },
    policyRegistry: { bindingFor() { return { retryPolicyRef: 'retry', timeoutPolicyRef: 'timeout' }; } },
    integrityVerifier: { verify: () => ({ ok: settings.integrity !== false }) },
    catalogVerifier: { ...(settings.verifyBatch ? { verifyBatch:settings.verifyBatch } : {}), verify: (snapshot) => {
      if (typeof settings.onCatalogSnapshot === 'function') settings.onCatalogSnapshot(snapshot);
      return settings.catalog !== false;
    } },
    standaloneEffectClasses: settings.standaloneEffectClasses || [],
    effectJournal: settings.effectJournal,
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

test('closed unrelated history is excluded from startup contract verification', async () => {
  let inspected = 0;
  await fixture(async recovery => {
    const result = await recovery.recover();
    assert.equal(result.state, 'ready');
    assert.equal(inspected, 0);
  }, { workState: 'succeeded', workAttemptState: 'succeeded', eventState: 'succeeded',
    journal: true, effectState: 'committed', catalog: false, onCatalogSnapshot: () => inspected++ });
});

test('an active Work does not pull every closed prior Attempt into startup without a dependency', async () => {
  const inspected = [];
  await fixture(async recovery => {
    await recovery.recover();
    assert.deepEqual(inspected, ['plan']);
  }, { eventState: 'ready', onCatalogSnapshot: snapshot => inspected.push(snapshot.plan.plan_id), setup(kernel) {
    kernel.runPrimitive(db => {
      db.prepare("UPDATE fx_work_attempts SET ordinal=2 WHERE attempt_id='work-attempt'").run();
      db.prepare("INSERT INTO fx_work_attempts(attempt_id,work_id,ordinal,state) VALUES('old-attempt','work',1,'failed')").run();
      db.prepare("INSERT INTO fx_workflow_plans(plan_id,attempt_id,state) VALUES('old-plan','old-attempt','contract_unplannable')").run();
    });
  } });
});

test('terminal Work with an unresolved Effect remains a startup responsibility root', async () => {
  let inspected = 0;
  await fixture(async recovery => {
    const result = await recovery.recover();
    assert.equal(result.state, 'faulted');
    assert.ok(result.findings.includes('PLAN_CATALOG_DRIFT:plan'));
    assert.equal(inspected, 1);
  }, { workState: 'failed', workAttemptState: 'failed', eventState: 'failed',
    journal: true, effectState: 'reconcile_required', catalog: false, onCatalogSnapshot: () => inspected++ });
});

test('ready Event remains a startup responsibility even when its parent claims terminal', async () => {
  let inspected = 0;
  await fixture(async recovery => {
    const result = await recovery.recover();
    assert.equal(result.state, 'faulted');
    assert.ok(result.findings.includes('PLAN_CATALOG_DRIFT:plan'));
    assert.equal(inspected, 1);
  }, { workState: 'succeeded', workAttemptState: 'succeeded', eventState: 'ready',
    catalog: false, onCatalogSnapshot: () => inspected++ });
});

test('startup Effect membership remains linear in retained Event Attempt history', async () => {
  const count=1000;
  let inspected=0;
  const attempts=new Proxy(Array.from({length:count},(_,index)=>({event_attempt_id:'attempt-'+index,event_id:'event-'+index,
    ordinal:1,state:'completed',outcome_kind:'succeeded'})),{get(target,key,receiver){
    if(typeof key==='string'&&/^[0-9]+$/.test(key))inspected++;
    return Reflect.get(target,key,receiver);
  }});
  const facts={works:[{work_id:'work',state:'succeeded'}],workAttempts:[{attempt_id:'work-attempt',work_id:'work',state:'succeeded'}],
    plans:[{plan_id:'plan',attempt_id:'work-attempt',state:'planned'}],
    nodes:Array.from({length:count},(_,index)=>({plan_id:'plan',node_id:'node-'+index,effect_class:'workspace_write'})),
    events:Array.from({length:count},(_,index)=>({event_id:'event-'+index,plan_id:'plan',node_id:'node-'+index,
      work_id:'work',attempt_id:'work-attempt',state:'succeeded'})),attempts,
    effects:Array.from({length:count},(_,index)=>({effect_id:'effect-'+index,event_attempt_id:'attempt-'+index,
      effect_class:'workspace_write',state:'committed'})),defers:[],circuits:[]};
  const recovery=createStartupRecovery({schemaManifest,unitOfWork:{execute:()=>({startup_responsibility_snapshot:facts})},
    registry:{resolve:()=>({})},policyRegistry:{bindingFor:()=>({})},integrityVerifier:{verify:()=>({ok:true})},
    catalogVerifier:{verify:()=>true},effectReconciler:{reconcile(){throw Error('Terminal history must not be replayed.');}}});
  const result=await recovery.recover();
  assert.equal(result.state,'ready');assert.deepEqual(result.findings,[]);assert.deepEqual(result.actions,[]);
  assert.ok(inspected<=count*4,'Checking each Effect must not rescan all retained Event Attempts.');
});

test('registered standalone cleanup Effects are owned by fallback recovery, while unknown orphans still block startup', async () => {
  await fixture(async (recovery) => {
    const result = await recovery.recover();
    assert.equal(result.state, 'ready');
    assert.deepEqual(result.findings, []);
  }, { seedEvent:false, standaloneJournal:true,
    standaloneEffectClasses:['standalone.cleanup'] });
  await fixture(async (recovery) => {
    const result = await recovery.recover();
    assert.equal(result.state, 'ready');
    assert.deepEqual(result.findings, []);
  }, { seedEvent:false, standaloneJournal:true,
    standaloneEffectState:'intended', standaloneEffectClasses:['standalone.cleanup'] });
  await fixture(async (recovery) => {
    const result = await recovery.recover();
    assert.equal(result.state, 'faulted');
    assert.equal(result.findings.includes('ORPHAN_EFFECT:standalone-effect'), true);
  }, { seedEvent:false, standaloneJournal:true });
});

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

test('startup batch verification requires an explicit decision for every Plan', async () => {
  for (const invalid of [[], [true, true], null, {0:true,length:1}]) {
    await fixture(async recovery => {
      await assert.rejects(recovery.recover(), {code:'P4_STARTUP_CATALOG_BATCH_INVALID'});
    }, {verifyBatch:() => invalid});
  }
  for (const decision of [false, undefined, 1, 'true']) {
    await fixture(async recovery => {
      const result = await recovery.recover();
      assert.equal(result.state, 'faulted');
      assert(result.findings.includes('PLAN_CATALOG_DRIFT:plan'));
    }, {verifyBatch:snapshots => {
      assert.equal(snapshots.length, 1);
      assert.equal(snapshots[0].plan.plan_id, 'plan');
      return [decision];
    }});
  }
  await fixture(async recovery => {
    assert.equal((await recovery.recover()).state, 'ready');
  }, {eventState:'succeeded', workState:'succeeded', workAttemptState:'succeeded',
    catalog:false, verifyBatch:snapshots => snapshots.map(() => true)});
});

test('normal runtime contains no dated Catalog archives or release-specific recovery allowlist', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../src/helix/composition/create-procurement-execution-runtime.js'), 'utf8');
  for (const forbidden of ['catalog-transitions/', 'COMPATIBLE_PREVIOUS_EXECUTION_CATALOG_DIGESTS',
    'verifyStartupPlanCatalog', 'PRE_PROJECTION_PLAN_REPLAN_CODE', 'P4_UAT_INTAKE_BINDING_RESULT_REPLAN_REQUIRED'])
    assert.equal(source.includes(forbidden), false, forbidden);
  assert.ok(source.includes('createStoredPlanContractVerifier'));
  assert.ok(source.includes('createPlanHistoryAudit'));
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
    const action = (await recovery.recover()).actions[0];
    assert.equal(action.decision, 'already_committed');
    assert.equal(action.effectId, 'effect');
  }, { effectClass: 'domain_fact_commit', journal: true, effectState: 'committed' });
});

test('startup classifies only a safely terminal cancelled-Work Attempt for lifecycle repair', async () => {
  await fixture(async (recovery) => {
    const result = await recovery.recover();
    assert.equal(result.state, 'recovering');
    assert.equal(result.normalSupplyAllowed, false);
    assert.deepEqual(result.findings, []);
    assert.deepEqual(result.actions, []);
    assert.deepEqual(result.workAttemptRepairs, [{
      workId:'work', attemptId:'work-attempt', reasonCode:'P4_CANCELLED_WORK_ATTEMPT_RECOVERED',
    }]);
  }, { workState:'cancelled', workAttemptState:'running', eventState:'cancelled' });

  await fixture(async (recovery) => {
    const result = await recovery.recover();
    assert.equal(result.state, 'faulted');
    assert.equal(result.findings.includes('CANCELLED_WORK_ACTIVE_ATTEMPT_UNSAFE:work-attempt'), true);
  }, { workState:'cancelled', workAttemptState:'running', eventState:'executing' });
});

test('waiting Event after an abandoned Effect remains recoverable ordinary supply', async () => fixture(async (recovery) => {
  const result = await recovery.recover();
  assert.equal(result.state, 'ready');
  assert.equal(result.normalSupplyAllowed, true);
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.actions, []);
}, { effectClass: 'workspace_write', journal: true, effectState: 'failed', eventState: 'waiting_for_external' }));

test('startup still fails closed when a terminal Event owns an unrepaired waiting Resource Defer', async () => fixture(async (recovery) => {
  const result = await recovery.recover();
  assert.equal(result.state, 'faulted');
  assert.equal(result.normalSupplyAllowed, false);
  assert.equal(result.findings.includes('RESOURCE_DEFER_STATE_DRIFT:event'), true);
}, { eventState:'cancelled', defer:true }));

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
    (await recovery.recover()).findings.includes('NONTERMINAL_EFFECT_WITHOUT_RECOVERY_EVENT:effect'), false),
  { eventState: 'failed', effectClass: 'material_commit', journal: true });
});

test('startup abandons leftover Effects on superseded failed Attempts of a live Event', async () => {
  const liveSettings = {
    eventState: 'waiting_for_external',
    effectClass: 'workspace_write',
    journal: true,
    supersededFailedJournal: true,
  };
  await fixture(async (recovery) => {
    const result = await recovery.recover();
    assert.equal(result.findings.includes('NONTERMINAL_EFFECT_WITHOUT_RECOVERY_EVENT:effect-old'), true);
    assert.equal(result.state, 'faulted');
  }, liveSettings);
  const abandoned = [];
  await fixture(async (recovery) => {
    const result = await recovery.recover();
    assert.equal(result.findings.includes('NONTERMINAL_EFFECT_WITHOUT_RECOVERY_EVENT:effect-old'), false);
    assert.equal(result.state, 'recovering');
    assert.deepEqual(abandoned, ['effect-old']);
  }, {
    ...liveSettings,
    effectJournal: { abandonUncommitted(id) { abandoned.push(id); return { state: 'failed' }; } },
  });
});

test('scoped Circuit yields isolated degraded readiness and no in-memory guard resurrection', async () => fixture(async (recovery) => {
  const result = await recovery.recover();
  assert.equal(result.state, 'degraded');
  assert.equal(result.normalSupplyAllowed, true);
  assert.equal(result.recoveredInMemoryLeases + result.recoveredInMemoryPermits + result.recoveredInMemoryWaiters, 0);
}, { seedEvent: false, circuit: 'owner/libra/event-dispatch' }));

test('startup source is read-only classification and contains no bulk reset or in-memory guard restore', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../src/helix/foundation/execution/startup-recovery.js'), 'utf8').toLowerCase();
  for (const forbidden of ["kind: 'update'", 'state: \'ready\'', 'recoverpermit', 'recoverwaiter', '../domains', 'fallback']) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});
