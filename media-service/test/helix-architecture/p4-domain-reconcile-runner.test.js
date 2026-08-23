'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { createDomainReconcileRunner } = require('../../src/helix/foundation/execution/domain-reconcile-runner');
const { createReconcileCursorStore } = require('../../src/helix/foundation/execution/reconcile-cursor-store');
const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');

const generatedRoot = path.resolve(__dirname, '../../src/helix/foundation/persistence/generated');
const schemaDdl = fs.readFileSync(path.join(generatedRoot, 'clean-schema.sql'), 'utf8');
const schemaManifest = JSON.parse(fs.readFileSync(path.join(generatedRoot, 'clean-schema.manifest.json'), 'utf8'));

function open(databasePath) {
  const kernel = openSqliteKernel({ Database, databasePath, schemaDdl, schemaManifest, now: () => 1700000000000 });
  const unitOfWork = createSqliteUnitOfWork({ kernel });
  return { kernel, cursorStore:createReconcileCursorStore({ schemaManifest, unitOfWork, now:() => 1700000000100 }) };
}

test('205 active Process scopes sweep in three bounded pages and resume from the durable cursor after restart', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-reconcile-cursor-'));
  const databasePath = path.join(root, 'shelfdeck.db');
  const scopes = Array.from({length:205},(_,index)=>Object.freeze({
    cursor:String(index+1).padStart(4,'0'),scope:Object.freeze({processId:'process-'+String(index+1).padStart(4,'0')})
  }));
  const seen=[];
  const registration=Object.freeze({ownerDomain:'procurement',reconcilerKey:'active-runs',
    listPage({cursor,limit}){const start=cursor===null?0:scopes.findIndex((item)=>item.cursor===cursor)+1;return scopes.slice(start,start+limit);},
    async reconcile(scope){seen.push(scope.processId);}});
  let first=open(databasePath);
  let runner=createDomainReconcileRunner({cursorStore:first.cursorStore,registrations:[registration],now:Date.now,
    cadenceMs:60000,pageLimit:100,budgetMs:5000});
  try {
    const page1=await runner.start();
    assert.equal(page1.results[0].processed,100);
    await runner.stop();
    assert.equal(first.cursorStore.read(registration).cursor,'0100');
    first.kernel.close();

    const second=open(databasePath);
    runner=createDomainReconcileRunner({cursorStore:second.cursorStore,registrations:[registration],now:Date.now,
      cadenceMs:60000,pageLimit:100,budgetMs:5000});
    const page2=await runner.start();
    assert.equal(page2.results[0].processed,100);
    const page3=await runner.runOnce();
    assert.equal(page3.results[0].processed,5);
    assert.equal(second.cursorStore.read(registration).cursor,null);
    assert.equal(new Set(seen).size,205);
    assert.equal(seen.length,205);
    await runner.stop();
    second.kernel.close();
  } finally {
    try { first.kernel.close(); } catch {}
    fs.rmSync(root,{recursive:true,force:true});
  }
});

test('one Owner scope failure is reported and retried without failing startup or skipping its cursor', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-reconcile-failure-'));
  const databasePath = path.join(root, 'shelfdeck.db');
  const opened = open(databasePath);
  const seen=[]; const errors=[]; let failFirst=true;
  const registration=Object.freeze({ownerDomain:'libra',reconcilerKey:'ready-runs',
    listPage:({cursor})=>cursor===null?[
      Object.freeze({cursor:'run-1',scope:Object.freeze({processId:'run-1'})}),
      Object.freeze({cursor:'run-2',scope:Object.freeze({processId:'run-2'})}),
    ]:[Object.freeze({cursor:'run-2',scope:Object.freeze({processId:'run-2'})})],
    reconcile(scope){seen.push(scope.processId);if(scope.processId==='run-1'&&failFirst){failFirst=false;
      throw Object.assign(new Error('stale integration revision'),{code:'PLATFORM_INTEGRATION_REVISION_MISMATCH'});}},
  });
  const runner=createDomainReconcileRunner({cursorStore:opened.cursorStore,registrations:[registration],now:Date.now,
    cadenceMs:60000,pageLimit:100,budgetMs:5000,onError:(error)=>errors.push(error.code)});
  try {
    const startup=await runner.start();
    assert.equal(startup.kind,'completed');
    assert.equal(startup.results[0].processed,1);
    assert.equal(startup.results[0].cursor,null);
    assert.equal(startup.results[0].errorCode,'PLATFORM_INTEGRATION_REVISION_MISMATCH');
    assert.deepEqual(errors,['PLATFORM_INTEGRATION_REVISION_MISMATCH']);
    const retry=await runner.runOnce();
    assert.equal(retry.results[0].processed,2);
    assert.equal(retry.results[0].cursor,null);
    assert.deepEqual(seen,['run-1','run-2','run-1','run-2']);
  } finally {
    await runner.stop(); opened.kernel.close();
    fs.rmSync(root,{recursive:true,force:true});
  }
});
