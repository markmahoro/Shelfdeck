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
