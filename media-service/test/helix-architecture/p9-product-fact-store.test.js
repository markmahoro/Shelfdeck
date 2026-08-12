'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const test=require('node:test');
const Database=require('better-sqlite3');
const {canonicalDigest}=require('../../src/helix/contracts/canonical-json');
const {createCanonicalTransactionRegistry,createDomainCommitCoordinator,createDomainCommitRegistry}=require('../../src/helix/foundation/persistence/domain-commit-registry');
const {openSqliteKernel}=require('../../src/helix/foundation/persistence/sqlite-kernel');
const {createSqliteUnitOfWork}=require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const domainFactTransaction=require('../../src/helix/contracts/transaction-contracts/helix.transaction.domain-fact-commit/v1/contract.json');
const {buildArtifactManifestVerification,buildMediaCastDraft,buildMetadataFetchIntent,buildMetadataObservationBasis,
  buildMediaCastFact,buildProductFactHandle,buildProductMetadataDraft}=
  require('../../src/helix/domains/libra/model/product-fact-contracts');
const {createProductFactRegistrations}=require('../../src/helix/domains/libra/persistence/product-fact-store');

const schemaManifest=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../src/helix/foundation/persistence/generated/clean-schema.manifest.json'),'utf8'));
const schemaDdl=fs.readFileSync(path.resolve(__dirname,'../../src/helix/foundation/persistence/generated/clean-schema.sql'),'utf8');
const d=(value)=>canonicalDigest({value});
const providerIdentity=(()=>{const value={provider:'tmdb',namespace:'tmdb_movie',providerKey:'101',seasonNumber:null};
  return Object.freeze({...value,identityAnchorDigest:canonicalDigest(value)});})();

function fixture(factKind='media_cast'){const intent=buildMetadataFetchIntent({libraRunId:'run-1',runExecutionBasisDigest:d('run-basis'),sourceKind:'provider',
  sourcePriority:0,contentProfile:'movie',resolvedIdentityDigest:d('identity'),requestedFields:['title'],providerKind:'tmdb',
  resolvedProviderIdentity:providerIdentity,integrationId:'tmdb',configRevision:1});
  const result={schemaRef:'helix://contracts/types/MetadataObservation/v1',schemaVersion:1,evidenceId:'evidence-1',evidenceKind:'metadata_observation',
    producerRef:'libra.product_metadata.fetch@1',basisDigest:d('basis'),payloadDigest:d('payload'),observedAtMs:1,fetchIntentDigest:intent.intentDigest,
    sourceKind:'provider',sourceRef:'tmdb:tmdb@1',sourcePriority:0,identityDigest:intent.resolvedIdentityDigest,contentProfile:'movie',
    descriptiveFacts:{schemaRef:'helix://contracts/records/descriptive-facts/v1',schemaVersion:1,recordKind:'descriptive-facts',recordDigest:d('facts'),entries:[{key:'title',value:'A'}]},
    providerIdentitySet:{schemaRef:'helix://contracts/records/provider-identity-set/v1',schemaVersion:1,recordKind:'provider-identity-set',
      recordDigest:d('providers'),entries:[providerIdentity]},peopleHints:[],artifactHints:[]};
  const selected={ownerDomain:'libra',processType:'libra_run',processId:'run-1',workKind:'product_metadata_observation',workState:'succeeded',
    capabilityRef:'libra.product_metadata.fetch@1',resultSchemaRef:'helix://contracts/capabilities/libra.product_metadata.fetch/v1/result',result,resultId:'result-source',resultDigest:canonicalDigest(result),
    evidence:result,evidenceDigest:canonicalDigest(result),inputBindings:intent,inputBindingDigest:canonicalDigest(intent),workId:'work-source',attemptId:'attempt-source',planId:'plan-source',eventId:'event-source'};
  const basis=buildMetadataObservationBasis({intents:[intent],results:[selected],factKind,expectedRevision:0});
  const draft=buildMediaCastDraft({subjectId:'subject-1',sourceBasis:basis,relations:[],producedAtMs:1});
  const payload={schema:'libra.media-cast-fact-commit-payload@1',sourceBasis:basis,mediaCastDraft:draft};
  const handle=buildProductFactHandle({libraRunId:'run-1',factKind:'media_cast',expectedRevision:0,payloadDigest:canonicalDigest(payload),eventFenceDigest:d('fence')});
  return {basis,draft,handle,intent,payload,result};}

