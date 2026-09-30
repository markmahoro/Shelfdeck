'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const test=require('node:test');
const Database=require('better-sqlite3');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
const {createTmdbProviderAdapter}=require('../../src/helix/integrations/tmdb-provider-adapter');
const {observeProductIdentity}=require('../../src/helix/domains/libra/capabilities/routing-capability-ports');
const {createProductIdentityPlanner,createProductIdentityProjections,IDENTITY_EVIDENCE_INTENT,decisionEvidence,productStructure}=
  require('../../src/helix/domains/libra/planning/libra-production-planners');
const {buildProductIdentityCommitBundle}=require('../../src/helix/domains/libra/model/product-identity-commit-contracts');
const {buildProductFactHandle,buildResolvedProductIdentity}=require('../../src/helix/domains/libra/model/product-fact-contracts');
const {establishedSubjectIdentity,identityObservationWork}=require('../../src/helix/domains/libra/planning/product-identity-work');
const {CONTINUITY_HEAD_ID,continuityHeadDigest,subjectContinuitySetDigest,subjectEpisodeScopeDigest}=
  require('../../src/helix/domains/libra/model/libra-intake-contracts');
const {createLibraIntakeStore}=require('../../src/helix/domains/libra/persistence/libra-intake-store');
const {openSqliteKernel}=require('../../src/helix/foundation/persistence/sqlite-kernel');
const {createSqliteUnitOfWork}=require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const {createWorkResultReader}=require('../../src/helix/foundation/execution/work-result-reader');
const {createProductFactRegistrations}=require('../../src/helix/domains/libra/persistence/product-fact-store');
const {createCanonicalTransactionRegistry,createDomainCommitCoordinator,createDomainCommitRegistry}=
  require('../../src/helix/foundation/persistence/domain-commit-registry');
const {createCapabilityContractValidator}=require('../../src/helix/foundation/capability/contract-validator');
const transaction=require('../../src/helix/contracts/transaction-contracts/helix.transaction.domain-fact-commit/v1/contract.json');
const generated=path.resolve(__dirname,'../../src/helix/foundation/persistence/generated');
const schemaManifest=JSON.parse(fs.readFileSync(path.join(generated,'clean-schema.manifest.json'),'utf8'));
const schemaDdl=fs.readFileSync(path.join(generated,'clean-schema.sql'),'utf8');
const D=value=>canonicalDigest({value});
const operationId='libra.product_identity.evidence.observe@1';
const handle={integrationId:'tmdb-main',integrationType:'tmdb',configRevision:1,allowedOperation:operationId,fenceDigest:D('handle')};

function harness(overrides={}) {
  const calls=[];
  const adapter=createTmdbProviderAdapter({
    integrationQueryPort:{query:()=>({state:'active',integrationType:'tmdb',integrationId:handle.integrationId,
      configRevision:1,endpoint:'https://api.themoviedb.org/3',secretKind:'tmdb_access_token',secretRef:'fixture-secret',settings:{language:'zh-CN'}})},
    integrationHandleResolverPort:{resolve:()=>handle},secretLeaseResolverPort:{resolve:()=>({leaseId:'fixture-lease'})},
    secretLeaseConsumer:{consumeAsync:async(_lease,consume)=>consume(Buffer.from('disposable-secret'))},
    fetchImpl:async url=>{
      calls.push(url);
      if(overrides.error)throw overrides.error;
      const search=url.pathname.endsWith('/search/tv'),season=url.pathname.includes('/season/');
      const id=Number(url.pathname.split('/')[3]);
      const result=search?(overrides.search??{results:[{id:1399,name:'Demo Show'}]}):season?
        (overrides.season??{id:3624,season_number:1}):(overrides.show??{id,name:'Demo Show',original_name:'Demo Show',first_air_date:'2020-01-01'});
      return new Response(JSON.stringify(result),{status:season?(overrides.seasonStatus??200):search?200:(overrides.showStatus??200)});
    },
  });
  const execute=(input={})=>adapter.observationPort.execute({operationId,integrationHandle:handle,timeoutMs:1000,
    input:{contentProfile:'series',title:'Demo Show',yearHint:2020,strongProviderKey:null,seasonNumber:1,...input}});
  const options={readRelatedNfo:async()=>overrides.xml??'',observeRoutingProvider:({intent})=>execute({
    title:intent.candidateDisplayTitle,yearHint:intent.yearHint,strongProviderKey:intent.strongProviderAnchor?.providerKey??null,seasonNumber:intent.seasonNumber})};
  return {calls,execute,options};
}

