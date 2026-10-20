'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {harness}=require('./fixtures/us-adult-analysis-context');
const {setupSources}=require('./fixtures/us-adult-recommendation-context');
const {canonicalDigest:D}=require('../../src/helix/contracts/canonical-json');
const {createUsAdultRecommendationStore}=require('../../src/helix/domains/people/persistence/us-adult-recommendation-store');
const {createUsAdultRecommendationCoordinator}=require('../../src/helix/domains/people/application/us-adult-recommendation-coordinator');
function fixture(input){
  const h=setupSources(input),source=h.query.listSources(h.pageQuery).items[0];let windowKey=4102444800000,reads=0;
  const body={schema:'people.us-adult-recommendation-image-evidence@1',sourceDigest:source.sourceDigest,
    modelRefDigest:source.faceEmbeddingSetHandle.faceModelRefDigest,analysisDigest:D('analysis'),clusterId:'cluster',clusterFaceCount:20,faceDigest:D('face'),
    frameOrdinal:0,imageDigest:D('image'),width:640,height:480,box:{x:10,y:10,width:100,height:100},qualityScore:0.6,vector:[1,...Array(127).fill(0)]},
    image={...body,evidenceDigest:D(body)},options={...input.options,contractValidator:h.options.contractValidator,maintenanceWindowKey:()=>windowKey};
  const open=()=>{const store=createUsAdultRecommendationStore(options),coordinator=createUsAdultRecommendationCoordinator({store,sources:h.query,
    images:{readCandidate(value){reads++;assert.deepEqual(value,source);return image;}}});return {store,coordinator};};
  async function finish(ports){for(let index=0;index<30;index++)if((await ports.coordinator.reconcile(windowKey)).kind==='complete')return;assert.fail('Bounded recommendation cycle did not finish.');}
  return {h,source,image,open,finish,window:()=>windowKey,setWindow:value=>{windowKey=value;},reads:()=>reads};
}
test('recommendation build persists its source, grouping and ranking cursors across construction and publishes only after the fixed window end',async()=>harness(async input=>{
  const h=fixture(input);let ports=h.open();
  const collected=await ports.coordinator.reconcile(h.window());assert.equal(collected.kind,'source_collected');
  const first=ports.store.start(h.window());assert.equal(first.progress.stage,'group_scan');assert.equal(first.progress.pendingSourceId,h.source.sourceId);
  assert.equal(input.db.prepare('SELECT count(*) n FROM people_us_recommendation_sources').get().n,1);
  ports=h.open();await h.finish(ports);assert.equal(h.reads(),1);
  assert.equal(ports.store.readPublication(h.window()-1),null);
  const snapshot=ports.store.readPublication(h.window());assert.equal(snapshot.items.length,1);assert.equal(snapshot.items[0].coverageCount,1);
  assert.equal(snapshot.items[0].representative.source.sourceId,h.source.sourceId);
  const count=input.db.prepare('SELECT count(*) n FROM people_us_recommendation_cycles').get().n;
  await h.finish(h.open());assert.equal(input.db.prepare('SELECT count(*) n FROM people_us_recommendation_cycles').get().n,count);
  assert.equal(input.db.prepare('SELECT count(*) n FROM libra_us_adult_actor_choice_intents').get().n,0);
}));
test('ranking revalidates source actor blocking and publishes no stale coverage or invented replacement',async()=>harness(async input=>{
  const h=fixture(input),ports=h.open();await ports.coordinator.reconcile(h.window());await ports.coordinator.reconcile(h.window());
  h.h.owner.command.choose('run-1',h.h.owner.choiceBody,'admin');await h.finish(ports);
  assert.deepEqual(ports.store.readPublication(h.window()).items,[]);
  assert.equal(input.db.prepare('SELECT coverage_count FROM people_us_recommendation_groups').get().coverage_count,1);
  assert.equal(input.db.prepare('SELECT rank_coverage_count FROM people_us_recommendation_groups').get().rank_coverage_count,0);
}));
test('unfinished comparison resumes next window while the last effective snapshot stays visible during the new window',async()=>harness(async input=>{
  const h=fixture(input),ports=h.open();await h.finish(ports);const firstWindow=h.window(),first=ports.store.readPublication(firstWindow);
  h.setWindow(firstWindow+7*86400000);await ports.coordinator.reconcile(h.window());
  const pending=ports.store.start(h.window());assert.equal(pending.progress.stage,'group_scan');
  h.setWindow(h.window()+7*86400000);const reopened=h.open(),resumed=reopened.store.start(h.window());
  assert.equal(resumed.cycleId,pending.cycleId);assert.equal(resumed.progress.pendingSourceId,h.source.sourceId);assert.equal(resumed.progress.stage,'refresh_sources');
  await h.finish(reopened);
  assert.deepEqual(reopened.store.readPublication(firstWindow),first);
  assert.equal(reopened.store.readPublication(h.window()).items.length,1);
  assert.equal(input.db.prepare('SELECT count(*) n FROM people_us_recommendation_cycles').get().n,2);
}));
test('recommendation persistence rejects stale revisions, closed maintenance admission and rehashed invalid progress',async()=>harness(async input=>{
  const h=fixture(input),ports=h.open(),first=ports.store.start(h.window());await ports.coordinator.reconcile(h.window());
  assert.throws(()=>ports.store.saveProgress(first,first.progress),{code:'PEOPLE_RECOMMENDATION_REVISION_CONFLICT'});
  const current=ports.store.get(first.cycleId);h.setWindow(null);
  assert.throws(()=>ports.store.saveProgress(current,current.progress),{code:'PEOPLE_RECOMMENDATION_WINDOW_CLOSED'});
  input.db.prepare('UPDATE people_us_recommendation_cycles SET progress_digest=?').run(D('changed'));
  assert.throws(()=>ports.store.get(first.cycleId),{code:'PEOPLE_RECOMMENDATION_RECORD_INVALID'});
}));
test('published recommendation queries expose only current bounded cards and controlled images without admitting work',async()=>harness(async input=>{
  const h=fixture(input),ports=h.open();await h.finish(ports);let queryTime=h.window()-1,imageReads=0;
  const query=require('../../src/helix/domains/people/application/us-adult-recommendation-query').createUsAdultRecommendationQuery({
    store:ports.store,sources:h.h.query,now:()=>queryTime,images:{readImage({source,expectedEvidenceDigest}){
      imageReads++;assert.deepEqual(source,h.source);assert.equal(expectedEvidenceDigest,h.image.evidenceDigest);return {bytes:Buffer.from('isolated-image')};
    }}});
  assert.deepEqual(query.current(),{publication:null,items:[]});queryTime=h.window();
  const before=input.db.prepare('SELECT count(*) n FROM fx_supporting_works').get().n,current=query.current(),id=current.items[0].recommendationId;
  assert.equal(current.items.length,1);assert.equal(current.items[0].coverageCount,1);
  assert.doesNotMatch(JSON.stringify(current),/vector|workspace|storageRef/);
  assert.deepEqual((await query.image(id)).bytes,Buffer.from('isolated-image'));assert.equal(imageReads,1);
  assert.equal(input.db.prepare('SELECT count(*) n FROM fx_supporting_works').get().n,before);
  assert.throws(()=>query.read('bad'),{code:'PEOPLE_RECOMMENDATION_INPUT_INVALID'});
  assert.throws(()=>query.read(D('not-current')),{code:'PEOPLE_RECOMMENDATION_NOT_FOUND'});
  h.h.owner.command.choose('run-1',h.h.owner.choiceBody,'admin');assert.deepEqual(query.current().items,[]);
  await assert.rejects(query.image(id),{code:'US_ADULT_RECOMMENDATION_SOURCE_STALE'});assert.equal(imageReads,1);
}));