function metadataFixture(mediaCastFactRef=null){const source=fixture('product_metadata'),requirement={requirementId:'',revision:1,
  schemaRef:'helix://contracts/requirements/poster/v1',artifactKind:'poster',requirementPayload:{minimumWidth:1000},requirementDigest:''};
  requirement.requirementDigest=canonicalDigest({schema:'shared.artifact-requirement@1',revision:1,schemaRef:requirement.schemaRef,
    artifactKind:'poster',requirementPayload:requirement.requirementPayload});
  requirement.requirementId=canonicalDigest({schema:'shared.artifact-requirement-id@1',requirementDigest:requirement.requirementDigest});
  const draft=buildProductMetadataDraft({sourceBasis:source.basis,requiredFields:['title'],producedAtMs:2,providerIdentities:[],
    artifactRequirements:[requirement]}).draft;
  const handle={schemaRef:'helix://contracts/types/ArtifactHandle/v1',schemaVersion:1,artifactHandleId:'artifact-1',artifactKind:'poster',
    ownerDomain:'libra',ownerScope:{scopeType:'libra_run',scopeId:'run-1'},storageRef:'artifact://poster',digestAlgorithm:'sha256',
    digestHex:d('artifact'),sizeBytes:100,mediaType:'image/jpeg',provenanceRef:{objectType:'libra_run',objectId:'run-1',revision:1,digest:d('provenance')},referenceRevision:1};
  const verification=buildArtifactManifestVerification({requirement,artifactHandles:[handle],verifiedAtMs:3});
  const inputBindings={artifactHandleList:[handle],artifactRequirement:requirement},resultDigest=canonicalDigest(verification),
    inputBindingDigest=canonicalDigest(inputBindings);
  const verificationResultRef={workId:'work-verify',attemptId:'attempt-verify',planId:'plan-verify',eventId:'event-verify',resultId:'result-verify',
    capabilityRef:'shared.artifact.manifest.verify@1',resultSchemaRef:'helix://contracts/types/ArtifactManifestVerification/v1',resultDigest,inputBindingDigest};
  const item={ordinal:0,artifactHandleId:handle.artifactHandleId,artifactKind:handle.artifactKind,artifactRevision:handle.referenceRevision,
    artifactDigest:handle.digestHex,requirementId:requirement.requirementId,requirementRevision:requirement.revision,
    requirementSchemaRef:requirement.schemaRef,requirementDigest:requirement.requirementDigest,verificationEvidenceId:verification.verificationId,
    verificationEvidenceDigest:verification.verificationDigest,verificationResultRef};item.referenceDigest=canonicalDigest(item);
  const artifactSetDigest=canonicalDigest({schema:'libra.verified-artifact-set@1',items:[item]}),manifest={manifestId:canonicalDigest({
    schema:'libra.verified-artifact-manifest-id@1',libraRunId:'run-1',artifactSetDigest}),libraRunId:'run-1',items:[item],artifactSetDigest};
  manifest.manifestDigest=canonicalDigest(manifest);
  const payload={schema:'libra.product-metadata-fact-commit-payload@1',sourceBasis:source.basis,productMetadataDraft:draft,
    verifiedArtifactManifest:manifest,mediaCastFactRef};
  const commitHandle=buildProductFactHandle({libraRunId:'run-1',factKind:'product_metadata',expectedRevision:0,
    payloadDigest:canonicalDigest(payload),eventFenceDigest:d('metadata-fence')});
  return {...source,draft,requirement,artifactHandle:handle,verification,inputBindings,manifest,payload,handle:commitHandle};}