function snapshot(seasonNumber=1) {
  const seasonClaim={claimKind:'explicit_number',seasonNumber};
  seasonClaim.claimDigest=canonicalDigest(seasonClaim);
  return {run:{libraRunId:'run-1',subjectId:'subject-1',acceptanceSpecId:'spec-1',executionBasisDigest:D('basis')},
    spec:{contentProfile:'series',structureKind:'season',acceptanceSpecId:'spec-1',recordDigest:D('spec')},
    candidateIdentityClaim:{contentProfile:'series',claimKind:'series_season',seasonClaim,claimedTitle:'Demo Show',displayIdentity:'Demo Show',claimedYear:2020},
    episodeClaims:[{episodeKey:'E001'},{episodeKey:'E002'}],relatedReferences:[{role:'nfo',referenceId:'show-nfo',referenceDigest:D('reference'),identity:{inode:'nfo'}}]};
}

function project(value=snapshot(),parameters={sourceKind:'provider_search',seasonNumber:1},extra={}) {
  const registrations=createProductIdentityProjections({movieProductionReader:{readRunSnapshot:()=>value},
    resolveRoutingIntegrationHandle:()=>handle,...extra});
  return registrations.find(item=>item.projectionRef===IDENTITY_EVIDENCE_INTENT).projection.project({
    ownerScope:{processId:value.run.libraRunId},parameters});
}

function sourceBindings(input) {
  return {schemaRef:'helix://foundation/types/EventInputBindingSet/v1',schemaVersion:1,bindings:[{
    portName:'productIdentityEvidenceIntent',bindingKind:'projected_owner_facts',ownerDomain:'libra',
    processType:'libra_run',processId:input.libraRunId,projectionRef:IDENTITY_EVIDENCE_INTENT,
    parameters:{sourceKind:input.sourceKind,seasonNumber:input.seasonNumber}}]};
}

async function fixture(overrides={}) {
  const value=snapshot(),input=project(value),adapter=harness(overrides);
  const result=await observeProductIdentity(adapter.options,input,handle);
  const inputBindings=sourceBindings(input),resultDigest=canonicalDigest(result);
  const evidence={schemaRef:'helix://contracts/capabilities/libra.product_identity.evidence.observe/v1/evidence',schemaVersion:1,
    evidenceId:'evidence-source',evidenceKind:'product_identity_observation',producerRef:operationId,
    basisDigest:input.intentDigest,payloadDigest:resultDigest,observedAtMs:2};
  const sourceResultItem={workId:'work-source',attemptId:'attempt-source',planId:'plan-source',eventId:'event-source',resultId:'result-source',
    capabilityRef:operationId,resultSchemaRef:'helix://contracts/capabilities/libra.product_identity.evidence.observe/v1/result',
    result,resultDigest,evidence,inputBindingDigest:canonicalDigest(inputBindings)};
  const bundle=buildProductIdentityCommitBundle({snapshot:value,identityClaim:value.candidateIdentityClaim,
    decisionEvidence:decisionEvidence(result,value),productStructure:productStructure(value),sourceResultItem,
    libraRunId:value.run.libraRunId,eventFenceDigest:D('fence')});
  return {snapshot:value,input,inputBindings,result,evidence,bundle};
}

