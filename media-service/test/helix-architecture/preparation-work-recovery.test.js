'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const Database=require('better-sqlite3');
const {openSqliteKernel}=require('../../src/helix/foundation/persistence/sqlite-kernel');
const {createSqliteUnitOfWork}=require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const {createWorkResultReader}=require('../../src/helix/foundation/execution/work-result-reader');
const {createPreparationWorkRecovery}=require('../../src/helix/domains/libra/application/preparation-work-recovery');
const generated=path.resolve(__dirname,'../../src/helix/foundation/persistence/generated');
const schemaManifest=JSON.parse(fs.readFileSync(path.join(generated,'clean-schema.manifest.json'))),schemaDdl=fs.readFileSync(path.join(generated,'clean-schema.sql'),'utf8');

for(const phase of ['intake','routing','spec'])test('failed '+phase+' preparation has a durable explicit recovery without replacing its business scope',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-preparation-recovery-')),databasePath=path.join(root,'test.db');
  const kernel=openSqliteKernel({Database,databasePath,schemaManifest,schemaDdl}),unitOfWork=createSqliteUnitOfWork({kernel});
  const reader=createWorkResultReader({schemaManifest,unitOfWork}),options={schemaManifest,unitOfWork,workResultReader:reader};
  function coordinator(){
    if(phase==='intake')return require('../../src/helix/domains/libra/application/intake-process-coordinator').createIntakeProcessCoordinator({...options,
      offerReader:{read:()=>({offer:{offerId:'offer'},snapshot:{deliverySnapshotDigest:'a'.repeat(64),candidatePackage:{materialFieldContextRef:{fieldId:'field'}}}})},
      subjectIdForProcess:()=> 'subject',pipelineAdmission:{hasToken:()=>true,freeSeats:()=>3,readPolicy:()=>({predeckPipelineSeats:3})}});
    if(phase==='routing')return require('../../src/helix/domains/libra/application/routing-process-coordinator').createRoutingProcessCoordinator({...options,
      contextReader:{currentState:()=>({context:{subject:{subjectId:'subject',snapshotDigest:'a'.repeat(64)},
        policy:{policyDigest:'b'.repeat(64),targets:[{matchExpression:{nodeKind:'always'}}]}}}),buildInputSet:()=>({decisionFacts:[]})}});
    return require('../../src/helix/domains/libra/application/acceptance-spec-coordinator').createAcceptanceSpecCoordinator({...options,
      contextReader:{read:()=>({kind:'ready',inputSet:{inputSetDigest:'c'.repeat(64)}})}});
  }
  const db=new Database(databasePath);
  try{
    const first=coordinator().reconcile('subject');
    db.prepare("UPDATE fx_supporting_works SET state='failed' WHERE work_id=?").run(first.workId);
    const failed=coordinator().reconcile('subject');assert.equal(failed.kind,'preparation_failed');assert.equal(failed.workId,first.workId);
    assert.equal(coordinator().reconcile('subject').workId,first.workId,'background reconciliation does not loop new attempts');
    const recovery=createPreparationWorkRecovery(options),retried=recovery.retry(first.workId);
    assert.equal(retried.kind,'admitted');assert.notEqual(retried.workId,first.workId);
    assert.equal(recovery.retry(first.workId).replayed,true);
    const resumed=coordinator().reconcile('subject');assert.equal(resumed.workId,retried.workId);
    assert.notEqual(resumed.kind,'preparation_failed');
    assert.equal(reader.readDefinition(first.workId).definition.executionBasisDigest,reader.readDefinition(retried.workId).definition.executionBasisDigest);
    assert.equal(reader.status(first.workId).state,'failed');
    db.prepare("UPDATE fx_supporting_works SET state='failed' WHERE work_id=?").run(retried.workId);
    const again=recovery.retry(retried.workId);assert.equal(again.kind,'admitted');assert.equal(coordinator().reconcile('subject').workId,again.workId);
    assert.equal(db.prepare('SELECT count(*) n FROM libra_subjects').get().n,0,'technical recovery creates no business decision');
  }finally{db.close();kernel.close();fs.rmSync(root,{recursive:true,force:true});}
});
