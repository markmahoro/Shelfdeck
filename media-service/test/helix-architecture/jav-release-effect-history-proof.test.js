'use strict';

const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const Database=require('better-sqlite3');
const {historicalSchema}=require('../fixtures/helix-historical-ddl/schema-snapshot');
const {SOURCE_DIGEST}=require('../../scripts/helix-architecture/jav-release-schema-copy');
const {proveReleaseEffectHistory}=require('../../scripts/helix-architecture/jav-release-effect-history-proof');
const schema=historicalSchema(SOURCE_DIGEST).schemaManifest;

test('release proof requires a snapshot and never exempts unknown or unbounded effects',()=>{
  const db=new Database(':memory:');
  try {
    db.exec(historicalSchema(SOURCE_DIGEST).schemaDdl);
    assert.throws(()=>proveReleaseEffectHistory(db,schema),/read snapshot/);
    db.exec('BEGIN');
    assert.deepEqual(proveReleaseEffectHistory(db,schema).provenEffectIds,[]);
    db.prepare("INSERT INTO fx_effect_journal(effect_id,effect_class,state) VALUES('unknown','destructive_commit','reconcile_required')").run();
    assert.deepEqual(proveReleaseEffectHistory(db,schema).provenEffectIds,[]);
    for(let i=0;i<100;i++)db.prepare("INSERT INTO fx_effect_journal(effect_id,effect_class,state) VALUES(?,'workspace_write','reconcile_required')").run('extra-'+i);
    const result=proveReleaseEffectHistory(db,schema);
    assert.deepEqual(result.provenEffectIds,[]);assert.equal(result.reasonCode,'history_scope_bound_exceeded');
    db.exec('ROLLBACK');
  }finally{db.close();}
});

const snapshot=process.env.HELIX_RELEASE_HISTORY_SNAPSHOT;
test('complete historical snapshot proves successors and rejects missing, drifting or live responsibility without changing its source',{
  skip:!snapshot?'Set HELIX_RELEASE_HISTORY_SNAPSHOT to a frozen complete historical snapshot':false,timeout:240000,
},async t=>{
  const source=path.resolve(snapshot),root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-history-proof-'));
  let db;
  t.after(()=>{db?.close();assert.equal(path.dirname(root),path.resolve(os.tmpdir()));fs.rmSync(root,{recursive:true,force:true});});
  assert.ok(!fs.existsSync(source+'-wal')||fs.statSync(source+'-wal').size===0,'Use a checkpointed cold snapshot.');
  const hash=async file=>{const h=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file))h.update(chunk);return h.digest('hex');};
  const before=await hash(source),copy=path.join(root,'copy.sqlite');fs.copyFileSync(source,copy);
  db=new Database(copy);db.pragma('foreign_keys=OFF');
  db.exec('BEGIN');const baseline=proveReleaseEffectHistory(db,schema);db.exec('ROLLBACK');
  assert.ok(baseline.provenEffectIds.length>0);
  const target=baseline.observations[0];
  const original=db.prepare('SELECT * FROM fx_effect_journal WHERE effect_id=?').get(target.effectId);
  const event=db.prepare('SELECT e.* FROM fx_workflow_events e JOIN fx_event_attempts a ON a.event_id=e.event_id WHERE a.event_attempt_id=?').get(original.event_attempt_id);
  const work=db.prepare('SELECT * FROM fx_supporting_works WHERE work_id=?').get(event.work_id);
  const cases=[
    ['missing successor result',()=>db.prepare('DELETE FROM fx_event_result_bindings WHERE result_id=?').run(target.sourceResultId)],
    ['changed original intent',()=>db.prepare('UPDATE fx_effect_journal SET intent_digest=? WHERE effect_id=?').run('0'.repeat(64),target.effectId)],
    ['uncommitted Owner',()=>db.prepare("UPDATE arca_ondeck_runs SET state='blocked' WHERE on_deck_run_id=?").run(work.process_id)],
    ['missing Owner commit',()=>db.prepare('DELETE FROM arca_ondeck_commit_receipts WHERE on_deck_run_id=?').run(work.process_id)],
    ['active Work',()=>db.prepare("UPDATE fx_supporting_works SET state='running' WHERE work_id=?").run(work.work_id)],
    ['unknown Catalog',()=>db.prepare('UPDATE fx_workflow_plans SET catalog_digest=? WHERE plan_id=?').run('0'.repeat(64),event.plan_id)],
    ['changed successor result digest',()=>db.prepare('UPDATE fx_event_result_bindings SET result_digest=? WHERE result_id=?').run('0'.repeat(64),target.sourceResultId)],
    ['missing final Commit result',()=>db.prepare('DELETE FROM fx_event_result_bindings WHERE result_id=?').run(target.sourceCommitResultId)],
  ];
  for(const [name,mutate] of cases)await t.test(name,()=>{
    db.exec('BEGIN');try{mutate();const rejected=proveReleaseEffectHistory(db,schema);assert.ok(!rejected.provenEffectIds.includes(target.effectId));}
    finally{db.exec('ROLLBACK');}
  });
  db.exec('BEGIN');assert.deepEqual(proveReleaseEffectHistory(db,schema),baseline);db.exec('ROLLBACK');
  assert.deepEqual(db.prepare('SELECT * FROM fx_effect_journal WHERE effect_id=?').get(target.effectId),original);
  assert.equal(await hash(source),before);assert.equal(await hash(copy),before);
  t.diagnostic(JSON.stringify({provenEffects:baseline.provenEffectIds.length,proofDigest:baseline.proofDigest,negativeCases:cases.length,sourceUnchanged:true}));
});
