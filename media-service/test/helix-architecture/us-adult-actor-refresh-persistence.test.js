'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./fixtures/us-adult-actor-refresh-store-context');
const {canonicalDigest:D,canonicalJson}=require('../../src/helix/contracts/canonical-json');
const model=require('../../src/helix/domains/arca/model/us-adult-actor-refresh');
const {createRepositoryDefinition}=require('../../src/helix/foundation/persistence/owner-repository');

test('actor refresh atomically retains its Case and specified Actor across a real database reopen without a new Intent',t=>{
  const f=fixture(t),s=f.services(),first=s.command.request('entry',f.request,'admin');
  assert.equal(first.replayed,false);assert.equal(first.state,'queued');
  const saved=s.store.get(first.intentId);assert.equal(saved.intent.manualPersonSnapshot.personId,'actor-a');
  assert.equal(saved.aftercareCaseId,first.aftercareCaseId);
  assert.equal(f.db.prepare('SELECT count(*) n FROM arca_aftercare_cases').get().n,1);
  assert.equal(f.db.prepare('SELECT count(*) n FROM arca_us_actor_refresh_intents').get().n,1);
  assert.equal(f.db.prepare('SELECT count(*) n FROM arca_us_actor_refresh_pages').get().n,0);
  const restarted=f.reopen(),replayed=restarted.command.request('entry',f.request,'admin');
  assert.equal(replayed.replayed,true);assert.equal(replayed.aftercareCaseId,first.aftercareCaseId);
  assert.deepEqual(restarted.store.get(first.intentId),saved);
  assert.throws(()=>restarted.command.request('entry',{...f.request,personId:'actor-b'},'admin'),{code:'ARCA_US_ADULT_REFRESH_IDEMPOTENCY_CONFLICT'});
});
test('automatic actor refresh persists every exact reference page and detects a corrupted saved page',t=>{
  const f=fixture(t),s=f.services(),{personId,expectedPersonRevision,expectedReferenceRevision,...body}=f.request,
    started=s.command.request('entry',{...body,mode:'automatic'},'admin'),record=s.store.get(started.intentId),pages=[];
  assert.equal(record.intent.personCount,3);assert.equal(record.intent.pageCount,3);assert.equal(record.intent.manualPersonSnapshot,null);
  for(let ordinal=0;ordinal<record.intent.pageCount;ordinal++)pages.push(s.store.page(started.intentId,ordinal));
  assert.deepEqual(pages.flatMap(page=>page.items.map(person=>person.personId)),['actor-a','actor-b','actor-c']);
  assert.equal(model.referencePages(pages,f.contractValidator).pageSetDigest,record.intent.pageSetDigest);
  f.db.prepare('UPDATE arca_us_actor_refresh_pages SET page_digest=? WHERE intent_id=? AND page_ordinal=0').run(D('corrupted'),started.intentId);
  assert.throws(()=>s.store.page(started.intentId,0),{code:'ARCA_US_ADULT_REFRESH_PAGE_CORRUPT'});
  const changed=structuredClone(pages[0]);changed.items[0].canonicalName='Substituted actor name';
  const {pageDigest,...bodyWithoutDigest}=changed;changed.pageDigest=D(bodyWithoutDigest);
  f.db.prepare('UPDATE arca_us_actor_refresh_pages SET page_json=?,page_digest=? WHERE intent_id=? AND page_ordinal=0')
    .run(canonicalJson(changed),D(changed),started.intentId);
  assert.throws(()=>s.store.page(started.intentId,0),{code:'ARCA_US_ADULT_REFRESH_PERSON_INVALID'});
});
test('late Owner failure rolls back actor Intent, all pages, Case, basis inputs and Foundation marker together',t=>{
  const f=fixture(t),s=f.services(),repository=createRepositoryDefinition({repositoryId:'actor_refresh_late_fixture',owner:'arca',schemaManifest:f.compiled.manifest,
    statements:{find:{kind:'select-one',tableId:'arca_us_actor_refresh_intents',columns:['intent_id'],keyColumns:['intent_id']}}});
  const reader={...s.reader,store:{...s.care,createCase(value){return s.care.createCase({...value,atomicParticipants:caseId=>{
    const actual=value.atomicParticipants(caseId);return [...actual,{participantId:'actor_refresh_late_failure',owner:'arca',repositories:[repository],execute(context){
      assert.ok(context.repository(repository.repositoryId).invoke('find',{intent_id:model.intentId('admin',f.request.idempotencyKey)}));
      throw Object.assign(new Error('Deliberate failure after actor admission insert'),{code:'FIXTURE_LATE_FAILURE'});
    }}];}});}}},command=f.services({aftercareContextReader:reader}).command,
    {personId,expectedPersonRevision,expectedReferenceRevision,...body}=f.request;
  assert.throws(()=>command.request('entry',{...body,mode:'automatic'},'admin'),{code:'FIXTURE_LATE_FAILURE'});
  for(const table of ['arca_us_actor_refresh_intents','arca_us_actor_refresh_pages','arca_aftercare_cases','arca_aftercare_case_basis_inputs']){
    assert.equal(f.db.prepare('SELECT count(*) n FROM '+table).get().n,0,table);
  }
  assert.equal(f.db.prepare("SELECT count(*) n FROM fx_commit_markers WHERE owner_domain='arca'").get().n,0);
  assert.equal(s.command.request('entry',f.request,'admin').replayed,false);
});
test('a copied or missing admission participant cannot create a user actor Case',t=>{
  const f=fixture(t),s=f.services(),person=s.query.readUsAdultPersonSnapshot({personId:'actor-a',expectedPersonRevision:1,expectedReferenceRevision:1}),
    intent=model.buildIntent({context:f.context,body:f.request,actorId:'admin',personSnapshot:person,pages:[],contractValidator:f.contractValidator}),
    value={shelfEntryId:'entry',careBasis:f.context.basis,careRequirement:model.requirement(intent),findingSetDigest:D('actor objective'),
      triggerDigest:D('actor trigger'),basisInputs:[]};
  assert.throws(()=>s.care.createCase(value),{code:'ARCA_US_ADULT_REFRESH_INTENT_REQUIRED'});
  assert.throws(()=>s.care.createCase({...value,atomicParticipants:caseId=>[{...s.store.participant(intent,[],caseId)}]}),{code:'ARCA_US_ADULT_REFRESH_INTENT_REQUIRED'});
  assert.equal(f.db.prepare('SELECT count(*) n FROM arca_aftercare_cases').get().n,0);
});
test('Inventory revision changing after the Owner read rolls the actor Case admission back',t=>{
  const f=fixture(t),s=f.services();
  f.db.prepare('INSERT INTO arca_inventory_representations VALUES(?,?,?,?,?)').run('entry',3,D('changed inventory'),'package',10001);
  f.db.prepare('UPDATE arca_shelf_entries SET current_inventory_revision=3 WHERE shelf_entry_id=?').run('entry');
  assert.throws(()=>s.command.request('entry',f.request,'admin'),{code:'ARCA_US_ADULT_REFRESH_BASIS_STALE'});
  assert.equal(f.db.prepare('SELECT count(*) n FROM arca_aftercare_cases').get().n,0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM arca_us_actor_refresh_intents').get().n,0);
  assert.equal(f.db.prepare("SELECT count(*) n FROM fx_commit_markers WHERE owner_domain='arca'").get().n,0);
  f.db.prepare('UPDATE arca_shelf_entries SET current_inventory_revision=2 WHERE shelf_entry_id=?').run('entry');
  assert.equal(s.command.request('entry',f.request,'admin').replayed,false);
});
test('mutating a caller object after participant preparation cannot change the admitted actor snapshot',t=>{
  const f=fixture(t),s=f.services(),person=s.query.readUsAdultPersonSnapshot({personId:'actor-a',expectedPersonRevision:1,expectedReferenceRevision:1}),
    intent=JSON.parse(JSON.stringify(model.buildIntent({context:f.context,body:f.request,actorId:'admin',personSnapshot:person,pages:[],contractValidator:f.contractValidator}))),
    careRequirement=model.requirement(intent);
  const care=s.care.createCase({shelfEntryId:'entry',careBasis:f.context.basis,careRequirement,findingSetDigest:D('actor objective'),triggerDigest:D('actor trigger'),basisInputs:[],
    atomicParticipants:caseId=>{const participant=s.store.participant(intent,[],caseId);intent.manualPersonSnapshot.canonicalName='Injected name';return [participant];}});
  assert.equal(s.store.byCase(care.aftercareCaseId).intent.manualPersonSnapshot.canonicalName,'actor-a');
});
test('an unbound actor closure is rejected and unrelated health Findings remain available for their own repair',t=>{
  const f=fixture(t),s=f.services(),started=s.command.request('entry',f.request,'admin');
  f.db.prepare('INSERT INTO arca_aftercare_assessments VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run('assessment','entry',2,1,1,
    f.context.basis.decisionFactSetDigest,f.context.basis.digest,'presentation','unhealthy',null,D('health'),10000);
  f.db.prepare('INSERT INTO arca_aftercare_findings VALUES(?,?,?,?,?,?,?,?)').run('finding','assessment','presentation:nfo_missing','warning','auto_repair',D('missing'),'open',10000);
  s.care.admitCase(started.aftercareCaseId);
  assert.throws(()=>s.care.terminateCase(started.aftercareCaseId,'resolved','actor_unchanged',D('unchanged result')),{code:'ARCA_US_ADULT_CASE_RESULT_REQUIRED'});
  assert.equal(s.care.getCase(started.aftercareCaseId).state,'active');
  assert.throws(()=>s.care.terminateCase(started.aftercareCaseId,'unresolved','fixture_stopped',D('stopped')),{code:'ARCA_US_ADULT_FAILURE_CLOSURE_UNPROVEN'});
  s.care.terminateCase(started.aftercareCaseId,'invalidated','fixture_basis_changed',D('stopped'));
  assert.equal(f.db.prepare('SELECT state FROM arca_aftercare_findings').get().state,'open');
  const body={schemaRef:'helix://contracts/domain-types/CareRequirement/v1',schemaVersion:1,requirementId:'health',revision:1,
    careBasisDigest:f.context.basis.digest,acceptanceDigest:D('health acceptance'),requiredEffects:[{objectId:'finding',revision:1,schemaRef:'required-effect',digest:D('missing'),objectKind:'required-effect'}],
    typedParameters:[{parameter:'goal',valueType:'string',value:'presentation:nfo_missing',valueDigest:D('presentation:nfo_missing')}]},
    care=s.care.createCase({shelfEntryId:'entry',careBasis:f.context.basis,careRequirement:{...body,digest:D(body)},findingSetDigest:D('health'),triggerDigest:D('health trigger'),basisInputs:[]});
  s.care.admitCase(care.aftercareCaseId);s.care.terminateCase(care.aftercareCaseId,'resolved','repair_completed',D('repair result'));
  assert.equal(f.db.prepare('SELECT state FROM arca_aftercare_findings').get().state,'resolved');
});