test('registers exact Product Fact variants and writes reconstructable Libra Owner rows after preparation',()=>{
  const registrations=createProductFactRegistrations({schemaManifest});
  assert.deepEqual(registrations.map((item)=>item.factType),[
    'media_cast','product_metadata','resolved_identity',
  ]);
  const registry=createDomainCommitRegistry({registrations}),value=fixture(),participant=registry.resolve(value.handle,value.payload,{commitMarker:'marker-1'});
  const inserted={facts:[],sources:[]};
  const foundation={invoke(statement,parameters){const rows={find_work:{work_id:'work-source',owner_domain:'libra',process_type:'libra_run',process_id:'run-1',state:'succeeded'},
    find_attempt:{attempt_id:'attempt-source',work_id:'work-source',state:'succeeded'},find_plan:{plan_id:'plan-source',attempt_id:'attempt-source',state:'planned'},
    find_event:{event_id:'event-source',plan_id:'plan-source',node_id:'node-source',work_id:'work-source',attempt_id:'attempt-source',owner_domain:'libra',capability_ref:'libra.product_metadata.fetch@1',state:'succeeded',result_id:'result-source'},
    find_node:{plan_id:'plan-source',node_id:'node-source',capability_ref:'libra.product_metadata.fetch@1',input_bindings_json:JSON.stringify(value.intent)},
    list_event_attempts:[{event_attempt_id:'event-execution-source',event_id:'event-source',ordinal:1,
      input_snapshot_digest:canonicalDigest(value.intent),state:'completed',outcome_kind:'succeeded'}],
    find_result:{result_id:'result-source',event_id:'event-source',result_schema_ref:'helix://contracts/capabilities/libra.product_metadata.fetch/v1/result',result_json:JSON.stringify(value.result),result_digest:canonicalDigest(value.result),
      evidence_schema_ref:'helix://contracts/types/MetadataObservation/v1',evidence_json:JSON.stringify(value.result),evidence_digest:canonicalDigest(value.result)}};
    assert.ok(parameters);return rows[statement];}};
  const owner={invoke(statement,parameters){if(statement==='find_run')return {libra_run_id:'run-1',subject_id:'subject-1',state:'active',state_revision:1,state_digest:d('state')};
    if(statement==='find_fact')return undefined;if(statement==='insert_fact'){inserted.facts.push(parameters);return {changes:1};}
    if(statement==='insert_source'){inserted.sources.push(parameters);return {changes:1};}throw new Error(statement);}};
  participant.readParticipants[0].execute({repository:()=>foundation});
  const fact=participant.execute({repository:()=>owner,commitTimeMs:10});
  assert.equal(fact.schemaRef,'helix://contracts/types/MediaCastFact/v1');
  participant.postMarkerParticipants[0].execute({repository:()=>owner,commitTimeMs:10});
  assert.equal(inserted.facts.length,1);assert.equal(inserted.sources.length,1);
  assert.equal(inserted.facts[0].commit_marker,'marker-1');
  assert.equal(inserted.facts[0].result_digest,canonicalDigest(fact));
  assert.equal(inserted.sources[0].reference_digest,value.basis.selection.items[0].sourceReferenceDigest);
});

