'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),Database=require('better-sqlite3');
const {openSqliteKernel}=require('../../src/helix/foundation/persistence/sqlite-kernel');
const {createSqliteUnitOfWork}=require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const {createCapabilityContractValidator}=require('../../src/helix/foundation/capability/contract-validator');
const {createPerceptionProcessServices:rawCreatePerceptionProcessServices}=require('../../src/helix/domains/perception/application/perception-process-services');
const {createPerceptionStore}=require('../../src/helix/domains/perception/persistence/perception-store');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
const {createAcquisitionResumeIntent}=require('../../src/helix/domains/perception/capabilities/acquisition-resume-intent');
const createPerceptionProcessServices=options=>rawCreatePerceptionProcessServices({...options,acquisitionResumeIntent:createAcquisitionResumeIntent(options)});
const schemaManifest=require('../../src/helix/foundation/persistence/generated/clean-schema.manifest.json');
const schemaDdl=fs.readFileSync(path.resolve(__dirname,'../../src/helix/foundation/persistence/generated/clean-schema.sql'),'utf8');

test('manual sync resumes the same periodic Acquisition and frozen page after persistent restart',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'perception-maintenance-resume-')),databasePath=path.join(root,'test.db');
  let opened,now=1000,configRevision=1;
  function open(){
    const kernel=openSqliteKernel({Database,databasePath,schemaDdl,schemaManifest,now:()=>now++}),unitOfWork=createSqliteUnitOfWork({kernel}),
      store=createPerceptionStore({schemaManifest,unitOfWork}),contractValidator=createCapabilityContractValidator({schemas:[
        require('../../src/helix/contracts/domain-types/PerceptionAcquisitionResumeDecision/v1/schema.json')]}),
      services=createPerceptionProcessServices({schemaManifest,unitOfWork,contractValidator,perceptionStore:store,now:()=>now++,
        readDoubanSourceConfiguration:()=>({sourceId:'douban-test',integrationId:'douban',configRevision}),
        workResultReader:{status:()=>null},targetProjectionReader:()=>null});
    return {kernel,store,services};
  }
  t.after(()=>{opened?.kernel.close();assert.equal(path.dirname(root),path.resolve(os.tmpdir()));fs.rmSync(root,{recursive:true,force:true});});
  opened=open();
  const periodic=opened.services.requestAcquisition({idempotencyKey:'periodic-1'},{executionOrigin:'periodic'}),id=periodic.operationRef;
  assert.equal(opened.services.acquisitionSchedulingClass(id),'maintenance');
  opened.store.commitPage({acquisitionCommitReceiptId:'page-1',perceptionAcquisitionId:id,perceptionSourceId:'douban-test',pageOrdinal:0,
    expectedCursorRevision:0,cursorIn:null,cursorOut:'page-2',observationPageDigest:canonicalDigest('page'),hasMore:true,commitMarker:'page-1-marker',records:[],relations:[]});
  const before=opened.services.acquisitionContext(id),work=opened.services.reconcileAcquisition(id);
  opened.kernel.close();opened=open();
  const manual=opened.services.requestAcquisition({idempotencyKey:'manual-resume'},{actorId:'admin-test'});
  assert.equal(manual.operationRef,id);assert.equal(manual.workId,work.workId);
  assert.deepEqual(opened.services.acquisitionContext(id),before);
  assert.equal(opened.services.acquisitionSchedulingClass(id),'normal');
  assert.equal(JSON.parse(opened.store.getAcquisition(id).scopeJson).executionOrigin,'periodic');
  opened.kernel.close();opened=open();
  assert.equal(opened.services.acquisitionSchedulingClass(id),'normal');
  assert.equal(opened.store.listAcquisitions().length,1);
  assert.equal(opened.services.requestAcquisition({idempotencyKey:'manual-resume'},{actorId:'admin-test'}).operationRef,id);
  configRevision=2;
  assert.throws(()=>opened.services.requestAcquisition({idempotencyKey:'new-config-resume'},{actorId:'admin-test'}),{code:'PERCEPTION_RESUME_BASIS_CONFLICT'});
  assert.equal(opened.store.listAcquisitions().length,1);
  opened.store.failAcquisition(id);
  assert.equal(opened.services.requestAcquisition({idempotencyKey:'manual-resume'},{actorId:'admin-test'}).operationRef,id,'Exact accepted command replay precedes terminal/config checks.');
});
