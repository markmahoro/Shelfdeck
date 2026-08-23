'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { digest } = require('../src/helix/foundation/persistence/ddl-compiler');
const { repairTerminalResourceDefers } = require(
  '../src/helix/foundation/persistence/execution-consistency-repair'
);
const { openSqliteKernel } = require('../src/helix/foundation/persistence/sqlite-kernel');

const generatedRoot = path.resolve(__dirname, '../src/helix/foundation/persistence/generated');
const schemaDdl = fs.readFileSync(path.join(generatedRoot, 'clean-schema.sql'), 'utf8');
const schemaManifest = JSON.parse(fs.readFileSync(path.join(generatedRoot, 'clean-schema.manifest.json'), 'utf8'));

function fixture(run, eventState = 'cancelled') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-execution-repair-'));
  const databasePath = path.join(root, 'shelfdeck.db');
  const kernel = openSqliteKernel({ Database, databasePath, schemaDdl, schemaManifest, now: () => 100 });
  kernel.close();
  const database = new Database(databasePath);
  database.prepare("INSERT INTO fx_supporting_works(work_id,owner_domain,state) VALUES('work','libra','cancelled')").run();
  database.prepare("INSERT INTO fx_work_attempts(attempt_id,work_id,state) VALUES('attempt','work','cancelled')").run();
  database.prepare("INSERT INTO fx_workflow_plans(plan_id,attempt_id,state) VALUES('plan','attempt','planned')").run();
  database.prepare(`INSERT INTO fx_workflow_events
    (event_id,plan_id,node_id,work_id,attempt_id,owner_domain,state,retry_at_ms)
    VALUES('event','plan','node','work','attempt','libra',?,999)`).run(eventState);
  const insertDefer = database.prepare(`INSERT INTO fx_resource_defer
    (event_id,resource_key,queue_class,local_priority,enqueued_at_ms,retry_at_ms,state)
    VALUES('event',?,'normal_foreground',0,1,999,'waiting')`);
  insertDefer.run('cpu');
  insertDefer.run('volume:test');
  database.close();
  try { return run({ databasePath }); }
  finally { fs.rmSync(root, { recursive:true, force:true }); }
}

test('terminal Resource Defer repair is exact, audited, and idempotent', () => fixture(({ databasePath }) => {
  assert.deepEqual(repairTerminalResourceDefers({ Database, databasePath, now:() => 200 }),
    { repairedEvents:1, repairedDefers:2 });
  const database = new Database(databasePath, { readonly:true });
  try {
    assert.deepEqual(database.prepare('SELECT resource_key,state FROM fx_resource_defer ORDER BY resource_key').all(),
      [{resource_key:'cpu',state:'cancelled'},{resource_key:'volume:test',state:'cancelled'}]);
    assert.deepEqual(database.prepare("SELECT state,retry_at_ms FROM fx_workflow_events WHERE event_id='event'").get(),
      {state:'cancelled',retry_at_ms:null});
    const audit = database.prepare(`SELECT owner_domain,actor_type,actor_id,action,scope_type,scope_id,work_id,event_id,occurred_at_ms
      FROM fx_audit_records WHERE action='terminal_resource_defers_cancelled'`).get();
    assert.deepEqual(audit, {owner_domain:'libra',actor_type:'system',actor_id:'execution-consistency-repair@1',
      action:'terminal_resource_defers_cancelled',scope_type:'workflow_event',scope_id:'event',work_id:'work',event_id:'event',
      occurred_at_ms:200});
  } finally { database.close(); }
  assert.deepEqual(repairTerminalResourceDefers({ Database, databasePath, now:() => 201 }),
    { repairedEvents:0, repairedDefers:0 });
}));

test('repair transaction rolls back all defer mutations when its audit fence conflicts', () => fixture(({ databasePath }) => {
  const evidenceDigest = digest({schema:'helix.execution-terminal-resource-defer-repair-evidence@1',eventId:'event',
    eventState:'cancelled',resourceKeys:['cpu','volume:test']});
  const database = new Database(databasePath);
  database.prepare(`INSERT INTO fx_audit_records
    (audit_id,owner_domain,actor_type,actor_id,action,scope_type,scope_id,work_id,event_id,evidence_digest,occurred_at_ms)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(`execution-terminal-defer-repair:${evidenceDigest}`,'libra','system','fixture',
    'fixture','workflow_event','event','work','event',evidenceDigest,150);
  database.close();
  assert.throws(() => repairTerminalResourceDefers({ Database, databasePath, now:() => 200 }), /UNIQUE/);
  const check = new Database(databasePath, { readonly:true });
  try {
    assert.deepEqual(check.prepare('SELECT state FROM fx_resource_defer ORDER BY resource_key').all(),
      [{state:'waiting'},{state:'waiting'}]);
    assert.equal(check.prepare("SELECT retry_at_ms FROM fx_workflow_events WHERE event_id='event'").get().retry_at_ms, 999);
  } finally { check.close(); }
}));

test('nonterminal Event drift is not silently repaired', () => fixture(({ databasePath }) => {
  assert.deepEqual(repairTerminalResourceDefers({ Database, databasePath, now:() => 200 }),
    { repairedEvents:0, repairedDefers:0 });
  const database = new Database(databasePath, { readonly:true });
  try {
    assert.equal(database.prepare("SELECT COUNT(*) count FROM fx_resource_defer WHERE state='waiting'").get().count, 2);
    assert.equal(database.prepare("SELECT COUNT(*) count FROM fx_audit_records WHERE action='terminal_resource_defers_cancelled'").get().count, 0);
  } finally { database.close(); }
}, 'waiting_for_external'));
