'use strict';

const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),test=require('node:test');
const Database=require('better-sqlite3');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
const {buildJavQueryAnchor,buildJavSourceSelectionSnapshot}=require('../../src/helix/contracts/jav-source-contracts');
const {buildJavIdentityIntent,javIdentityObservation}=require('../../src/helix/domains/libra/model/jav-product-identity');
const {buildProductIdentityCommitBundle}=require('../../src/helix/domains/libra/model/product-identity-commit-contracts');
const {decisionEvidence,productStructure}=require('../../src/helix/domains/libra/planning/libra-production-planners');
const {createProductFactRegistrations}=require('../../src/helix/domains/libra/persistence/product-fact-store');
const {openSqliteKernel}=require('../../src/helix/foundation/persistence/sqlite-kernel');
const {createSqliteUnitOfWork}=require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const {createWorkResultReader}=require('../../src/helix/foundation/execution/work-result-reader');
const {createDomainCommitCoordinator,createDomainCommitRegistry,createCanonicalTransactionRegistry}=require('../../src/helix/foundation/persistence/domain-commit-registry');
const {createCapabilityContractValidator}=require('../../src/helix/foundation/capability/contract-validator');
const transaction=require('../../src/helix/contracts/transaction-contracts/helix.transaction.domain-fact-commit/v1/contract.json');
const generated=path.resolve(__dirname,'../../src/helix/foundation/persistence/generated'),schemaManifest=require(path.join(generated,'clean-schema.manifest.json'));
const schemaDdl=fs.readFileSync(path.join(generated,'clean-schema.sql'),'utf8'),D=value=>canonicalDigest({value});
const capability='libra.product_identity.evidence.observe@1';
function fixture() {
  const sourceSnapshot=buildJavSourceSelectionSnapshot({ruleRef:'libra.jav-single-source@1',ruleRevision:1,ruleDigest:D('rule'),queryAnchor:buildJavQueryAnchor('jav_code','IPX-177'),
    sources:[{ordinal:0,siteRef:'javdb',integrationId:'jav-javdb-main',configRevision:1,authMode:'anonymous',queryKind:'jav_code',endpointProfileDigest:D('endpoint'),networkRouteDigest:D('route')}]});
  const fence={subjectId:'subject-1',libraRunId:'run-1',runExecutionBasisDigest:D('basis'),expectedRunStateRevision:1,
    expectedIdentityRevision:0,expectedIdentityDigest:null,expectedSelectionIntentRevision:0,selectionIntentId:null,selectionIntentDigest:null};
  const intent=buildJavIdentityIntent({subjectId:'subject-1',libraRunId:'run-1',runExecutionBasisDigest:D('basis'),sourceSnapshot,sourceOrdinal:0,javSelectionFence:fence});
  const identity={provider:'jav',namespace:'jav_code',providerKey:'IPX-177',seasonNumber:null};
  const raw={schema:'integration.jav-source-observation@1',siteRef:'javdb',endpointProfileDigest:D('endpoint'),networkRouteDigest:D('route'),
    queryAnchorDigest:sourceSnapshot.queryAnchor.anchorDigest,result:'qualified',pages:[],resourceKey:'fixture-film',resourceUrl:'https://javdb.com/v/fixture-film',
    resolvedProviderIdentity:{...identity,identityAnchorDigest:canonicalDigest(identity)},descriptiveEntries:[{key:'title',value:'Fixture JAV title'}],peopleHints:[],
    cover:{locator:'https://c0.jdbstatic.com/fixture.jpg',byteDigest:D('image'),byteCount:1000,format:'jpeg',width:800,height:538}};
  raw.observationDigest=canonicalDigest(raw);
  const result=javIdentityObservation(intent,raw),snapshot={run:{libraRunId:'run-1',subjectId:'subject-1',executionBasisDigest:D('basis')},
    spec:{structureKind:'single',contentProfile:'jav',recordDigest:D('spec')},candidateIdentityClaim:{contentProfile:'jav',claimKind:'jav_code',claimedTitle:'IPX-177',javCode:'IPX-177'},episodeClaims:[]};
  const inputBindings={schemaRef:'helix://foundation/types/EventInputBindingSet/v1',schemaVersion:1,bindings:[{portName:'productIdentityEvidenceIntent',
    bindingKind:'projected_owner_facts',ownerDomain:'libra',processType:'libra_run',processId:'run-1',projectionRef:'helix://libra/input-projections/ProductIdentityEvidenceIntent/v1',parameters:{javIntent:intent}}]};
  const evidence={schemaRef:'helix://contracts/capabilities/libra.product_identity.evidence.observe/v1/evidence',schemaVersion:1,evidenceId:'evidence-source',
    evidenceKind:'product_identity_observation',producerRef:capability,basisDigest:intent.intentDigest,payloadDigest:canonicalDigest(result),observedAtMs:2};
  return {intent,raw,result,snapshot,inputBindings,evidence};
}
async function database(run) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-jav-identity-fact-')),databasePath=path.join(root,'test.db');
  const kernel=openSqliteKernel({Database,databasePath,schemaDdl,schemaManifest,now:()=>100});
  const db=new Database(databasePath),unitOfWork=createSqliteUnitOfWork({kernel}),value=fixture();
  try {
    db.prepare('INSERT INTO libra_subjects(subject_id,structure_kind,content_profile,status,intake_revision,current_continuity_set_digest,current_episode_scope_digest) VALUES(?,?,?,?,?,?,?)')
      .run('subject-1','single','jav','active',1,D('continuity'),D('scope'));
    db.prepare('INSERT INTO libra_runs(libra_run_id,subject_id,admission_revision,state,state_revision,state_digest,execution_basis_digest,priority_class,priority_intent_digest,created_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run('run-1','subject-1',1,'active',1,D('state'),D('basis'),'normal',D('priority'),1);
    for(const item of [{suffix:'source',state:'succeeded',capability,input:value.inputBindings},{suffix:'commit',state:'running',capability:'libra.product_identity.resolve@1',input:{schema:'fixture'}}]) {
      db.prepare('INSERT INTO fx_supporting_works(work_id,owner_domain,process_type,process_id,work_kind,basis_digest,priority_class,state,idempotency_key,created_at_ms,updated_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
        .run('work-'+item.suffix,'libra','libra_run','run-1','product_identity',D('basis'),'normal',item.state,'key-'+item.suffix,1,1);
      db.prepare('INSERT INTO fx_work_attempts(attempt_id,work_id,ordinal,basis_digest,state,started_at_ms,finished_at_ms) VALUES(?,?,?,?,?,?,?)')
        .run('attempt-'+item.suffix,'work-'+item.suffix,0,D('attempt'),item.state,1,item.suffix==='source'?2:null);
      db.prepare('INSERT INTO fx_workflow_plans(plan_id,attempt_id,planner_ref,planner_version,catalog_digest,basis_digest,graph_digest,state,created_at_ms) VALUES(?,?,?,?,?,?,?,?,?)')
        .run('plan-'+item.suffix,'attempt-'+item.suffix,'libra.planner',1,D('catalog'),D('basis'),D('graph'),'planned',1);
      db.prepare('INSERT INTO fx_plan_nodes(plan_id,node_id,capability_ref,contract_version,input_binding_schema_ref,input_bindings_json,parameters_json,when_json,fence_basis_json,resource_demand_json) VALUES(?,?,?,?,?,?,?,?,?,?)')
        .run('plan-'+item.suffix,'node-'+item.suffix,item.capability,1,'helix://contracts/test/input/v1',JSON.stringify(item.input),'{}','{}','{}','{}');
      db.prepare('INSERT INTO fx_workflow_events(event_id,plan_id,node_id,work_id,attempt_id,owner_domain,capability_ref,contract_version,state,priority_class,ready_at_ms,result_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
        .run('event-'+item.suffix,'plan-'+item.suffix,'node-'+item.suffix,'work-'+item.suffix,'attempt-'+item.suffix,'libra',item.capability,1,item.suffix==='source'?'succeeded':'executing','normal',1,item.suffix==='source'?'result-source':null);
    }
    db.prepare('INSERT INTO fx_event_attempts(event_attempt_id,event_id,ordinal,executor_ref,executor_version,input_snapshot_schema_ref,input_snapshot_digest,fence_snapshot_digest,state,outcome_kind,started_at_ms,finished_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
      .run('execution-source','event-source',1,'fixture-executor',1,'helix://contracts/test/input/v1',D('snapshot'),D('fence'),'completed','succeeded',1,2);
    db.prepare('INSERT INTO fx_event_result_bindings(result_id,event_id,outcome_kind,result_schema_ref,result_json,result_digest,evidence_schema_ref,evidence_json,evidence_digest,committed_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run('result-source','event-source','succeeded','helix://contracts/capabilities/libra.product_identity.evidence.observe/v1/result',JSON.stringify(value.result),canonicalDigest(value.result),value.evidence.schemaRef,JSON.stringify(value.evidence),canonicalDigest(value.evidence),2);
    const reader=createWorkResultReader({schemaManifest,unitOfWork}),source=reader.read('work-source')[0];
    const bundle=buildProductIdentityCommitBundle({snapshot:value.snapshot,identityClaim:value.snapshot.candidateIdentityClaim,decisionEvidence:decisionEvidence(source.result,value.snapshot),
      productStructure:productStructure(value.snapshot),sourceResultItem:source,libraRunId:'run-1',eventFenceDigest:D('fence')});
    const commit=createDomainCommitCoordinator({schemaManifest,unitOfWork,registry:createDomainCommitRegistry({registrations:createProductFactRegistrations({schemaManifest})}),
      transactionRegistry:createCanonicalTransactionRegistry({contracts:[transaction]})});
    const request={transactionId:'helix.transaction.domain-fact-commit',handle:bundle.handle,payload:bundle.payload,supportingWorkId:'work-commit',outboxMessages:[],
      commitMarker:{commitMarker:'marker-jav',commitDigest:D('commit')},resultBinding:{resultId:'result-jav',eventId:'event-commit',
        evidenceSchemaRef:'helix://contracts/types/LibraProductFactEvidence/v1',evidence:{schemaRef:'helix://contracts/types/LibraProductFactEvidence/v1',schemaVersion:1,evidenceId:'evidence-jav',evidenceDigest:D('evidence')}}};
    await run({db,reader,value,bundle,commit,request});
  }finally{db.close();kernel.close();assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('helix-jav-identity-fact-'));fs.rmSync(root,{recursive:true,force:true});}
}

test('JAV native identity atomically publishes qualified source, Subject lock, Result and marker with optional fields absent',()=>database(({db,reader,bundle,commit,request})=>{
  assert.equal(commit.execute(request).replayed,false);assert.equal(commit.execute(request).replayed,true);
  assert.equal(db.prepare('SELECT current_identity_revision FROM libra_subjects').get().current_identity_revision,1);
  assert.equal(db.prepare('SELECT count(*) n FROM libra_product_identity_revisions').get().n,1);
  assert.equal(db.prepare('SELECT count(*) n FROM fx_commit_markers').get().n,1);
  const stored=JSON.parse(db.prepare('SELECT fact_json FROM libra_product_fact_revisions').get().fact_json);
  assert.equal(stored.identityKind,'jav_code');assert.equal(stored.providerIdentities[0].providerKey,'IPX-177');
  assert.deepEqual(stored.javSourceQualification,bundle.resolvedProductIdentity.javSourceQualification);
  assert.equal(reader.readBindings('work-source')[0].inputBindings.bindings[0].parameters.javIntent.contentProfile,'jav');
}));

for(const change of ['selection','run','identity'])test('JAV late identity commit rejects a newer '+change+' head with zero partial publication',()=>database(({db,commit,request})=>{
  if(change==='selection')db.prepare('INSERT INTO libra_product_identity_selection_intents(selection_intent_id,libra_run_id,intent_revision,selection_kind,provider,namespace,provider_key,idempotency_key,intent_digest,created_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run('new-selection','run-1',1,'provider_id','jav','jav_code','IPX-178','new-key',D('new-selection'),10);
  if(change==='run')db.prepare('UPDATE libra_runs SET state_revision=2').run();
  if(change==='identity') {
    db.prepare('INSERT INTO libra_product_identity_revisions(subject_id,revision,identity_kind,identity_digest) VALUES(?,?,?,?)').run('subject-1',1,'jav_code',D('existing-identity'));
    db.prepare('UPDATE libra_subjects SET current_identity_revision=1').run();
  }
  assert.throws(()=>commit.execute(request),error=>['P9_JAV_IDENTITY_SELECTION_HEAD_STALE','P9_JAV_IDENTITY_SELECTION_FENCE'].includes(error.code));
  assert.equal(db.prepare('SELECT count(*) n FROM libra_product_identity_revisions').get().n,change==='identity'?1:0);
  for(const table of ['libra_product_fact_revisions','libra_product_fact_source_refs','fx_commit_markers'])
    assert.equal(db.prepare('SELECT count(*) n FROM '+table).get().n,0);
  assert.equal(db.prepare("SELECT count(*) n FROM fx_event_result_bindings WHERE result_id='result-jav'").get().n,0);
}));

test('JAV exact revalidation refuses changed preview title or cover and leaves the identity unresolved',()=>{
  const value=fixture();
  for(const fields of [{expectedTitle:'Another title'},{expectedCoverDigest:D('other-image')},{resourceKey:'other-resource'}]) {
    const intent=buildJavIdentityIntent({...value.intent,...fields});
    const result=javIdentityObservation(intent,value.raw);assert.equal(result.result,'conflicting');assert.equal(result.reasonCode,'jav_preview_changed');assert.equal(result.verifiedIdentity,null);
  }
});

test('closed JAV Identity Intent, source Observation and formal Fact schemas retain the full source proof',()=>database(({value,bundle})=>{
  const contracts=path.resolve(__dirname,'../../src/helix/contracts'),schemas=[];
  for(const folder of ['types','domain-types'])for(const name of fs.readdirSync(path.join(contracts,folder))) {
    const file=path.join(contracts,folder,name,'v1/schema.json');if(fs.existsSync(file))schemas.push(JSON.parse(fs.readFileSync(file,'utf8')));
  }
  const validator=createCapabilityContractValidator({schemas});
  validator.validate('helix://contracts/domain-types/ProductIdentityEvidenceIntent/v1',value.intent);
  validator.validate('helix://contracts/types/ProductIdentityEvidenceObservation/v1',value.result);
  validator.validate('helix://contracts/types/ResolvedProductIdentity/v1',bundle.resolvedProductIdentity);
}));