test('persists Product Metadata only after the explicit Requirement, Artifact, Plan input, and Result chain agrees',()=>{
  const mediaSource=fixture(),mediaFact=buildMediaCastFact({libraRunId:'run-1',subjectId:'subject-1',sourceBasis:mediaSource.basis,
    mediaCastDraft:mediaSource.draft,expectedRevision:0,commitMarker:'media-marker',committedAtMs:5});
  const value=metadataFixture({productFactId:mediaFact.factId,factRevision:mediaFact.revision,factDigest:mediaFact.factDigest}),
    registry=createDomainCommitRegistry({registrations:createProductFactRegistrations({schemaManifest})}),
    participant=registry.resolve(value.handle,value.payload,{commitMarker:'marker-metadata'}),inserted={facts:[],sources:[]};
  const sourceRows={work:{work_id:'work-source',owner_domain:'libra',process_type:'libra_run',process_id:'run-1',state:'succeeded'},
    attempt:{attempt_id:'attempt-source',work_id:'work-source',state:'succeeded'},plan:{plan_id:'plan-source',attempt_id:'attempt-source',state:'planned'},
    event:{event_id:'event-source',plan_id:'plan-source',node_id:'node-source',work_id:'work-source',attempt_id:'attempt-source',owner_domain:'libra',capability_ref:'libra.product_metadata.fetch@1',state:'succeeded',result_id:'result-source'}};
  const verifyRows={work:{work_id:'work-verify',owner_domain:'libra',process_type:'libra_run',process_id:'run-1',state:'succeeded'},
    attempt:{attempt_id:'attempt-verify',work_id:'work-verify',state:'succeeded'},plan:{plan_id:'plan-verify',attempt_id:'attempt-verify',state:'planned'},
    event:{event_id:'event-verify',plan_id:'plan-verify',node_id:'node-verify',work_id:'work-verify',attempt_id:'attempt-verify',owner_domain:'libra',capability_ref:'shared.artifact.manifest.verify@1',state:'succeeded',result_id:'result-verify'}};
  const foundation={invoke(statement,parameters){const verify=Object.values(parameters).includes('result-verify')||Object.values(parameters).includes('work-verify')||
    Object.values(parameters).includes('attempt-verify')||Object.values(parameters).includes('plan-verify')||Object.values(parameters).includes('event-verify');
    const rows=verify?verifyRows:sourceRows;if(statement==='find_work')return rows.work;if(statement==='find_attempt')return rows.attempt;
    if(statement==='find_plan')return rows.plan;if(statement==='find_event')return rows.event;
    if(statement==='list_event_attempts')return [{event_attempt_id:verify?'event-execution-verify':'event-execution-source',
      event_id:verify?'event-verify':'event-source',ordinal:1,input_snapshot_digest:canonicalDigest(verify?value.inputBindings:value.intent),
      state:'completed',outcome_kind:'succeeded'}];
    if(statement==='find_node')return verify?{plan_id:'plan-verify',node_id:'node-verify',capability_ref:'shared.artifact.manifest.verify@1',input_bindings_json:JSON.stringify(value.inputBindings)}:
      {plan_id:'plan-source',node_id:'node-source',capability_ref:'libra.product_metadata.fetch@1',input_bindings_json:JSON.stringify(value.intent)};
    if(statement==='find_result'){const verificationEvidence={evidenceId:value.verification.verificationId,evidenceKind:'artifact_verification',producerRef:'shared.artifact.manifest.verify@1',
      basisDigest:value.verification.basisDigest||value.verification.verificationDigest,payloadDigest:canonicalDigest(value.verification),observedAtMs:3};return verify?{result_id:'result-verify',event_id:'event-verify',result_schema_ref:'helix://contracts/capabilities/shared.artifact.manifest.verify/v1/result',
      result_json:JSON.stringify(value.verification),result_digest:canonicalDigest(value.verification),evidence_schema_ref:'helix://contracts/test/evidence/v1',evidence_json:JSON.stringify(verificationEvidence),evidence_digest:canonicalDigest(verificationEvidence)}:
      {result_id:'result-source',event_id:'event-source',result_schema_ref:'helix://contracts/capabilities/libra.product_metadata.fetch/v1/result',result_json:JSON.stringify(value.result),
        result_digest:canonicalDigest(value.result),evidence_schema_ref:'helix://contracts/types/MetadataObservation/v1',evidence_json:JSON.stringify(value.result),evidence_digest:canonicalDigest(value.result)};}
    if(statement==='find_artifact')return {artifact_handle_id:value.artifactHandle.artifactHandleId,
      artifact_kind:value.artifactHandle.artifactKind,owner_domain:value.artifactHandle.ownerDomain,
      owner_scope_type:value.artifactHandle.ownerScope.scopeType,owner_scope_id:value.artifactHandle.ownerScope.scopeId,
      storage_ref:value.artifactHandle.storageRef,digest_algorithm:value.artifactHandle.digestAlgorithm,
      digest_hex:value.artifactHandle.digestHex,size_bytes:value.artifactHandle.sizeBytes,
      media_type:value.artifactHandle.mediaType,provenance_ref:JSON.stringify(value.artifactHandle.provenanceRef),
      reference_revision:value.artifactHandle.referenceRevision,state:'active'};throw new Error(statement);}};
  const owner={invoke(statement,parameters){if(statement==='find_run')return {libra_run_id:'run-1',subject_id:'subject-1',state:'active',state_revision:1,state_digest:d('state')};
    if(statement==='find_fact')return undefined;if(statement==='find_fact_by_id')return {product_fact_id:mediaFact.factId,libra_run_id:'run-1',fact_kind:'media_cast',
      fact_revision:mediaFact.revision,schema_ref:mediaFact.schemaRef,fact_json:JSON.stringify(mediaFact),fact_digest:mediaFact.factDigest,
      commit_marker:mediaFact.commitMarker,result_digest:canonicalDigest(mediaFact)};
    if(statement==='insert_fact'){inserted.facts.push(parameters);return {changes:1};}
    if(statement==='insert_source'){inserted.sources.push(parameters);return {changes:1};}throw new Error(statement);}};
  participant.readParticipants[0].execute({repository:()=>foundation});
  const crossRunOwner={invoke(statement,parameters){const row=owner.invoke(statement,parameters);
    return statement==='find_fact_by_id'?{...row,libra_run_id:'other-run'}:row;}};
  assert.throws(()=>participant.execute({repository:()=>crossRunOwner,commitTimeMs:20}),
    (error)=>error.code==='P9_PRODUCT_METADATA_CAST_REF_MISMATCH');
  assert.deepEqual(inserted,{facts:[],sources:[]});
  const fact=participant.execute({repository:()=>owner,commitTimeMs:20});
  participant.postMarkerParticipants[0].execute({repository:()=>owner,commitTimeMs:20});
  assert.equal(fact.schemaRef,'helix://contracts/types/ProductMetadataFact/v1');assert.deepEqual(fact.mediaCastFactRef,value.payload.mediaCastFactRef);
  assert.equal(inserted.facts[0].artifact_verification_result_count,1);
  assert.equal(inserted.facts[0].verified_artifact_manifest_digest,value.manifest.manifestDigest);
});

