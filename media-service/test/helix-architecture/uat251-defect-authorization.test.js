'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const {openSqliteKernel} = require('../../src/helix/foundation/persistence/sqlite-kernel');
const {createSqliteUnitOfWork} = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const {createDefectAuthorizationStore} = require('../../src/helix/domains/libra/persistence/defect-authorization-store');
const schemaManifest = require('../../src/helix/foundation/persistence/generated/clean-schema.manifest.json');
const schemaDdl = fs.readFileSync(path.resolve(__dirname,'../../src/helix/foundation/persistence/generated/clean-schema.sql'),'utf8');

test('UAT-251 authorization survives restart, rejects stale and conflicting commands, and revokes transactional guards', t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'uat251-auth-')),databasePath=path.join(root,'test.db');
  let kernel, unitOfWork, store;
  function open(){kernel=openSqliteKernel({Database,databasePath,schemaDdl,schemaManifest});unitOfWork=createSqliteUnitOfWork({kernel});store=createDefectAuthorizationStore({schemaManifest,unitOfWork});}
  t.after(()=>{kernel?.close();fs.rmSync(root,{recursive:true,force:true});});
  open();assert.equal(store.current(),null);
  const request={enabled:true,expectedRevision:0,actorId:'admin',idempotencyKey:'enable-1',acknowledged:true};
  assert.throws(()=>store.publish({...request,acknowledged:false}),{code:'LIBRA_DEFECT_AUTHORIZATION_INPUT'});
  const enabled=store.publish(request);assert.equal(enabled.authorization.state,'enabled');
  assert.equal(enabled.authorization.revision,1);
  assert.equal(store.publish(request).replayed,true);
  assert.throws(()=>store.publish({...request,enabled:false}),/digest|conflict|replay/i);
  assert.throws(()=>store.publish({...request,idempotencyKey:'stale'}),{code:'LIBRA_DEFECT_AUTHORIZATION_STALE'});
  const guard=store.guardParticipant(enabled.authorization);unitOfWork.execute([guard]);
  kernel.close();open();assert.deepEqual(store.current(),enabled.authorization);
  const revoked=store.publish({enabled:false,expectedRevision:1,actorId:'admin',idempotencyKey:'revoke-1'});
  assert.equal(revoked.authorization.state,'revoked');
  assert.throws(()=>unitOfWork.execute([guard]),{code:'LIBRA_DEFECT_AUTHORIZATION_STALE'});
  assert.equal(store.publish(request).authorization.state,'revoked');
});