test('Series identity searches TV and verifies the exact positive Season',async()=>{
  const value=harness(),candidates=await value.execute();
  assert.equal(candidates[0].namespace,'tmdb_series');assert.equal(candidates[0].seasonNumber,1);
  assert.deepEqual(value.calls.map(url=>url.pathname),['/3/search/tv','/3/tv/1399','/3/tv/1399/season/1']);
  assert.equal(value.calls[0].searchParams.get('first_air_date_year'),'2020');
  const exact=harness();await exact.execute({strongProviderKey:'1399'});assert.equal(exact.calls.length,2);
});
test('Series TV aliases use the actual results response while preserving the Movie titles contract',async()=>{
  const value=harness({show:{id:1399,name:'Localized Show',original_name:'Original Show',first_air_date:'2020-01-01',
    alternative_titles:{id:1399,results:[{iso_3166_1:'US',title:'Demo Show',type:''}]},
    translations:{translations:[{iso_639_1:'fr',iso_3166_1:'FR',data:{name:'Translated Show'}}]}}});
  const observed=await observeProductIdentity(value.options,project(),handle);
  assert.equal(observed.result,'resolved');assert.equal(observed.verifiedIdentity.displayTitle,'Localized Show');
  assert.ok(observed.verifiedIdentity.aliases.some(item=>item.value==='Demo Show'));
  await assert.rejects(harness({show:{id:1399,name:'Demo Show',alternative_titles:{titles:[]}}}).execute(),{code:'PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID'});
});
test('Formal Identity Planner freezes Season on both Owner inputs and their actual projections agree',()=>{
  const value=snapshot();value.relatedReferences=[];
  const work=identityObservationWork(value,'provider_search');
  const options={movieProductionReader:{readRunSnapshot:()=>value},workResultReader:{read:()=>[]},resolveRoutingIntegrationHandle:()=>handle,
    registry:{snapshot:[],resolve:()=>({manifest:{effectClass:'pure_observation',parametersSchemaRef:'helix://contracts/capabilities/libra.product_identity.evidence.observe/v1/parameters',
      resultSchemaRef:'helix://contracts/capabilities/libra.product_identity.evidence.observe/v1/result'}})},
    policyRegistry:{digest:D('policy'),bindingFor:()=>({retryPolicyRef:'fixture-retry',timeoutPolicyRef:'fixture-timeout'})}};
  const plan=createProductIdentityPlanner(options).plan({processId:'run-1',ownerDomain:'libra',processType:'libra_run',
    executionBasisDigest:D('basis'),workId:work.workId,workAttemptId:'attempt-source'});
  const projections=createProductIdentityProjections(options);
  for(const binding of plan.nodes[0].inputBindings.bindings){
    assert.equal(binding.parameters.seasonNumber,1);
    const projected=projections.find(item=>item.projectionRef===binding.projectionRef).projection.project({ownerScope:{processId:'run-1'},parameters:binding.parameters});
    assert.equal(binding.portName==='productIdentityEvidenceIntent'?projected.seasonNumber:projected.integrationId,binding.portName==='productIdentityEvidenceIntent'?1:'tmdb-main');
  }
});

