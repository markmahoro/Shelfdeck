'use strict';

const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),test=require('node:test');
const Database=require('better-sqlite3');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
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

const {buildUsAdultIdentityIntent,observeUsAdultIdentity,originalFromIdentity}=require('../../src/helix/domains/libra/model/us-adult-identity-evidence');
const {observeProductIdentity}=require('../../src/helix/domains/libra/capabilities/routing-capability-ports');
function fixture(){
  const physicalIdentity={materialKey:'primary-1'},sourceHandle={schemaRef:'helix://contracts/types/PhysicalMaterialReadHandle/v1',schemaVersion:1,
    identity:physicalIdentity,ownerDomain:'libra',ownerScope:{scopeType:'libra_run',scopeId:'run-1'},fenceDigest:D('read-fence')},
    snapshot={run:{libraRunId:'run-1',subjectId:'subject-1',executionBasisDigest:D('basis')},spec:{contentProfile:'western_adult',structureKind:'single',recordDigest:D('spec')},
      materialInputForm:'stream_file',members:[{role:'primary_payload',location:'C:/media/Original title [1080p].mp4',physicalIdentity}],
      candidateIdentityClaim:{contentProfile:'western_adult',claimKind:'western_temporary',claimedTitle:'Original title',displayIdentity:'Original title [1080p].mp4'},episodeClaims:[]},
    intent=buildUsAdultIdentityIntent({snapshot,sourceHandle}),result=observeUsAdultIdentity(intent,sourceHandle),
    inputBindings={schemaRef:'helix://foundation/types/EventInputBindingSet/v1',schemaVersion:1,bindings:[{portName:'productIdentityEvidenceIntent',bindingKind:'projected_owner_facts',
      ownerDomain:'libra',processType:'libra_run',processId:'run-1',projectionRef:'helix://libra/input-projections/ProductIdentityEvidenceIntent/v1',parameters:{usAdultIntent:intent}}]},
    evidence={schemaRef:'helix://contracts/capabilities/libra.product_identity.evidence.observe/v1/evidence',schemaVersion:1,evidenceId:'evidence-source',evidenceKind:'product_identity_observation',
      producerRef:capability,basisDigest:intent.intentDigest,payloadDigest:canonicalDigest(result),observedAtMs:2};
  return {snapshot,sourceHandle,intent,result,inputBindings,evidence};
}
async function database(run) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-us-identity-fact-')),databasePath=path.join(root,'test.db');
  const kernel=openSqliteKernel({Database,databasePath,schemaDdl,schemaManifest,now:()=>100});
  const db=new Database(databasePath),unitOfWork=createSqliteUnitOfWork({kernel}),value=fixture();
  try {
    db.prepare('INSERT INTO libra_subjects(subject_id,structure_kind,content_profile,status,intake_revision,current_continuity_set_digest,current_episode_scope_digest) VALUES(?,?,?,?,?,?,?)')
      .run('subject-1','single','western_adult','active',1,D('continuity'),D('scope'));
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
      commitMarker:{commitMarker:'marker-us',commitDigest:D('commit')},resultBinding:{resultId:'result-us',eventId:'event-commit',
        evidenceSchemaRef:'helix://contracts/types/LibraProductFactEvidence/v1',evidence:{schemaRef:'helix://contracts/types/LibraProductFactEvidence/v1',schemaVersion:1,evidenceId:'evidence-us',evidenceDigest:D('evidence')}}};
    await run({db,reader,value,bundle,commit,request});
  }finally{db.close();kernel.close();assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('helix-us-identity-fact-'));fs.rmSync(root,{recursive:true,force:true});}
}


test('US internal identity publishes one formal Subject Fact with original naming provenance and replay',()=>database(({db,reader,bundle,commit,request,value})=>{
  assert.equal(commit.execute(request).replayed,false);assert.equal(commit.execute(request).replayed,true);
  assert.equal(db.prepare('SELECT current_identity_revision FROM libra_subjects').get().current_identity_revision,1);
  const identity=bundle.payload.resolvedProductIdentity,original=originalFromIdentity(identity);
  assert.equal(identity.identityKind,'internal_identity');assert.equal(identity.contentProfile,'western_adult');
  assert.equal(original.originalFileName,'Original title [1080p].mp4');
  const replacement={...value.snapshot,run:{...value.snapshot.run,libraRunId:'replacement-run'},members:[{...value.snapshot.members[0],location:'C:/media/Actor Original title [1080p].mkv'}]},
    sourceHandle={...value.sourceHandle,ownerScope:{scopeType:'libra_run',scopeId:'replacement-run'}};
  const next=buildUsAdultIdentityIntent({snapshot:replacement,sourceHandle,establishedIdentity:identity});
  assert.deepEqual(next.originalName,original);assert.equal(next.internalIdentity,value.intent.internalIdentity);
}));
test('US identity observes only the frozen source and makes no Provider request',async()=>{
  const value=fixture(),result=await observeProductIdentity({searchProviderIdentity:()=>assert.fail('Provider must not be called')},value.intent,value.sourceHandle);
  assert.deepEqual(result,value.result);
  assert.throws(()=>observeUsAdultIdentity(value.intent,{...value.sourceHandle,fenceDigest:D('changed')}));
  assert.throws(()=>buildUsAdultIdentityIntent({snapshot:{...value.snapshot,members:[]},sourceHandle:value.sourceHandle}));
  assert.throws(()=>buildUsAdultIdentityIntent({snapshot:value.snapshot,sourceHandle:{...value.sourceHandle,ownerScope:{scopeId:'foreign'}}}));
});
test('US identity rejects canonical but substituted original filename with zero Fact publication',()=>database(({db,bundle,commit,request})=>{
  const {buildResolvedProductIdentity,buildProductFactHandle}=require('../../src/helix/domains/libra/model/product-fact-contracts'),identity=bundle.payload.resolvedProductIdentity,
    fact=buildResolvedProductIdentity({...identity,displayEntries:identity.displayIdentity.entries.map(item=>item.key==='original_file_name'?{...item,value:'substituted.mp4'}:item)}),
    payload={...bundle.payload,resolvedProductIdentity:fact},handle=buildProductFactHandle({libraRunId:'run-1',factKind:'resolved_identity',expectedRevision:0,payloadDigest:canonicalDigest(payload),eventFenceDigest:bundle.handle.eventFenceDigest});
  assert.throws(()=>commit.execute({...request,handle,payload}),{code:'P9_RESOLVED_IDENTITY_SOURCE_CHAIN'});
  assert.equal(db.prepare('SELECT count(*) n FROM libra_product_identity_revisions').get().n,0);
  assert.equal(db.prepare('SELECT count(*) n FROM fx_commit_markers').get().n,0);
}));
test('US identity intent and Observation satisfy the closed formal schema variants',()=>{
  const value=fixture(),validator=createCapabilityContractValidator({schemas:[require('../../src/helix/contracts/domain-types/ProductIdentityEvidenceIntent/v1/schema.json'),
    require('../../src/helix/contracts/types/ProductIdentityEvidenceObservation/v1/schema.json')]});
  validator.validate('helix://contracts/domain-types/ProductIdentityEvidenceIntent/v1',value.intent);
  validator.validate('helix://contracts/types/ProductIdentityEvidenceObservation/v1',value.result);
});