function withProductDatabase(run){const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-p9-fact-')),databasePath=path.join(root,'db.sqlite');let now=100;
  const kernel=openSqliteKernel({Database,databasePath,schemaDdl,schemaManifest,now:()=>now++});
  try{return run({databasePath,kernel,unitOfWork:createSqliteUnitOfWork({kernel})});}finally{kernel.close();fs.rmSync(root,{recursive:true,force:true});}}

function seedProductDatabase(kernel,value){kernel.runPrimitive(({prepare})=>{
  prepare('INSERT INTO libra_subjects(subject_id,structure_kind,content_profile,status,intake_revision,current_continuity_set_digest,current_episode_scope_digest,created_at_ms,updated_at_ms) VALUES(?,?,?,?,?,?,?,?,?)').run('subject-1','single','movie','active',1,d('continuity'),d('episodes'),1,1);
  prepare('INSERT INTO libra_runs(libra_run_id,subject_id,admission_revision,state,state_revision,state_digest,priority_class,priority_intent_digest,created_at_ms) VALUES(?,?,?,?,?,?,?,?,?)').run('run-1','subject-1',1,'active',1,d('state'),'normal',d('priority'),1);
  for(const item of [{suffix:'source',state:'succeeded',capability:'libra.product_metadata.fetch@1',input:value.intent,result:value.result},
    {suffix:'commit',state:'running',capability:'libra.product_fact.commit@1',input:{schema:'libra.product-fact-commit-input@1'},result:null}]){
    prepare('INSERT INTO fx_supporting_works(work_id,owner_domain,process_type,process_id,work_kind,basis_digest,priority_class,state,idempotency_key,created_at_ms,updated_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(`work-${item.suffix}`,'libra','libra_run','run-1','product_fact',d(`basis-${item.suffix}`),'normal',item.state,`key-${item.suffix}`,1,1);
    prepare('INSERT INTO fx_work_attempts(attempt_id,work_id,ordinal,basis_digest,state,started_at_ms,finished_at_ms) VALUES(?,?,?,?,?,?,?)').run(`attempt-${item.suffix}`,`work-${item.suffix}`,0,d(`attempt-${item.suffix}`),item.state,1,item.state==='succeeded'?2:null);
    prepare('INSERT INTO fx_workflow_plans(plan_id,attempt_id,planner_ref,planner_version,catalog_digest,basis_digest,graph_digest,state,created_at_ms) VALUES(?,?,?,?,?,?,?,?,?)').run(`plan-${item.suffix}`,`attempt-${item.suffix}`,'libra.planner',1,d('catalog'),d(`plan-basis-${item.suffix}`),d(`graph-${item.suffix}`),'planned',1);
    prepare('INSERT INTO fx_plan_nodes(plan_id,node_id,capability_ref,contract_version,input_binding_schema_ref,input_bindings_json,parameters_json,when_json,fence_basis_json,resource_demand_json) VALUES(?,?,?,?,?,?,?,?,?,?)').run(`plan-${item.suffix}`,`node-${item.suffix}`,item.capability,1,'helix://contracts/test/input/v1',JSON.stringify(item.input),'{}','{}','{}','{}');
    prepare('INSERT INTO fx_workflow_events(event_id,plan_id,node_id,work_id,attempt_id,owner_domain,capability_ref,contract_version,state,priority_class,ready_at_ms,result_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(`event-${item.suffix}`,`plan-${item.suffix}`,`node-${item.suffix}`,`work-${item.suffix}`,`attempt-${item.suffix}`,'libra',item.capability,1,item.state==='succeeded'?'succeeded':'executing','normal',1,item.result?'result-source':null);
    if(item.result)prepare('INSERT INTO fx_event_attempts(event_attempt_id,event_id,ordinal,executor_ref,executor_version,input_snapshot_schema_ref,input_snapshot_digest,fence_snapshot_digest,state,outcome_kind,retry_after_ms,failure_class,failure_code,evidence_digest,started_at_ms,finished_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(`event-execution-${item.suffix}`,`event-${item.suffix}`,1,'test-executor',1,'helix://contracts/test/input/v1',
        canonicalDigest(item.input),d(`fence-${item.suffix}`),'completed','succeeded',null,null,null,d(`attempt-evidence-${item.suffix}`),1,2);
  }
  prepare('INSERT INTO fx_event_result_bindings(result_id,event_id,outcome_kind,result_schema_ref,result_json,result_digest,evidence_schema_ref,evidence_json,evidence_digest,committed_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?)').run('result-source','event-source','succeeded','helix://contracts/capabilities/libra.product_metadata.fetch/v1/result',JSON.stringify(value.result),canonicalDigest(value.result),'helix://contracts/types/MetadataObservation/v1',JSON.stringify(value.result),canonicalDigest(value.result),2);
});}

function coordinator(unitOfWork){return createDomainCommitCoordinator({schemaManifest,unitOfWork,
  registry:createDomainCommitRegistry({registrations:createProductFactRegistrations({schemaManifest})}),
  transactionRegistry:createCanonicalTransactionRegistry({contracts:[domainFactTransaction]})});}

function commitRequest(value){return {transactionId:'helix.transaction.domain-fact-commit',handle:value.handle,payload:value.payload,supportingWorkId:'work-commit',outboxMessages:[],
  commitMarker:{commitMarker:'marker-product-fact',commitDigest:d('commit')},resultBinding:{resultId:'result-product-fact',eventId:'event-commit',evidenceSchemaRef:'helix://contracts/types/LibraProductFactEvidence/v1',evidence:{schemaRef:'helix://contracts/types/LibraProductFactEvidence/v1',schemaVersion:1,evidenceId:'evidence-product-fact',evidenceDigest:d('fact-evidence')}}};}

test('commits Result, marker, Product Fact, and source refs atomically in the clean SQLite schema',()=>withProductDatabase(({databasePath,kernel,unitOfWork})=>{
  const value=fixture();seedProductDatabase(kernel,value);const result=coordinator(unitOfWork).execute(commitRequest(value));assert.equal(result.replayed,false);
  const db=new Database(databasePath,{readonly:true});for(const table of ['fx_event_result_bindings','fx_commit_markers','libra_product_fact_revisions','libra_product_fact_source_refs']){
    const expected=table==='fx_event_result_bindings'?2:1;assert.equal(db.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count,expected);}
  const fact=db.prepare('SELECT fact_json,fact_digest,commit_marker,result_digest FROM libra_product_fact_revisions').get(),typed=JSON.parse(fact.fact_json);
  assert.equal(canonicalDigest(typed),fact.result_digest);assert.equal(typed.factDigest,fact.fact_digest);assert.equal(fact.commit_marker,'marker-product-fact');
  assert.equal(db.prepare('SELECT COUNT(*) count FROM fx_outbox').get().count,0);db.close();
}));

test('rolls back Result and marker when the post-marker Libra Owner write crashes',()=>withProductDatabase(({databasePath,kernel,unitOfWork})=>{
  const value=fixture();seedProductDatabase(kernel,value);const crashing={execute(participants){return unitOfWork.execute(participants.map((participant)=>participant.participantId!=='libra_product_fact_owner_write'?participant:{...participant,execute(){throw new Error('fixture-owner-write-crash');}}));}};
  assert.throws(()=>coordinator(crashing).execute(commitRequest(value)),/fixture-owner-write-crash/);const db=new Database(databasePath,{readonly:true});
  assert.equal(db.prepare("SELECT COUNT(*) count FROM fx_event_result_bindings WHERE result_id='result-product-fact'").get().count,0);
  for(const table of ['fx_commit_markers','libra_product_fact_revisions','libra_product_fact_source_refs'])assert.equal(db.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count,0);db.close();
}));
