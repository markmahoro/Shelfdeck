'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./fixtures/us-adult-actor-refresh-store-context');
const {canonicalDigest:D}=require('../../src/helix/contracts/canonical-json');
const {createUsAdultActorPipelineQuery}=require('../../src/helix/domains/arca/application/us-adult-actor-pipeline-query');
const {createUsAdultActorRefreshAdmin}=require('../../src/helix/domains/arca/application/us-adult-actor-refresh-admin');
const {createWorkResultReader}=require('../../src/helix/foundation/execution/work-result-reader');
test('Actor status explicitly projects current Basis conflicts without changing Case state or inventing execution',t=>{
  const f=fixture(t),s=f.services(),admitted=s.command.request('entry',f.request,'admin'),actorRefreshSource={store:s.store},
    workResultReader=createWorkResultReader(s.dependencies),actorPipelineQuery=createUsAdultActorPipelineQuery({...s.dependencies,
      actorRefreshSource,aftercareContextReader:s.reader,workResultReader}),
    admin=createUsAdultActorRefreshAdmin({...s.dependencies,actorRefreshSource,actorPipelineQuery,aftercareContextReader:s.reader,
      workResultReader,peopleReferenceQuery:s.query}),before=s.care.getCase(admitted.aftercareCaseId);
  assert.equal(admin.read('entry').progress.reasonCode,null);
  f.context.basis={...f.context.basis,digest:D('changed Shelf configuration')};
  const view=admin.read('entry');
  assert.equal(view.progress.reasonCode,'ARCA_US_ADULT_PHASE_PROOF_INVALID');assert.equal(view.progress.state,'queued');
  assert.equal(view.canRefresh,false);assert.equal(view.blockingCaseId,admitted.aftercareCaseId);
  assert.deepEqual(s.care.getCase(admitted.aftercareCaseId),before);
  assert.equal(f.db.prepare('SELECT count(*) n FROM fx_supporting_works').get().n,0);
});
