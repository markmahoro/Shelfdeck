'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {harness}=require('./fixtures/us-adult-analysis-context'),{setupSources}=require('./fixtures/us-adult-recommendation-context');
const {canonicalDigest:D}=require('../../src/helix/contracts/canonical-json');
const {createCapabilityContractValidator}=require('../../src/helix/foundation/capability/contract-validator');
const {createPeopleStore}=require('../../src/helix/domains/people/persistence/people-store');
const {createUsAdultRecommendationStore}=require('../../src/helix/domains/people/persistence/us-adult-recommendation-store');
const {createUsAdultRecommendationCoordinator}=require('../../src/helix/domains/people/application/us-adult-recommendation-coordinator');
const {createUsAdultRecommendationQuery}=require('../../src/helix/domains/people/application/us-adult-recommendation-query');
const {createUsAdultRecommendationClaims}=require('../../src/helix/domains/people/application/us-adult-recommendation-claims');
const {createUsAdultActorChoiceCommand}=require('../../src/helix/domains/libra/capabilities/us-adult-actor-choice-command');
const {createUsAdultRecommendationConfirmation}=require('../../src/helix/domains/libra/capabilities/us-adult-recommendation-confirmation');
const schemas=[];const pending=[path.resolve(__dirname,'../../src/helix/contracts')];
while(pending.length){const folder=pending.pop();for(const item of fs.readdirSync(folder,{withFileTypes:true})){
  const file=path.join(folder,item.name);if(item.isDirectory())pending.push(file);else if(item.name.endsWith('schema.json')){
    const schema=JSON.parse(fs.readFileSync(file,'utf8'));if(schema.$id)schemas.push(schema);
  }
}}
async function fixture(input,extra={}){
  const h=setupSources(input),contractValidator=createCapabilityContractValidator({schemas}),options={...input.options,contractValidator,...extra},
    peopleStore=createPeopleStore(options),source=h.query.listSources(h.pageQuery).items[0],windowKey=4102444800000,
    imageBody={schema:'people.us-adult-recommendation-image-evidence@1',sourceDigest:source.sourceDigest,modelRefDigest:source.faceEmbeddingSetHandle.faceModelRefDigest,
      analysisDigest:D('analysis'),clusterId:'cluster',clusterFaceCount:20,faceDigest:D('face'),frameOrdinal:0,imageDigest:D('image'),width:640,height:480,
      box:{x:10,y:10,width:100,height:100},qualityScore:0.6,vector:[1,...Array(127).fill(0)]},image={...imageBody,evidenceDigest:D(imageBody)},
    images={readCandidate:()=>image,readImage:()=>{throw new Error('Existing actor claim must not prepare an image.');}},
    recommendationStore=createUsAdultRecommendationStore({...options,maintenanceWindowKey:()=>windowKey}),
    builder=createUsAdultRecommendationCoordinator({store:recommendationStore,sources:h.query,images});
  for(let index=0;index<30;index++)if((await builder.reconcile(windowKey)).kind==='complete')break;
  let claims;
  const recommendationQuery=createUsAdultRecommendationQuery({store:recommendationStore,sources:h.query,images,now:()=>windowKey,readActiveClaim:id=>claims?.findActive(id)||null}),
    actorCommand=createUsAdultActorChoiceCommand({...options,usAdultActorChoiceStore:h.owner.store,peopleReferenceQuery:peopleStore,
      movieProductionReader:{readRunSnapshot:()=>input.snapshot}}),
    confirmation=createUsAdultRecommendationConfirmation({...options,usAdultActorChoiceStore:h.owner.store,usAdultActorChoice:actorCommand,usAdultRecommendationQuery:h.query}),
    base={...options,recommendationQuery,peopleStore,sources:h.query,images,imageOperations:{},confirmation},
    open=overrides=>claims=createUsAdultRecommendationClaims({...base,...overrides}),current=recommendationQuery.current(),id=current.items[0].recommendationId,
    body={idempotencyKey:'claim',expectedPublicationRevision:current.publication.revision,expectedSnapshotDigest:current.publication.snapshotDigest,
      target:{kind:'existing',personId:'actor-1',expectedPersonRevision:1,expectedReferenceRevision:1}};
  return {h,options,peopleStore,recommendationQuery,confirmation,open,id,body,actorCommand};
}
test('existing actor claim confirms only its frozen source and replays after the source leaves the recommendations',async()=>harness(async input=>{
  const h=await fixture(input),claims=h.open(),before=input.db.prepare('SELECT count(*) n FROM people_persons').get().n,
    result=await claims.begin(h.id,h.body,'admin');
  assert.equal(result.state,'completed');assert.equal(result.sourceConfirmed,true);assert.equal(result.personId,'actor-1');
  assert.deepEqual(h.recommendationQuery.current().items,[]);
  const replay=await h.open().begin(h.id,h.body,'admin');assert.equal(replay.replayed,true);assert.equal(replay.claimRef,result.claimRef);
  assert.equal(input.db.prepare('SELECT count(*) n FROM people_persons').get().n,before);
  assert.equal(input.db.prepare('SELECT count(*) n FROM libra_us_adult_actor_choice_intents').get().n,1);
  await assert.rejects(claims.begin(h.id,{...h.body,target:{...h.body.target,personId:'actor-2'}},'admin'),{code:'PEOPLE_RECOMMENDATION_CLAIM_COMMAND_CONFLICT'});
}));
test('lost confirmation ACK recovers from the same durable claim and Libra receipt across coordinator reconstruction',async()=>harness(async input=>{
  let lost=false;
  const h=await fixture(input),claims=h.open({afterSourceConfirmation(){if(!lost){lost=true;throw Object.assign(new Error('Isolated ACK interruption'),{code:'FIXTURE_ACK_LOST'});}}}),
    started=await claims.begin(h.id,h.body,'admin');
  assert.equal(started.state,'confirming_source');assert.equal(started.failureCode,'FIXTURE_ACK_LOST');
  assert.equal(input.db.prepare('SELECT count(*) n FROM libra_us_adult_actor_choice_intents').get().n,1);
  assert.deepEqual(h.recommendationQuery.current().items,[]);
  require('../../src/helix/domains/people/capabilities/people-profile-update').createPeopleProfileUpdate({...h.options,peopleStore:h.peopleStore})
    .update('actor-1',{idempotencyKey:'profile-after-confirmation',expectedPersonRevision:1,canonicalName:'Updated Actor',aliases:[]},'admin');
  const completed=await h.open().reconcile(started.claimRef);assert.equal(completed.state,'completed');assert.equal(completed.failureCode,null);
  assert.equal(h.h.owner.store.current('subject-1').personSnapshot.personRevision,1);
  assert.equal(input.db.prepare('SELECT count(*) n FROM libra_us_adult_actor_choice_intents').get().n,1);
  assert.equal(input.db.prepare('SELECT count(*) n FROM people_us_recommendation_claims').get().n,1);
}));
test('a changed actor version conflicts before confirmation and a new explicit claim can choose its current version',async()=>harness(async input=>{
  const h=await fixture(input),claims=h.open({confirmation:{confirmSource(){throw Object.assign(new Error('Temporary transport interruption'),{code:'SOURCE_TEMPORARILY_UNAVAILABLE'});}}}),
    started=await claims.begin(h.id,h.body,'admin');
  require('../../src/helix/domains/people/capabilities/people-profile-update').createPeopleProfileUpdate({...h.options,peopleStore:h.peopleStore})
    .update('actor-1',{idempotencyKey:'profile-before-confirmation',expectedPersonRevision:1,canonicalName:'Updated Actor',aliases:[]},'admin');
  const current=h.open(),conflict=await current.reconcile(started.claimRef);assert.equal(conflict.state,'conflict');
  assert.equal(conflict.failureCode,'PEOPLE_US_ACTOR_SNAPSHOT_STALE');assert.equal(input.db.prepare('SELECT count(*) n FROM libra_us_adult_actor_choice_intents').get().n,0);
  const chosen=await current.begin(h.id,{...h.body,idempotencyKey:'updated-actor',target:{...h.body.target,expectedPersonRevision:2}},'admin');
  assert.equal(chosen.state,'completed');assert.equal(h.h.owner.store.current('subject-1').personSnapshot.canonicalName,'Updated Actor');
  assert.equal(input.db.prepare('SELECT count(*) n FROM people_persons').get().n,3);
}));
test('an active claim rejects a concurrent source claim and a later conflicting manual actor is preserved',async()=>harness(async input=>{
  const h=await fixture(input),claims=h.open({confirmation:{confirmSource(){throw Object.assign(new Error('Temporary transport interruption'),{code:'SOURCE_TEMPORARILY_UNAVAILABLE'});}}}),
    started=await claims.begin(h.id,h.body,'admin');
  assert.equal(started.state,'confirming_source');assert.equal(h.recommendationQuery.current().items[0].claim.claimId,started.claimId);
  await assert.rejects(claims.begin(h.id,{...h.body,idempotencyKey:'another'},'admin'),{code:'PEOPLE_RECOMMENDATION_CLAIM_IN_PROGRESS'});
  h.actorCommand.choose('run-1',{...h.h.owner.choiceBody,idempotencyKey:'other-actor',personId:'actor-2'},'admin');
  const result=await h.open().reconcile(started.claimRef);assert.equal(result.state,'conflict');assert.equal(result.failureCode,'US_ADULT_RECOMMENDATION_SOURCE_STALE');
  assert.equal(h.h.owner.store.current('subject-1').personSnapshot.personId,'actor-2');
  assert.equal(input.db.prepare('SELECT count(*) n FROM people_us_recommendation_claims WHERE active_source_id IS NOT NULL').get().n,0);
}));
test('claim admission rolls back before source writes and stale publication versions create no claim',async()=>harness(async input=>{
  let interrupted=true;
  const h=await fixture(input,{afterClaimInsert(){if(interrupted)throw new Error('Isolated claim interruption');}}),claims=h.open();
  await assert.rejects(claims.begin(h.id,h.body,'admin'),/Isolated claim interruption/);
  assert.equal(input.db.prepare('SELECT count(*) n FROM people_us_recommendation_claims').get().n,0);
  assert.equal(input.db.prepare('SELECT count(*) n FROM libra_us_adult_actor_choice_intents').get().n,0);
  interrupted=false;
  await assert.rejects(claims.begin(h.id,{...h.body,expectedSnapshotDigest:D('old-snapshot')},'admin'),{code:'PEOPLE_RECOMMENDATION_CLAIM_REVISION_CONFLICT'});
  assert.equal(input.db.prepare('SELECT count(*) n FROM people_us_recommendation_claims').get().n,0);
  assert.equal((await claims.begin(h.id,h.body,'admin')).state,'completed');
}));