for(const seasonNumber of [0,-1,1.5,'1',null,Number.MAX_SAFE_INTEGER+1])test('Series identity rejects invalid Season '+String(seasonNumber)+' before HTTP',async()=>{
  const value=harness();await assert.rejects(value.execute({seasonNumber}),{code:'PLATFORM_TMDB_ROUTING_INVALID'});assert.equal(value.calls.length,0);
});
for(const [label,overrides,code] of [
  ['foreign TV',{show:{id:1400,name:'Demo Show'}},'PLATFORM_TMDB_IDENTITY_MISMATCH'],
  ['Movie object',{show:{id:1399,title:'Demo Show'}},'PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID'],
  ['foreign Season',{season:{id:3624,season_number:2}},'PLATFORM_TMDB_IDENTITY_MISMATCH'],
  ['malformed Season',{season:{season_number:1}},'PLATFORM_INTEGRATION_RESPONSE_SCHEMA_INVALID'],
  ['network failure',{error:new Error('disposable transport failure')},'PLATFORM_INTEGRATION_NETWORK_FAILED'],
  ['HTTP failure',{seasonStatus:503},'PLATFORM_INTEGRATION_HTTP_FAILED'],
])test('Series identity rejects '+label,async()=>assert.rejects(harness(overrides).execute(),{code}));
test('A missing TV or Season is an explicit no-match result',async()=>{
  for(const overrides of [{showStatus:404},{seasonStatus:404}])assert.deepEqual(await harness(overrides).execute(),[]);
});
test('Owner projection conserves frozen Season and rejects missing, guessed or changed claims',()=>{
  assert.equal(project().seasonNumber,1);
  assert.throws(()=>project(snapshot(2)),/planned Season/);
  for(const seasonClaim of [null,{claimKind:'explicit_number',seasonNumber:1,claimDigest:D('wrong')},{claimKind:'unresolved',claimDigest:D('unresolved')}]){
    const value=snapshot();value.candidateIdentityClaim.seasonClaim=seasonClaim;assert.throws(()=>project(value),/frozen positive Season/);
  }
});
test('Related tvshow identity is only a claim and cannot publish a formal identity',async()=>{
  const value=snapshot(),input=project(value,{sourceKind:'related_nfo',seasonNumber:1});
  const result=await observeProductIdentity(harness({xml:'<tvshow><title>Demo Show</title><uniqueid type="tmdb">1399</uniqueid><actor><tmdbid>1001</tmdbid></actor></tvshow>'}).options,input,{});
  assert.equal(result.verifiedIdentity.providerKey,'1399');
  const evidence={evidenceId:'nfo-evidence',payloadDigest:canonicalDigest(result)};
  assert.throws(()=>buildProductIdentityCommitBundle({snapshot:value,identityClaim:value.candidateIdentityClaim,
    decisionEvidence:decisionEvidence(result,value),productStructure:productStructure(value),libraRunId:'run-1',eventFenceDigest:D('fence'),
    sourceResultItem:{capabilityRef:operationId,resultSchemaRef:'helix://contracts/capabilities/libra.product_identity.evidence.observe/v1/result',result,resultDigest:canonicalDigest(result),evidence}}),/exact Provider identity/);
  const exact=project(value,{sourceKind:'provider_exact',seasonNumber:1,sourceWorkId:'nfo-work'},
    {workResultReader:{read:()=>[{outcomeKind:'succeeded',capabilityRef:operationId,result}]}});
  assert.equal(exact.associationKind,'nfo_claim');assert.equal(exact.providerKey,'1399');
  const verified=await observeProductIdentity(harness().options,exact,handle);assert.equal(verified.result,'resolved');
});
for(const [xml,result] of [
  ['<episodedetails><uniqueid type="tmdb">63056</uniqueid></episodedetails>','not_found'],
  ['<tvshow><episodedetails><uniqueid type="tmdb">63056</uniqueid></episodedetails></tvshow>','not_found'],
  ['<movie><tmdbid>1399</tmdbid></movie>','not_found'],
  ['<tvshow><tmdbid>1399</tmdbid><season>2</season></tvshow>','conflicting'],
  ['<tvshow><tmdbid>1399</tmdbid><uniqueid type="tmdb">1400</uniqueid></tvshow>','conflicting'],
])test('Series NFO preserves explicit root and Season association: '+result,async()=>{
  const input=project(snapshot(),{sourceKind:'related_nfo',seasonNumber:1});
  assert.equal((await observeProductIdentity(harness({xml}).options,input,{})).result,result);
});
test('Ambiguous identities, year conflicts and exact association conflicts stay explicit',async()=>{
  const input=project();
  const ambiguous=await observeProductIdentity(harness({search:{results:[{id:1399,name:'Demo Show'},{id:1400,name:'Demo Show'}]}}).options,input,handle);
  assert.equal(ambiguous.result,'ambiguous');assert.equal(ambiguous.candidates.length,2);
  const year=await observeProductIdentity(harness({show:{id:1399,name:'Demo Show',first_air_date:'2021-01-01'}}).options,input,handle);
  assert.equal(year.result,'conflicting');
  const exactBody={...input,sourceKind:'provider_exact',providerKey:'1399',associationKind:'nfo_claim',associationEvidenceDigest:D('claim')};
  delete exactBody.intentId;delete exactBody.intentDigest;
  const exact={intentId:'exact',...exactBody,intentDigest:canonicalDigest(exactBody)};
  const conflict=await observeProductIdentity(harness({show:{id:1399,name:'Foreign title',first_air_date:'2020-01-01'}}).options,exact,handle);
  assert.equal(conflict.result,'conflicting');
});
test('Actual closed schemas validate Series Intent, Observation and Resolved Identity',async()=>{
  const contracts=path.resolve(__dirname,'../../src/helix/contracts');
  const schemas=['types','domain-types','application-types'].flatMap(group=>fs.readdirSync(path.join(contracts,group)).map(name=>{
    const root=path.join(contracts,group,name),version=fs.readdirSync(root).find(entry=>/^v[0-9]+$/.test(entry));
    return JSON.parse(fs.readFileSync(path.join(root,version,'schema.json'),'utf8'));
  }));
  const validator=createCapabilityContractValidator({schemas}),value=await fixture();
  validator.validate('helix://contracts/domain-types/ProductIdentityEvidenceIntent/v1',value.input);
  validator.validate('helix://contracts/types/ProductIdentityEvidenceObservation/v1',value.result);
  validator.validate('helix://contracts/types/ResolvedProductIdentity/v1',value.bundle.resolvedProductIdentity);
  assert.throws(()=>validator.validate('helix://contracts/domain-types/ProductIdentityEvidenceIntent/v1',{...value.input,seasonNumber:0}),{code:'P4_CAPABILITY_SCHEMA_REJECTED'});
  assert.throws(()=>validator.validate('helix://contracts/types/ProductIdentityEvidenceObservation/v1',{...value.result,
    verifiedIdentity:{...value.result.verifiedIdentity,episodeKey:'E001'}}),{code:'P4_CAPABILITY_SCHEMA_REJECTED'});
});

