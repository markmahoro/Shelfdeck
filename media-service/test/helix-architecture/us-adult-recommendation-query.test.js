'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {harness}=require('./fixtures/us-adult-analysis-context');
const {setupSources}=require('./fixtures/us-adult-recommendation-context');
const {canonicalDigest:D}=require('../../src/helix/contracts/canonical-json');
const publicPackage=require('../../src/helix/domains/libra/public');
const catalog=require('../../src/helix/contracts/ports/p9-libra-production-public-contracts.json');
test('recommendation query publishes only an exact current unmatched source with its original title and complete formal Result refs',()=>harness(input=>{
  const h=setupSources(input),before=input.db.prepare('SELECT count(*) n FROM fx_command_receipts').get().n,page=h.query.listSources(h.pageQuery);
  assert.equal(page.items.length,1);assert.equal(page.nextCursor,'run-1');assert.equal(page.items[0].originalName.originalFileName,'Original source.mkv');
  assert.deepEqual(page.items[0].sourceResultRefs.map(item=>item.capabilityRef),h.records.map(item=>item.capabilityRef));
  assert.equal(page.items[0].expectedChoiceRevision,0);assert.equal(page.items[0].expectedRunStateRevision,1);
  assert.deepEqual(h.query.readSource(page.items[0]),page.items[0]);
  assert.deepEqual(h.query.listSources({...h.pageQuery,cursor:page.nextCursor}).items,[]);
  assert.equal(input.db.prepare('SELECT count(*) n FROM fx_command_receipts').get().n,before);
  const substituted=structuredClone(page.items[0]);substituted.sourceResultRefs[0].resultDigest=D('substituted');
  const {sourceDigest,...body}=substituted;substituted.sourceDigest=D(body);
  assert.throws(()=>h.query.readSource(substituted),{code:'US_ADULT_RECOMMENDATION_SOURCE_STALE'});
  assert.throws(()=>h.query.listSources({...h.pageQuery,limit:33}),{code:'P4_CAPABILITY_SCHEMA_REJECTED'});
}));
test('confirmed actor, delivery, terminal Run and non-US Subject are excluded before feature reads',()=>harness(input=>{
  const h=setupSources(input),source=h.query.listSources(h.pageQuery).items[0];
  for(const [sql,restore]of [
    ['UPDATE libra_runs SET package_revision_head=1','UPDATE libra_runs SET package_revision_head=0'],
    ["UPDATE libra_runs SET state='completed'","UPDATE libra_runs SET state='active'"],
    ["UPDATE libra_subjects SET content_profile='jav'","UPDATE libra_subjects SET content_profile='western_adult'"],
  ]){
    input.db.prepare(sql).run();const before=h.reads();assert.deepEqual(h.query.listSources(h.pageQuery).items,[]);assert.equal(h.reads(),before);input.db.prepare(restore).run();
  }
  h.owner.command.choose('run-1',h.owner.choiceBody,'admin');assert.deepEqual(h.query.listSources(h.pageQuery).items,[]);
  assert.throws(()=>h.query.readSource(source),{code:'US_ADULT_RECOMMENDATION_SOURCE_STALE'});
}));
test('no-face completion supplies no invented photograph or recommendation source',()=>harness(input=>{
  const h=setupSources(input,{noFaces:true});assert.deepEqual(h.query.listSources(h.pageQuery).items,[]);assert.equal(h.reads(),0);
}));
test('source query rejects changed feature provenance and a Run revision changing between its Owner reads',()=>harness(input=>{
  const h=setupSources(input);h.records[1].inputBindingDigest=D('wrong-bindings');
  assert.throws(()=>h.query.listSources(h.pageQuery),{code:'US_ADULT_RECOMMENDATION_SOURCE_INVALID'});
  h.records[1].inputBindingDigest=D(h.records[1].inputBindings);
  let changed=false;h.onRead(()=>{if(!changed){changed=true;input.db.prepare('UPDATE libra_runs SET state_revision=2').run();}});
  assert.throws(()=>h.query.listSources(h.pageQuery),{code:'US_ADULT_RECOMMENDATION_SOURCE_STALE'});
}));
test('Libra recommendation facade declares exact nominal reads and rejects store, file and mutation authority',()=>{
  const contract=catalog.ports.find(item=>item.exportName==='UsAdultRecommendationQueryFacade');
  assert.deepEqual(contract.methods,['listSources','readSource']);
  assert.equal(contract.inputSchemaRefs.listSources,'helix://contracts/domain-types/UsAdultRecommendationPageQuery/v1');
  assert.equal(contract.outputSchemaRefs.listSources,'helix://contracts/domain-types/UsAdultRecommendationSourcePage/v1');
  const query={sourceId:'source'},port=publicPackage.UsAdultRecommendationQueryFacade({listSources:value=>value,readSource:value=>value});
  assert.equal(port.readSource(query),query);
  for(const extra of ['repository','workspacePath','confirmActor'])assert.throws(()=>publicPackage.UsAdultRecommendationQueryFacade({
    listSources(){},readSource(){},[extra]:()=>{}}),{code:'US_ADULT_RECOMMENDATION_PORT_SHAPE_MISMATCH'});
});
