'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {harness}=require('./fixtures/us-adult-analysis-context');
const {createCapabilityContractValidator}=require('../../src/helix/foundation/capability/contract-validator');
const {createUsAdultActorChoiceStore}=require('../../src/helix/domains/libra/persistence/us-adult-actor-choice-store');
const {createUsAdultActorChoiceCommand}=require('../../src/helix/domains/libra/capabilities/us-adult-actor-choice-command');
function setup(input,extra={}){
  const schemas=['UsAdultActorChoiceRecord','UsAdultActorChoiceDecision','UsAdultActorChoiceReceipt','UsAdultPersonSnapshot','PersonReferenceProjection'].map(type=>
    require('../../src/helix/contracts/domain-types/'+type+'/v1/schema.json')),
    options={...input.options,contractValidator:createCapabilityContractValidator({schemas}),...extra},store=createUsAdultActorChoiceStore(options);
  let reads=0,unavailable=false;
  const peopleReferenceQuery={readUsAdultPersonSnapshot(request){reads++;if(unavailable)throw new Error('fixture-People-unavailable');
    const value=input.pages.flatMap(page=>page.items).find(item=>item.personId===request.personId);
    assert.equal(request.expectedPersonRevision,value.personRevision);assert.equal(request.expectedReferenceRevision,value.referenceProjection.currentReferenceRevision);
    return value;}},command=createUsAdultActorChoiceCommand({...options,usAdultActorChoiceStore:store,peopleReferenceQuery,
      movieProductionReader:{readRunSnapshot:()=>input.snapshot}});
  return {store,command,reads:()=>reads,unavailable:()=>{unavailable=true;}};
}
const body={idempotencyKey:'actor-choice',expectedRunStateRevision:1,expectedChoiceRevision:0,personId:'actor-1',expectedPersonRevision:1,expectedReferenceRevision:1};
test('actor choice atomically freezes the selected actor and replays the command before later Run or People changes',()=>harness(input=>{
  const h=setup(input),result=h.command.choose('run-1',body,'admin');
  assert.equal(result.replayed,false);assert.equal(result.receipt.resultRef.personId,'actor-1');assert.equal(h.reads(),1);
  const choice=h.store.current('subject-1');assert.equal(choice.revision,1);assert.equal(choice.personSnapshot.personId,'actor-1');
  assert.equal(Object.isFrozen(choice.personSnapshot.referenceProjection.contributions[0].activeFaces),true);
  input.db.prepare("UPDATE libra_runs SET state='completed',state_revision=2 WHERE libra_run_id='run-1'").run();h.unavailable();
  const replay=h.command.choose('run-1',body,'admin');assert.equal(replay.replayed,true);assert.deepEqual(replay.receipt,result.receipt);
  assert.equal(h.reads(),1,'Replay does not re-query changed or unavailable People data.');
  assert.throws(()=>h.command.choose('run-1',{...body,personId:'actor-2'},'admin'),{code:'P3_COMMAND_IDEMPOTENCY_CONFLICT'});
  assert.equal(input.db.prepare('SELECT count(*) n FROM libra_us_adult_actor_choice_intents').get().n,1);
  assert.equal(h.store.current('subject-1').recordDigest,choice.recordDigest);
}));
test('actor choice rolls Intent, head, receipt and audit back after an interrupted Owner insert',()=>harness(input=>{
  const h=setup(input,{afterIntentInsert(){throw new Error('fixture-choice-interruption');}}),
    before=Object.fromEntries(['fx_command_receipts','fx_commit_markers','fx_audit_records'].map(table=>[table,input.db.prepare('SELECT count(*) n FROM '+table).get().n]));
  assert.throws(()=>h.command.choose('run-1',body,'admin'),/fixture-choice-interruption/);
  for(const table of ['libra_us_adult_actor_choice_intents','libra_us_adult_actor_choice_heads'])assert.equal(input.db.prepare('SELECT count(*) n FROM '+table).get().n,0);
  for(const [table,count]of Object.entries(before))assert.equal(input.db.prepare('SELECT count(*) n FROM '+table).get().n,count);
  assert.equal(setup(input).command.choose('run-1',body,'admin').replayed,false);
}));
test('choice heads advance by CAS and stale Run, choice, profile and delivery conditions reject without side effects',()=>harness(input=>{
  const h=setup(input);h.command.choose('run-1',body,'admin');
  assert.throws(()=>h.command.choose('run-1',{...body,idempotencyKey:'stale-head',personId:'actor-2'},'admin'),{code:'US_ADULT_ACTOR_CHOICE_STALE'});
  const next={...body,idempotencyKey:'choose-next',expectedChoiceRevision:1,personId:'actor-2'};
  assert.equal(h.command.choose('run-1',next,'admin').receipt.resultRef.choiceRevision,2);
  assert.equal(h.store.current('subject-1').personSnapshot.personId,'actor-2');
  input.db.prepare('UPDATE libra_runs SET state_revision=2').run();
  assert.throws(()=>h.command.choose('run-1',{...next,idempotencyKey:'stale-run',expectedChoiceRevision:2},'admin'),{code:'US_ADULT_ACTOR_CHOICE_STALE'});
  input.db.prepare('UPDATE libra_runs SET state_revision=1,package_revision_head=1').run();
  assert.throws(()=>h.command.choose('run-1',{...next,idempotencyKey:'handoff-choice',expectedChoiceRevision:2},'admin'),{code:'US_ADULT_ACTOR_HANDOFF_CONFLICT'});
  input.db.exec("UPDATE libra_runs SET package_revision_head=0; UPDATE libra_subjects SET content_profile='movie'");
  assert.throws(()=>h.command.choose('run-1',{...next,idempotencyKey:'wrong-profile',expectedChoiceRevision:2},'admin'),{code:'US_ADULT_ACTOR_CHOICE_STALE'});
  assert.equal(input.db.prepare('SELECT count(*) n FROM libra_us_adult_actor_choice_intents').get().n,2);
}));