async function database(run) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-series-identity-')),databasePath=path.join(root,'db.sqlite');let now=100;
  const kernel=openSqliteKernel({Database,databasePath,schemaDdl,schemaManifest,now:()=>now++});
  try{return await run({databasePath,kernel,unitOfWork:createSqliteUnitOfWork({kernel})});}
  finally{kernel.close();fs.rmSync(root,{recursive:true,force:true});}
}

// This seeds the immutable admission and completed observation boundary, not a scheduler or Handoff journey.
function seed(kernel,value) {kernel.runPrimitive(({prepare})=>{
  prepare('INSERT INTO libra_subjects(subject_id,structure_kind,content_profile,status,intake_revision,current_continuity_set_digest,current_episode_scope_digest,created_at_ms,updated_at_ms) VALUES(?,?,?,?,?,?,?,?,?)')
    .run('subject-1','season','series','active',1,subjectContinuitySetDigest('subject-1',[]),subjectEpisodeScopeDigest('subject-1',['E001','E002']),1,1);
  prepare('INSERT INTO libra_subject_continuity_heads(head_id,current_revision,head_digest,updated_at_ms) VALUES(?,?,?,?)').run(CONTINUITY_HEAD_ID,0,continuityHeadDigest(0),1);
  prepare('INSERT INTO libra_runs(libra_run_id,subject_id,admission_revision,state,state_revision,state_digest,priority_class,priority_intent_digest,created_at_ms) VALUES(?,?,?,?,?,?,?,?,?)').run('run-1','subject-1',1,'active',1,D('state'),'normal',D('priority'),1);
  prepare('INSERT INTO libra_run_material_manifests(run_material_manifest_id,libra_run_id,manifest_role,scope_kind,manifest_revision,member_count,member_set_digest,episode_scope_digest,manifest_digest,published_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run('manifest-1','run-1','run_input','episode_delivery',1,2,D('members'),D('scope'),D('manifest'),1);
  prepare('UPDATE libra_runs SET run_material_manifest_id=? WHERE libra_run_id=?').run('manifest-1','run-1');
  for(const [ordinal,episodeKey] of ['E001','E002'].entries()){
    prepare('INSERT INTO libra_run_material_members(run_material_manifest_id,ordinal,material_key,role) VALUES(?,?,?,?)').run('manifest-1',ordinal,D(episodeKey),'primary_payload');
    prepare('INSERT INTO libra_run_material_episode_claims(run_material_manifest_id,member_ordinal,episode_key,season_claim_digest,claim_digest) VALUES(?,?,?,?,?)')
      .run('manifest-1',ordinal,episodeKey,value.snapshot.candidateIdentityClaim.seasonClaim.claimDigest,D('episode-'+episodeKey));
  }
  for(const item of [{suffix:'source',state:'succeeded',capability:operationId,input:value.inputBindings,result:value.result},
    {suffix:'commit',state:'running',capability:'libra.product_identity.resolve@1',input:{schema:'fixture-commit-input'},result:null}]){
    prepare('INSERT INTO fx_supporting_works(work_id,owner_domain,process_type,process_id,work_kind,basis_digest,priority_class,state,idempotency_key,created_at_ms,updated_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run('work-'+item.suffix,'libra','libra_run','run-1','product_identity',D('basis-'+item.suffix),'normal',item.state,'key-'+item.suffix,1,1);
    prepare('INSERT INTO fx_work_attempts(attempt_id,work_id,ordinal,basis_digest,state,started_at_ms,finished_at_ms) VALUES(?,?,?,?,?,?,?)').run('attempt-'+item.suffix,'work-'+item.suffix,0,D('attempt-'+item.suffix),item.state,1,item.result?2:null);
    prepare('INSERT INTO fx_workflow_plans(plan_id,attempt_id,planner_ref,planner_version,catalog_digest,basis_digest,graph_digest,state,created_at_ms) VALUES(?,?,?,?,?,?,?,?,?)')
      .run('plan-'+item.suffix,'attempt-'+item.suffix,'libra.planner',1,D('catalog'),D('plan-'+item.suffix),D('graph-'+item.suffix),'planned',1);
    prepare('INSERT INTO fx_plan_nodes(plan_id,node_id,capability_ref,contract_version,input_binding_schema_ref,input_bindings_json,parameters_json,when_json,fence_basis_json,resource_demand_json) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run('plan-'+item.suffix,'node-'+item.suffix,item.capability,1,'helix://contracts/test/input/v1',JSON.stringify(item.input),'{}','{}','{}','{}');
    prepare('INSERT INTO fx_workflow_events(event_id,plan_id,node_id,work_id,attempt_id,owner_domain,capability_ref,contract_version,state,priority_class,ready_at_ms,result_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
      .run('event-'+item.suffix,'plan-'+item.suffix,'node-'+item.suffix,'work-'+item.suffix,'attempt-'+item.suffix,'libra',item.capability,1,item.result?'succeeded':'executing','normal',1,item.result?'result-source':null);
    if(item.result)prepare('INSERT INTO fx_event_attempts(event_attempt_id,event_id,ordinal,executor_ref,executor_version,input_snapshot_schema_ref,input_snapshot_digest,fence_snapshot_digest,state,outcome_kind,started_at_ms,finished_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
      .run('execution-source','event-source',1,'fixture-executor',1,'helix://contracts/test/input/v1',canonicalDigest({productIdentityEvidenceIntent:value.input,physicalMaterialReadHandleOrIntegrationHandle:handle}),D('execution-fence'),'completed','succeeded',1,2);
  }
  prepare('INSERT INTO fx_event_result_bindings(result_id,event_id,outcome_kind,result_schema_ref,result_json,result_digest,evidence_schema_ref,evidence_json,evidence_digest,committed_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run('result-source','event-source','succeeded','helix://contracts/capabilities/libra.product_identity.evidence.observe/v1/result',JSON.stringify(value.result),canonicalDigest(value.result),value.evidence.schemaRef,JSON.stringify(value.evidence),canonicalDigest(value.evidence),2);
});}

function coordinator(unitOfWork) {return createDomainCommitCoordinator({schemaManifest,unitOfWork,
  registry:createDomainCommitRegistry({registrations:createProductFactRegistrations({schemaManifest})}),
  transactionRegistry:createCanonicalTransactionRegistry({contracts:[transaction]})});}
function request(bundle) {return {transactionId:'helix.transaction.domain-fact-commit',handle:bundle.handle,payload:bundle.payload,
  supportingWorkId:'work-commit',outboxMessages:[],commitMarker:{commitMarker:'marker-identity',commitDigest:D('commit')},
  resultBinding:{resultId:'result-identity',eventId:'event-commit',evidenceSchemaRef:'helix://contracts/types/LibraProductFactEvidence/v1',
    evidence:{schemaRef:'helix://contracts/types/LibraProductFactEvidence/v1',schemaVersion:1,evidenceId:'evidence-identity',evidenceDigest:D('fact-evidence')}}};}
function assertEmpty(db) {
  for(const table of ['libra_product_identity_revisions','libra_subject_season_continuity_claims','libra_product_fact_revisions','libra_product_fact_source_refs','fx_commit_markers'])
    assert.equal(db.prepare('SELECT COUNT(*) count FROM '+table).get().count,0,table);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM fx_event_result_bindings WHERE result_id='result-identity'").get().count,0);
  assert.equal(db.prepare('SELECT current_identity_revision FROM libra_subjects').get().current_identity_revision,null);
  assert.equal(db.prepare('SELECT current_continuity_set_digest FROM libra_subjects').get().current_continuity_set_digest,subjectContinuitySetDigest('subject-1',[]));
  assert.equal(db.prepare('SELECT current_revision FROM libra_subject_continuity_heads').get().current_revision,0);
}

test('Native Series identity atomically publishes continuity, supports future matching and replays without advancing heads',async()=>database(async({kernel,unitOfWork,databasePath})=>{
  const value=await fixture();seed(kernel,value);
  const reader=createWorkResultReader({kernel,schemaManifest,unitOfWork}),source=reader.read('work-source')[0];
  const bundle=buildProductIdentityCommitBundle({snapshot:value.snapshot,identityClaim:value.snapshot.candidateIdentityClaim,
    decisionEvidence:decisionEvidence(source.result,value.snapshot),productStructure:productStructure(value.snapshot),
    sourceResultItem:source,libraRunId:'run-1',eventFenceDigest:D('fence')});
  const commit=coordinator(unitOfWork);assert.equal(commit.execute(request(bundle)).replayed,false);
  assert.equal(commit.execute(request(bundle)).replayed,true);
  const db=new Database(databasePath,{readonly:true});try{
    assert.equal(db.prepare('SELECT current_identity_revision FROM libra_subjects').get().current_identity_revision,1);
    const row=db.prepare('SELECT * FROM libra_subject_season_continuity_claims').get();
    assert.equal(row.claim_key,'series:1399:season:1');assert.equal(row.provenance_kind,'resolved_identity');assert.equal(row.provenance_ref,'subject-1:1');
    assert.equal(db.prepare('SELECT current_continuity_set_digest FROM libra_subjects').get().current_continuity_set_digest,
      subjectContinuitySetDigest('subject-1',[{claimKind:row.claim_kind,claimNamespace:row.claim_namespace,claimKey:row.claim_key,
        claimDigest:row.claim_digest,provenanceKind:row.provenance_kind,provenanceRef:row.provenance_ref}]));
    const head=db.prepare('SELECT * FROM libra_subject_continuity_heads').get();assert.equal(head.current_revision,1);assert.equal(head.head_digest,continuityHeadDigest(1));
    assert.equal(db.prepare('SELECT COUNT(*) count FROM fx_outbox').get().count,0);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM libra_product_fact_source_refs').get().count,1);
    assert.deepEqual(JSON.parse(db.prepare('SELECT fact_json FROM libra_product_fact_revisions').get().fact_json),bundle.resolvedProductIdentity);
    const store=createLibraIntakeStore({schemaManifest,unitOfWork});
    assert.equal(store.findActiveContinuityMatches({claimKind:'provider_season_identity',claimNamespace:'tmdb',claimKey:'series:1399:season:1'}).length,1);
    assert.equal(store.findActiveContinuityMatches({claimKind:'provider_season_identity',claimNamespace:'tmdb',claimKey:'series:1399:season:2'}).length,0);
    const identity=db.prepare('SELECT * FROM libra_product_identity_revisions').get();
    const options={routingContextReader:{read:()=>({subject:{subjectId:'subject-1',contentProfile:'series',currentIdentityDigest:identity.identity_digest},rows:{identity}})}};
    const next={...value.snapshot,run:{...value.snapshot.run,libraRunId:'next-run'},episodeClaims:[{episodeKey:'E003'}]};
    const established=establishedSubjectIdentity(options,next);
    const exact=project(next,{sourceKind:'provider_exact',seasonNumber:1,establishedIdentityDigest:established.resultDigest},options);
    assert.equal(exact.providerKey,'1399');assert.equal(exact.associationKind,'subject_identity');
    assert.throws(()=>establishedSubjectIdentity(options,{...next,candidateIdentityClaim:snapshot(2).candidateIdentityClaim}),/frozen Subject and Season/);
  }finally{db.close();}
}));

test('A continuity head CAS failure rolls back all preceding real Owner writes, Result and marker',async()=>database(async({kernel,unitOfWork,databasePath})=>{
  const value=await fixture();seed(kernel,value);
  const crashing={execute:participants=>unitOfWork.execute(participants.map(participant=>participant.participantId!=='libra_product_fact_owner_write'?participant:
    {...participant,execute:context=>participant.execute({...context,repository:id=>{
      const original=context.repository(id);return {...original,invoke:(statement,parameters)=>statement==='advance_continuity_head'?{changes:0}:original.invoke(statement,parameters)};
    }})}))};
  assert.throws(()=>coordinator(crashing).execute(request(value.bundle)),{code:'P9_RESOLVED_IDENTITY_CONTINUITY_CAS'});
  const db=new Database(databasePath,{readonly:true});try{assertEmpty(db);}finally{db.close();}
  assert.equal(coordinator(unitOfWork).execute(request(value.bundle)).replayed,false);
}));

for(const mutation of ['foreign-source-season','foreign-run-season','invalid-fact-digest'])test('Native identity rejects '+mutation+' with zero publication',async()=>database(async({kernel,unitOfWork,databasePath})=>{
  const value=await fixture();seed(kernel,value);let bundle=value.bundle;
  if(mutation==='foreign-source-season'){
    const identity={...bundle.resolvedProductIdentity.providerIdentities[0],seasonNumber:2};
    const claimBody={claimKind:'provider_season_identity',claimNamespace:'tmdb',claimKey:'series:1399:season:2'};
    const fact=buildResolvedProductIdentity({...bundle.resolvedProductIdentity,providerIdentities:[identity],
      exactSeasonContinuityClaims:[{...claimBody,claimDigest:canonicalDigest({schema:'season-continuity-claim@1',...claimBody}),evidenceDigest:value.result.observationDigest}],
      displayEntries:bundle.resolvedProductIdentity.displayIdentity.entries});
    const payload={...bundle.payload,resolvedProductIdentity:fact};
    bundle={payload,handle:buildProductFactHandle({libraRunId:'run-1',factKind:'resolved_identity',expectedRevision:0,payloadDigest:canonicalDigest(payload),eventFenceDigest:D('fence')})};
  }else if(mutation==='foreign-run-season')kernel.runPrimitive(({prepare})=>prepare('UPDATE libra_run_material_episode_claims SET season_claim_digest=?').run(snapshot(2).candidateIdentityClaim.seasonClaim.claimDigest));
  else{
    const payload={...bundle.payload,resolvedProductIdentity:{...bundle.resolvedProductIdentity,identityDigest:D('wrong')}};
    bundle={payload,handle:buildProductFactHandle({libraRunId:'run-1',factKind:'resolved_identity',expectedRevision:0,payloadDigest:canonicalDigest(payload),eventFenceDigest:D('fence')})};
  }
  assert.throws(()=>coordinator(unitOfWork).execute(request(bundle)),error=>['P9_RESOLVED_IDENTITY_SOURCE_CHAIN','P9_RESOLVED_IDENTITY_SEASON_FENCE','P9_RESOLVED_IDENTITY_INPUT'].includes(error.code));
  const db=new Database(databasePath,{readonly:true});try{assertEmpty(db);}finally{db.close();}
}));
