'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const test = require('node:test');
const Database = require('better-sqlite3');
const { createCircuitBreaker, createPressureGuard, evaluatePressureSample } = require('../../src/helix/foundation/diagnostics/pressure-guard');
const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const rootGenerated = path.resolve(__dirname, '../../src/helix/foundation/persistence/generated');
const schemaDdl = fs.readFileSync(path.join(rootGenerated, 'clean-schema.sql'), 'utf8');
const schemaManifest = JSON.parse(fs.readFileSync(path.join(rootGenerated, 'clean-schema.manifest.json'), 'utf8'));
const HASH = 'a'.repeat(64); const HASH2 = 'b'.repeat(64);
function fixture(run) { const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-circuit-')); const databasePath=path.join(root,'db.sqlite');
  let now=1700000004000; const kernel=openSqliteKernel({Database,databasePath,schemaDdl,schemaManifest,now:()=>now++});
  const breaker=createCircuitBreaker({schemaManifest,unitOfWork:createSqliteUnitOfWork({kernel})});
  try{return run({breaker,databasePath});} finally{kernel.close();fs.rmSync(root,{recursive:true,force:true});} }
function sample(overrides={}) { return { circuitKey:'scope:one',evidenceDigest:HASH,correctnessViolation:false,duplicateWaiter:false,
  duplicateExecutingAttempt:false,duplicateImmutableResult:false,hardCapConsecutive10s:0,writeRatePerSecond:0,writeRateDurationMs:0,
  terminalRatePerSecond:0,creationRatePerSecond:0,capacityAvailable:false,oldestWaiterAgeMs:0,backgroundEligible:false,
  backgroundNoProgressMs:0,walBytes:0,walGrowingConsecutive5m:0,permitConserved:true,...overrides}; }
test('correctness and exact pressure thresholds produce stable typed triggers',()=>{
  assert.deepEqual(evaluatePressureSample(sample({correctnessViolation:true})).map(x=>x.reasonCode),['CORRECTNESS_INVARIANT_VIOLATION']);
  assert.equal(evaluatePressureSample(sample({hardCapConsecutive10s:2})).length,0);
  assert.equal(evaluatePressureSample(sample({hardCapConsecutive10s:3}))[0].reasonCode,'HARD_CAP_PERSISTED');
  assert.equal(evaluatePressureSample(sample({writeRatePerSecond:101,writeRateDurationMs:60000,creationRatePerSecond:20,terminalRatePerSecond:1}))[0].reasonCode,'WRITE_RATE_DIVERGENCE');
  assert.equal(evaluatePressureSample(sample({capacityAvailable:true,oldestWaiterAgeMs:1800000}))[0].reasonCode,'WAITER_STARVATION');
  assert.equal(evaluatePressureSample(sample({backgroundEligible:true,capacityAvailable:true,backgroundNoProgressMs:600000}))[0].reasonCode,'BACKGROUND_STARVATION');
  assert.equal(evaluatePressureSample(sample({walBytes:1073741825,walGrowingConsecutive5m:3}))[0].reasonCode,'WAL_GROWTH');
  assert.equal(evaluatePressureSample(sample({permitConserved:false}))[0].reasonCode,'PERMIT_ACCOUNTING_LEAK');
  assert.throws(()=>evaluatePressureSample({...sample(),extra:true}),{code:'P4_PRESSURE_SAMPLE_INVALID'});
});
test('Circuit persists across reads and closes only through recovering with proof',()=>fixture(({breaker})=>{
  assert.equal(breaker.open({circuitKey:'scope:one',reasonCode:'HARD_CAP_PERSISTED',evidenceDigest:HASH}).state,'open');
  assert.equal(breaker.read('scope:one').state,'open');
  assert.throws(()=>breaker.close({circuitKey:'scope:one',invariantRestored:true,reconcileEvidenceDigest:HASH2}),{code:'P4_CIRCUIT_CLOSE_PROOF_REQUIRED'});
  assert.equal(breaker.beginRecovery({circuitKey:'scope:one',evidenceDigest:HASH2}).state,'recovering');
  assert.equal(breaker.close({circuitKey:'scope:one',invariantRestored:true,reconcileEvidenceDigest:HASH2}).state,'closed');
}));
test('open replay is stable and conflicting evidence cannot be silently replaced',()=>fixture(({breaker})=>{
  const request={circuitKey:'scope:one',reasonCode:'DUPLICATE_RUNTIME_AUTHORITY',evidenceDigest:HASH};
  assert.equal(breaker.open(request).opened_at_ms,breaker.open(request).opened_at_ms);
  assert.throws(()=>breaker.open({...request,evidenceDigest:HASH2}),{code:'P4_CIRCUIT_OPEN_EVIDENCE_CONFLICT'});
}));
test('open Circuit blocks new ordinary and commit effects but preserves bounded recovery lanes',()=>fixture(({breaker})=>{
  breaker.open({circuitKey:'scope:one',reasonCode:'CORRECTNESS_INVARIANT_VIOLATION',evidenceDigest:HASH});
  const base={circuitKey:'scope:one',priorityClass:'normal_foreground',effectClass:'domain_fact_commit',started:false,
    irreversibleBoundaryCrossed:false,mode:'ordinary'};
  assert.equal(breaker.allows(base).allowed,false);
  assert.equal(breaker.allows({...base,mode:'diagnostic'}).allowed,true);
  assert.equal(breaker.allows({...base,mode:'reconcile'}).allowed,true);
  assert.equal(breaker.allows({...base,mode:'forward_recovery',effectClass:'destructive_commit',started:true,irreversibleBoundaryCrossed:true}).allowed,true);
  assert.equal(breaker.allows({...base,mode:'forward_recovery',effectClass:'destructive_commit',started:false,irreversibleBoundaryCrossed:true}).allowed,false);
}));
test('Pressure Guard opens circuits but never deletes queue, mutates Event, or fabricates Result',()=>fixture(({breaker,databasePath})=>{
  const guard=createPressureGuard({breaker}); assert.equal(guard.inspect(sample({hardCapConsecutive10s:3}))[0].state,'open');
  const db=new Database(databasePath,{readonly:true}); try{assert.equal(db.prepare('SELECT COUNT(*) count FROM fx_circuit_states').get().count,1);}finally{db.close();}
  const source=fs.readFileSync(path.resolve(__dirname,'../../src/helix/foundation/diagnostics/pressure-guard.js'),'utf8').toLowerCase();
  for(const forbidden of ['delete from','fx_workflow_events','fx_event_result_bindings','../domains','fallback']) assert.equal(source.includes(forbidden),false,forbidden);
}));
test('multiple simultaneous findings open one stable Circuit rather than conflicting writes',()=>fixture(({breaker})=>{
  const guard=createPressureGuard({breaker}); const result=guard.inspect(sample({hardCapConsecutive10s:3,permitConserved:false}));
  assert.equal(result.length,1); assert.equal(result[0].reason_code,'MULTIPLE_GUARD_VIOLATIONS');
}));
