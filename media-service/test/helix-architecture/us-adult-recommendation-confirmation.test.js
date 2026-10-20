'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {harness}=require('./fixtures/us-adult-analysis-context');
const {setupSources}=require('./fixtures/us-adult-recommendation-context');
const {canonicalDigest:D}=require('../../src/helix/contracts/canonical-json');
const {createCapabilityContractValidator}=require('../../src/helix/foundation/capability/contract-validator');
const {createUsAdultRecommendationConfirmation}=require('../../src/helix/domains/libra/capabilities/us-adult-recommendation-confirmation');
const publicPackage=require('../../src/helix/domains/libra/public');
function fixture(input){
  const h=setupSources(input),source=h.query.listSources(h.pageQuery).items[0],schemas=[
    ...require('../../src/helix/domains/libra/application/western-analysis-plan-schema-graph'),
    ...['UsAdultRecommendationSource','UsAdultRecommendationConfirmation','UsAdultActorChoiceReceipt'].map(name=>require('../../src/helix/contracts/domain-types/'+name+'/v1/schema.json'))],
    contractValidator=createCapabilityContractValidator({schemas});let reads=0;
  const port=publicPackage.UsAdultRecommendationCommandFacade(createUsAdultRecommendationConfirmation({contractValidator,
    usAdultActorChoiceStore:h.owner.store,usAdultActorChoice:h.owner.command,usAdultRecommendationQuery:{readSource(value){reads++;return h.query.readSource(value);}}})),
    request={schemaRef:'helix://contracts/domain-types/UsAdultRecommendationConfirmation/v1',schemaVersion:1,claimId:D('claim'),actorId:'admin',source,
      personId:'actor-1',expectedPersonRevision:1,expectedReferenceRevision:1};
  return {h,port,request,reads:()=>reads};
}
test('source confirmation uses the existing actor Owner transaction and replays its ACK before checking a now-resolved source',()=>harness(input=>{
  const h=fixture(input),receipt=h.port.confirmSource(h.request);
  assert.equal(receipt.libraRunId,'run-1');assert.equal(receipt.subjectId,'subject-1');assert.equal(receipt.personId,'actor-1');assert.equal(h.reads(),1);
  input.db.prepare("UPDATE libra_runs SET state='completed',state_revision=2").run();
  assert.deepEqual(h.port.confirmSource(h.request),receipt);assert.equal(h.reads(),1);
  assert.equal(input.db.prepare('SELECT count(*) n FROM libra_us_adult_actor_choice_intents').get().n,1);
  assert.throws(()=>h.port.confirmSource({...h.request,personId:'actor-2'}),{code:'P3_COMMAND_IDEMPOTENCY_CONFLICT'});
}));
test('source confirmation rejects changed source evidence, an unrelated claim after resolution and extra authority',()=>harness(input=>{
  const h=fixture(input),changed=structuredClone(h.request);changed.source.sourceDigest=D('other-source');
  assert.throws(()=>h.port.confirmSource(changed),{code:'US_ADULT_RECOMMENDATION_SOURCE_STALE'});
  assert.throws(()=>h.port.confirmSource({...h.request,otherFilms:['run-2']}),{code:'P4_CAPABILITY_SCHEMA_REJECTED'});
  h.port.confirmSource(h.request);
  assert.throws(()=>h.port.confirmSource({...h.request,claimId:D('different-claim')}),{code:'US_ADULT_RECOMMENDATION_SOURCE_STALE'});
  assert.equal(input.db.prepare('SELECT count(*) n FROM libra_us_adult_actor_choice_intents').get().n,1);
}));
test('the public source confirmation facade exposes exactly its nominal single-source command',()=>{
  const catalog=require('../../src/helix/contracts/ports/p9-libra-production-public-contracts.json'),
    contract=catalog.ports.find(item=>item.exportName==='UsAdultRecommendationCommandFacade');
  assert.deepEqual(contract.methods,['confirmSource']);
  assert.equal(contract.inputSchemaRefs.confirmSource,'helix://contracts/domain-types/UsAdultRecommendationConfirmation/v1');
  assert.equal(contract.outputSchemaRefs.confirmSource,'helix://contracts/domain-types/UsAdultActorChoiceReceipt/v1');
  for(const extra of ['repository','writeActor','otherSources'])assert.throws(()=>publicPackage.UsAdultRecommendationCommandFacade({confirmSource(){},[extra](){}}),
    {code:'US_ADULT_RECOMMENDATION_PORT_SHAPE_MISMATCH'});
});
