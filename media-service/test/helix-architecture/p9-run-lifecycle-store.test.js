'use strict';

const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const test=require('node:test');const Database=require('better-sqlite3');
const {canonicalDigest,canonicalJson}=require('../../src/helix/contracts/canonical-json');const {openSqliteKernel}=require('../../src/helix/foundation/persistence/sqlite-kernel');const {createSqliteUnitOfWork}=require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const {activeRunScopeSetDigest,buildProductionMaterialManifest,buildRunAdmissionDecision,buildRunExecutionBasis}=require('../../src/helix/domains/libra/model/run-admission-contracts');const {buildRunLifecycleDecision}=require('../../src/helix/domains/libra/model/run-lifecycle-contracts');const {createRunAdmissionStore}=require('../../src/helix/domains/libra/persistence/run-admission-store');const {comparable,createRunLifecycleStore}=require('../../src/helix/domains/libra/persistence/run-lifecycle-store');
const {buildRunDiscardCommand}=require('../../src/helix/domains/libra/model/run-discard-contracts');const {createRunDiscardStore}=require('../../src/helix/domains/libra/persistence/run-discard-store');
const generated=path.resolve(__dirname,'../../src/helix/foundation/persistence/generated'),schemaDdl=fs.readFileSync(path.join(generated,'clean-schema.sql'),'utf8'),schemaManifest=JSON.parse(fs.readFileSync(path.join(generated,'clean-schema.manifest.json'),'utf8')),D=(value)=>canonicalDigest({value});
const EMPTY_RELATED_SCOPE={relatedReferenceSetDigest:canonicalDigest({schema:'procurement.related-reference-set@1',items:[]}),relatedDispositionScopeDigest:canonicalDigest({schema:'procurement.related-disposition-scope@1',items:[]}),items:[]};
const lifecycleTransaction=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../src/helix/contracts/transaction-contracts/helix.transaction.libra-run-lifecycle-transition/v1/contract.json'),'utf8')).contract;
function projection(materialKey){const value={materialKey,resultKind:'available',controlRevision:2,controlState:'controlled',ownerDomain:'libra',ownerScopeType:'subject',ownerScopeId:'subject-1',regionProjection:'production'},evidenceDigest=canonicalDigest({schema:'foundation.material-control-evidence@1',materialKey,resultKind:'available',controlRevision:2,controlState:'controlled',ownerDomain:'libra',ownerScopeType:'subject',ownerScopeId:'subject-1'});return {...value,evidenceDigest,projectionDigest:canonicalDigest({...value,evidenceDigest})};}
function fixture(run,config={}){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'helix-p9-life-')),databasePath=path.join(dir,'db.sqlite');let now=1000;const contentProfile=config.contentProfile||'movie';openSqliteKernel({Database,databasePath,schemaDdl,schemaManifest,now:()=>now++}).close();const db=new Database(databasePath),identity={mountScopeId:'mount-1',inode:'11',sizeBytes:100,fingerprintAlgorithm:'middle-256k-sha256',fingerprintVersion:1,contentFingerprint:D('content')},materialKey=canonicalDigest({schema:'physical-material-identity@2',...identity}),control=projection(materialKey),productScopeDigest=canonicalDigest({schema:'libra.product-scope@1',subjectId:'subject-1',scopeKind:'single',subjectIntakeRevision:1,episodeKeys:[]}),requirements=config.requirements||{identity:{},structure:{structureKind:'single'},metadata:{},mandatoryMedia:{},space:{},inventory:{}},spec={contentProfile,structureKind:'single',subjectId:'subject-1',acceptanceSpecId:'spec-1',specRevision:1,specDigest:D('spec'),recordDigest:D('record'),productScopeDigest,productScope:{subjectId:'subject-1',scopeKind:'single',subjectIntakeRevision:1,episodeKeys:[],scopeDigest:productScopeDigest},shelfId:'shelf-1',requirements},headBase={subjectId:'subject-1',headRevision:4,currentRoutingDecisionId:null,currentDecisionBasisId:'basis-1',currentAcceptanceSpecId:'spec-1'},headDigest=canonicalDigest({schema:'libra.subject-decision-head@1',...headBase});
  Object.assign(identity,{schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v2',schemaVersion:2,materialKey});
  db.prepare('INSERT INTO libra_intake_decisions (intake_decision_id,candidate_package_id,source_field_id,source_field_access_revision,source_field_context_digest,candidate_identity_claim_digest) VALUES (?,?,?,?,?,?)').run('intake-1','candidate-1','field-1',1,D('field'),D('claim'));
  db.prepare('INSERT INTO libra_subjects (subject_id,structure_kind,content_profile,routing_anchor_intake_decision_id,status,intake_revision,current_continuity_set_digest,current_episode_scope_digest) VALUES (?,?,?,?,?,?,?,?)').run('subject-1','single',contentProfile,'intake-1','active',1,D('continuity'),D('episodes'));
  db.prepare('INSERT INTO libra_decision_basis_revisions (decision_basis_id,subject_id,basis_kind,basis_revision,expected_head_revision,expected_head_snapshot_digest,routing_decision_id,query_result_set_digest,routing_input_digest,spec_input_digest,product_scope_digest,input_set_digest,status,basis_digest,committed_at_ms) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('basis-1','subject-1','acceptance_spec',1,3,D('old-head'),null,D('queries'),null,D('spec-input'),productScopeDigest,D('inputs'),'ready',D('basis'),1);
  db.prepare('INSERT INTO libra_acceptance_specs (acceptance_spec_id,subject_id,shelf_id,shelf_routing_projection_revision,shelf_projection_digest,shelf_standard_revision,shelf_standard_digest,decision_basis_id,product_scope_digest,spec_revision,spec_schema_ref,spec_json,spec_digest,record_digest,structure_kind,content_profile,published_at_ms) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('spec-1','subject-1','shelf-1',1,D('projection'),1,D('standard'),'basis-1',productScopeDigest,1,'AcceptanceSpec@1',canonicalJson(spec),spec.specDigest,spec.recordDigest,'single',contentProfile,1);
  db.prepare('INSERT INTO libra_subject_decision_heads (subject_id,head_revision,head_digest,current_routing_decision_id,current_decision_basis_id,current_acceptance_spec_id,updated_at_ms) VALUES (?,?,?,?,?,?,?)').run('subject-1',4,headDigest,null,'basis-1','spec-1',1);
  db.prepare('INSERT INTO libra_material_bindings (subject_id,material_key,role,authority_kind,primary_material_key,association_evidence_digest,disposition_basis_digest,mount_scope_id,inode,fingerprint_algorithm,fingerprint_version,content_fingerprint,size_bytes,endpoint_id,location,binding_revision,health_state,evidence_digest,origin_intake_decision_id,origin_offer_id,origin_candidate_package_id,origin_package_revision,origin_package_digest,origin_candidate_delivery_snapshot_digest,origin_related_reference_set_digest,origin_related_disposition_scope_digest,current) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('subject-1',materialKey,'primary_payload','primary_control',null,null,null,identity.mountScopeId,identity.inode,identity.fingerprintAlgorithm,identity.fingerprintVersion,identity.contentFingerprint,100,'endpoint-1','/library/input.mkv',1,'active',D('binding'),'intake-1','offer-1','candidate-1',1,D('package'),D('delivery'),D('related'),D('related-scope'),1);
  db.prepare('INSERT INTO fx_material_controls VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(materialKey,identity.mountScopeId,identity.inode,identity.sizeBytes,identity.fingerprintAlgorithm,identity.fingerprintVersion,identity.contentFingerprint,'libra','subject','subject-1',2,'controlled',1);db.prepare('INSERT INTO fx_material_control_revisions VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(materialKey,1,'acquire',null,null,null,'libra','subject','subject-1',D('control-1'),'control-marker-1',1);db.prepare('INSERT INTO fx_material_control_revisions VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(materialKey,2,'replace_control_set','libra','subject','subject-1','libra','subject','subject-1',D('control-2'),'control-marker-2',2);db.close();
  const kernel=openSqliteKernel({Database,databasePath,schemaDdl,schemaManifest,now:()=>now++}),unitOfWork=createSqliteUnitOfWork({kernel}),libraRunId=canonicalDigest({schema:'libra.run-id@1',subjectId:'subject-1',admissionRevision:1}),member={materialKey,role:'primary_payload',physicalIdentity:identity,sizeBytes:100,location:{locationKind:'domain_binding',endpointId:'endpoint-1',location:'/library/input.mkv'},bindingKind:'libra_material_binding',bindingRevision:1,bindingEvidenceDigest:D('binding'),originCandidateDeliveryRef:{intakeDecisionId:'intake-1',offerId:'offer-1',candidatePackageId:'candidate-1',packageRevision:1,packageDigest:D('package'),candidateDeliverySnapshotDigest:D('delivery'),relatedReferenceSetDigest:D('related')},admittedControlRevision:2,admittedControlProjectionDigest:control.projectionDigest,episodeClaims:[]},manifest=buildProductionMaterialManifest({manifestRole:'run_input',manifestRevision:1,libraRunId,scopeKind:'single',members:[member]},spec),headSnapshot={...headBase,headState:'present',headDigest};headSnapshot.snapshotDigest=canonicalDigest({schema:'libra.subject-decision-head-snapshot@1',...headSnapshot});const basis=buildRunExecutionBasis({subjectSnapshot:{subjectId:'subject-1',intakeRevision:1,structureKind:'single',contentProfile,continuitySetDigest:D('continuity'),episodeScopeDigest:D('episodes')},decisionHeadSnapshot:headSnapshot,acceptanceSpec:spec,shelfProjection:{routingProjectionRevision:1,projectionDigest:D('projection'),standardRevision:1,standardDigest:D('standard')},productionMaterialManifest:manifest,relatedDispositionScope:EMPTY_RELATED_SCOPE}),admissionDecision=buildRunAdmissionDecision({admissionKind:'initial',subjectId:'subject-1',expectedRunAdmissionHead:{headState:'absent',headRevision:0,activeScopeSetDigest:activeRunScopeSetDigest('subject-1',[])},runExecutionBasis:basis,initialPriority:{priorityClass:'normal',priorityIntentDigest:canonicalDigest({schema:'libra.priority-intent-empty@1'})}}),admitted=createRunAdmissionStore({schemaManifest,unitOfWork}).admit({decision:admissionDecision,commitMarker:'admit-marker',resultId:'admit-result'}).result;
  const basisSnapshot=comparable({subjectId:'subject-1',structureKind:'single',contentProfile,acceptanceSpecRef:{acceptanceSpecId:'spec-1',specRevision:1,specDigest:spec.specDigest,recordDigest:spec.recordDigest},productScopeDigest,members:[{materialKey,role:'primary_payload',physicalIdentity:identity,sizeBytes:100,bindingRevision:1,bindingEvidenceDigest:D('binding'),episodeClaimSetDigest:manifest.members[0].episodeClaimSetDigest,controlRevision:2,controlProjectionDigest:control.projectionDigest,outputRequirementDigest:manifest.members[0].outputRequirementDigest}]});try{return run({databasePath,unitOfWork,libraRunId,admitted,basisSnapshot,headSnapshot,identity,materialKey});}finally{kernel.close();fs.rmSync(dir,{recursive:true,force:true});}}
function policy(){const value={policyRef:'libra.run-recovery.beta@1',policyRevision:1,assessmentOffsetsMs:[60000,300000,900000,1800000,3600000],maxRecoveryAssessments:5,heavyPermitAllowed:false,frozenAutoResumeAllowed:false};value.policyDigest=canonicalDigest(value);return value;}
function freshness(input,readiness='ready'){const value={libraRunId:input.libraRunId,expectedState:{state:'active',stateRevision:input.admitted.stateRevision,stateDigest:input.admitted.stateDigest},assessmentKind:'active_checkpoint',recoveryPolicy:policy(),recoveryEpisode:{attemptOrdinal:0},assessedAtMs:2000,currentDecisionHead:input.headSnapshot,originalBasis:input.basisSnapshot,readiness,unresolvedReasonCodes:readiness==='ready'?[]:['decision_basis_unresolved'],dimensionResults:['acceptance_spec','product_scope','material_binding','material_control','output_requirement'].map((dimension)=>({dimension,result:readiness==='ready'?'same':'unresolved',evidenceDigest:D(dimension)})),comparison:readiness==='ready'?'same':'unresolved'};if(readiness==='ready')value.currentBasis=input.basisSnapshot;value.assessmentId=canonicalDigest({schema:'libra.run-freshness-assessment-id@1',libraRunId:input.libraRunId,expectedStateRevision:input.admitted.stateRevision,assessmentKind:'active_checkpoint',attemptOrdinal:0,currentDecisionHeadDigest:input.headSnapshot.snapshotDigest});value.assessmentDigest=canonicalDigest(value);return value;}
function lifecycleDecision(input,evidence,transitionKind){return buildRunLifecycleDecision({libraRunId:input.libraRunId,expectedStateRevision:input.admitted.stateRevision,expectedStateDigest:input.admitted.stateDigest,transitionKind,transitionEvidence:evidence,expectedAdmissionHeadRevision:input.admitted.committedAdmissionHeadRevision,expectedActiveScopeSetDigest:input.admitted.activeScopeSetDigest});}
function sizeCapTerminal(input,reasonCodes,verification=null){
  const capabilityRef='libra.product_media.verify@1',workId='size-cap-work',planId='size-cap-plan',eventId='size-cap-event',
    workBasisDigest=D('size-cap-basis'),retryPolicyDigest=D('size-cap-retry'),payload=verification||{result:'failed',reasonCodes},
    resultDigest=canonicalDigest(payload),db=new Database(input.databasePath);
  db.prepare('INSERT INTO fx_supporting_works (work_id,owner_domain,process_type,process_id,work_kind,basis_digest,priority_class,state,idempotency_key,created_at_ms,updated_at_ms) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(workId,'libra','libra_run',input.libraRunId,'workspace_media_production',workBasisDigest,'normal','succeeded','size-cap-key',1,2);
  db.prepare('INSERT INTO fx_workflow_plans (plan_id,attempt_id,planner_ref,planner_version,catalog_digest,basis_digest,graph_digest,state,created_at_ms) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(planId,null,'planner',1,D('catalog'),workBasisDigest,D('graph'),'planned',1);
  db.prepare('INSERT INTO fx_workflow_events (event_id,plan_id,node_id,work_id,attempt_id,owner_domain,capability_ref,contract_version,state,priority_class,result_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(eventId,planId,'node-1',workId,null,'libra',capabilityRef,1,'succeeded','normal','size-cap-result');
  db.prepare('INSERT INTO fx_event_attempts (event_attempt_id,event_id,ordinal,state,outcome_kind,started_at_ms,finished_at_ms) VALUES (?,?,?,?,?,?,?)')
    .run('size-cap-attempt',eventId,1,'completed','succeeded',1,2);
  db.prepare('INSERT INTO fx_event_result_bindings (result_id,event_id,outcome_kind,result_schema_ref,result_json,result_digest,committed_at_ms) VALUES (?,?,?,?,?,?,?)')
    .run('size-cap-result',eventId,'succeeded','helix://contracts/types/ProductMediaVerification/v1',canonicalJson(payload),resultDigest,2);
  db.close();
  const store=createRunLifecycleStore({schemaManifest,unitOfWork:input.unitOfWork,
    resolveRetryPolicyDigest:(ref)=>ref===capabilityRef?retryPolicyDigest:null}),built=store.buildTerminalEvidence({
      libraRunId:input.libraRunId,workId,blockerKind:'product_unachievable',assessedAtMs:2000,
      terminalResult:{eventId,failureClass:'business_unachievable',failureCode:'size_cap_requires_admission',resultDigest}});
  return {store,built};
}

test('unavailable integration exhausts bounded checks into attention without ending business responsibility',()=>fixture(input=>{
  let at=10000;
  const make=()=>require('../../src/helix/domains/libra/application/libra-run-admin-service').createLibraRunAdminService({
    schemaManifest,unitOfWork:input.unitOfWork,now:()=>at,libraRunExecutionProjection:{invalidate(){}},
    readFailureRecoveryConditions:kinds=>kinds.map(conditionKind=>({conditionKind,snapshotDigest:D('unavailable-provider')}))});
  let service=make();
  assert.equal(service.waitUnavailableStrategy(input.libraRunId,'tmdb','product_metadata_integration_unavailable').kind,'waiting_external_integration');
  const db=new Database(input.databasePath,{readonly:true});
  const initialRevision=db.prepare('SELECT state_revision FROM libra_runs').get().state_revision;
  for(let i=0;i<3;i++)service.waitUnavailableStrategy(input.libraRunId,'tmdb','product_metadata_integration_unavailable');
  assert.equal(db.prepare('SELECT state_revision FROM libra_runs').get().state_revision,initialRevision);
  service=make();
  for(const offset of [60000,300000,900000,1800000]) {at=10000+offset;
    assert.equal(service.waitUnavailableStrategy(input.libraRunId,'tmdb','product_metadata_integration_unavailable').kind,'waiting_external_integration');}
  assert.equal(db.prepare('SELECT state FROM libra_runs').get().state,'active');
  at=3610000;assert.equal(service.waitUnavailableStrategy(input.libraRunId,'tmdb','product_metadata_integration_unavailable').kind,'frozen');
  assert.equal(service.reconcileFrozen(input.libraRunId).kind,'attention_required');
  assert.equal(service.readOutcome(input.libraRunId),null);
  assert.equal(db.prepare('SELECT count(*) n FROM fx_supporting_works').get().n,0);
  assert.equal(db.prepare('SELECT count(*) n FROM libra_run_outcomes').get().n,0);
  assert.equal(db.prepare('SELECT state FROM libra_runs').get().state,'frozen');
  assert.equal(db.prepare('SELECT status FROM libra_subjects').get().status,'active');
  assert.ok(db.prepare('SELECT state FROM fx_material_controls').all().every(row=>row.state==='controlled'));db.close();
}));

for(const changeAt of ['observation','freeze'])test('strategy availability '+changeAt+' uses a fresh Owner fence',()=>fixture(input=>{
  let at=10000;const common={schemaManifest,unitOfWork:input.unitOfWork,now:()=>at,libraRunExecutionProjection:{invalidate(){}},
    readFailureRecoveryConditions:kinds=>kinds.map(conditionKind=>({conditionKind,snapshotDigest:D('unavailable-provider')}))},
    create=require('../../src/helix/domains/libra/application/libra-run-admin-service').createLibraRunAdminService;
  if(changeAt==='freeze'){
    const seed=create(common);
    for(const offset of [0,60000,300000,900000,1800000]){at=10000+offset;seed.waitUnavailableStrategy(input.libraRunId,'tmdb','product_metadata_integration_unavailable');}
    at=3610000;
  }
  let checks=0;
  const service=create({...common,runExecutionGuard:{check(){const readFence=input.unitOfWork.captureReadFence();
    if(++checks===(changeAt==='observation'?1:2)){const db=new Database(input.databasePath);
      try{db.prepare('UPDATE libra_subjects SET updated_at_ms=coalesce(updated_at_ms,0)+1').run();}finally{db.close();}}
    return {kind:'ready',readFence};}}});
  assert.throws(()=>service.waitUnavailableStrategy(input.libraRunId,'tmdb','product_metadata_integration_unavailable'),
    {code:'LIBRA_RUN_EXECUTION_DEFERRED',reasonCode:'owner_view_changed'});
  const db=new Database(input.databasePath,{readonly:true});try{
    assert.equal(db.prepare('SELECT state FROM libra_runs').get().state,'active');
    assert.equal(db.prepare('SELECT count(*) n FROM libra_strategy_availability').get().n,changeAt==='observation'?0:6);
  }finally{db.close();}
}));

test('UAT-251 exhausted Freshness recovery closes from its actual Assessment without a failed Work',()=>fixture(input=>{
  const db=new Database(input.databasePath);
  try {
  db.prepare("UPDATE libra_decision_basis_revisions SET status='unresolved',unresolved_reason_code='required_input_missing' WHERE decision_basis_id='basis-1'").run();
  let at=2000;const options={schemaManifest,unitOfWork:input.unitOfWork,now:()=>at,libraRunExecutionProjection:{invalidate(){}}};
  const lifecycle=require('../../src/helix/domains/libra/application/libra-run-lifecycle-service').createLibraRunLifecycleService(options);
  assert.equal(lifecycle.reconcile(input.libraRunId).kind,'suspend');
  for(const offset of [60000,300000,900000,1800000,3600000]){at=2000+offset;lifecycle.reconcile(input.libraRunId);}
  assert.equal(db.prepare('SELECT state FROM libra_runs').get().state,'frozen');
  const admin=require('../../src/helix/domains/libra/application/libra-run-admin-service').createLibraRunAdminService(options);
  assert.equal(admin.previewDefects(input.libraRunId).eligibility,'ineligible');
  const extraIdentity={...input.identity,inode:'999'},extraKey=canonicalDigest({schema:'physical-material-identity@2',...extraIdentity});
  db.prepare('INSERT INTO fx_material_controls(material_key,mount_scope_id,inode,size_bytes,fingerprint_algorithm,fingerprint_version,content_fingerprint,owner_domain,owner_scope_type,owner_scope_id,control_revision,state,updated_at_ms) VALUES (?,?,?,?,?,?,?,\'libra\',\'subject\',\'subject-1\',1,\'controlled\',1)')
    .run(extraKey,extraIdentity.mountScopeId,extraIdentity.inode,extraIdentity.sizeBytes,extraIdentity.fingerprintAlgorithm,String(extraIdentity.fingerprintVersion),extraIdentity.contentFingerprint);
  assert.throws(()=>admin.reconcileFrozen(input.libraRunId),{code:'P9_DISCARD_SUBJECT_RESPONSIBILITY_PENDING'});
  assert.equal(db.prepare('SELECT state FROM libra_runs').get().state,'frozen');
  assert.equal(db.prepare('SELECT status FROM libra_subjects').get().status,'active');
  assert.equal(db.prepare('SELECT count(*) n FROM libra_run_discard_receipts').get().n,0);
  assert.equal(db.prepare('SELECT state FROM fx_material_controls WHERE material_key=?').get(input.materialKey).state,'controlled');
  db.prepare('DELETE FROM fx_material_controls WHERE material_key=?').run(extraKey);
  assert.equal(admin.reconcileFrozen(input.libraRunId).kind,'unable_to_on_deck');
  assert.equal(admin.readOutcome(input.libraRunId).reasonCode,'processing_failed');
  assert.deepEqual(admin.readOutcome(input.libraRunId).terminalReasons,[]);
  assert.equal(db.prepare('SELECT status FROM libra_subjects').get().status,'ended');
  assert.equal(db.prepare('SELECT count(*) n FROM libra_task_cancellations').get().n,0);
  assert.equal(db.prepare('SELECT count(*) n FROM fx_supporting_works').get().n,0);
  }finally{db.close();}
}));

test('atomically confirms owner-row freshness and replays the durable lifecycle Result',()=>fixture((input)=>{const store=createRunLifecycleStore({schemaManifest,unitOfWork:input.unitOfWork}),decision=lifecycleDecision(input,freshness(input),'freshness_confirmed'),first=store.transition({decision,commitMarker:'life-marker',resultId:'life-result'}),replay=store.transition({decision,commitMarker:'life-marker',resultId:'life-result'});assert.equal(first.replayed,false);assert.equal(replay.replayed,true);assert.deepEqual(replay.result,first.result);const db=new Database(input.databasePath,{readonly:true}),run=db.prepare('SELECT state,state_revision,latest_freshness_assessment_id FROM libra_runs').get();assert.equal(run.state,'active');assert.equal(run.state_revision,2);assert.equal(run.latest_freshness_assessment_id,decision.transitionEvidence.assessmentId);assert.equal(db.prepare('SELECT COUNT(*) n FROM libra_run_revisions').get().n,2);assert.equal(db.prepare('SELECT COUNT(*) n FROM fx_outbox').get().n,0);db.close();}));

test('stale Owner fence cannot commit a new Run lifecycle transition',()=>fixture(input=>{
  const store=createRunLifecycleStore({schemaManifest,unitOfWork:input.unitOfWork}),decision=lifecycleDecision(input,freshness(input),'freshness_confirmed'),
    fence=input.unitOfWork.captureReadFence(),db=new Database(input.databasePath);
  try{
    db.prepare('UPDATE libra_subjects SET updated_at_ms=coalesce(updated_at_ms,0)+1').run();
    assert.throws(()=>store.transition({decision,commitMarker:'fenced-life',resultId:'fenced-life-result',readFence:fence}),{code:'P3_UOW_READ_FENCE_CHANGED'});
    assert.equal(db.prepare('SELECT state_revision FROM libra_runs').get().state_revision,1);
    assert.equal(db.prepare("SELECT count(*) n FROM fx_commit_markers WHERE commit_marker='fenced-life'").get().n,0);
  }finally{db.close();}
}));

test('an exact Run lifecycle transition replays after its Owner fence changes',()=>fixture(input=>{
  const store=createRunLifecycleStore({schemaManifest,unitOfWork:input.unitOfWork}),decision=lifecycleDecision(input,freshness(input),'freshness_confirmed'),
    request={decision,commitMarker:'fenced-life',resultId:'fenced-life-result',readFence:input.unitOfWork.captureReadFence()},
    first=store.transition(request),replay=store.transition(request);
  assert.equal(first.replayed,false);assert.equal(replay.replayed,true);assert.deepEqual(replay.result,first.result);
}));

test('a concurrent exact lifecycle commit is replayed after the fence race',()=>fixture(input=>{
  const original=createRunLifecycleStore({schemaManifest,unitOfWork:input.unitOfWork}),decision=lifecycleDecision(input,freshness(input),'freshness_confirmed'),
    request={decision,commitMarker:'fenced-life',resultId:'fenced-life-result',readFence:input.unitOfWork.captureReadFence()};
  let injected=false;
  const unitOfWork={...input.unitOfWork,execute(participants,settings){
    if(!injected&&participants.some(item=>item.participantId==='run_lifecycle_foundation')){
      injected=true;original.transition({...request,readFence:null});
    }
    return input.unitOfWork.execute(participants,settings);
  }};
  const replay=createRunLifecycleStore({schemaManifest,unitOfWork}).transition(request);
  assert.equal(replay.replayed,true);assert.equal(replay.result.committedStateRevision,2);
}));

test('actual Run Coordinator fences its lifecycle transition after an Owner change',()=>fixture(input=>{
  let injected=false;
  const unitOfWork={...input.unitOfWork,execute(participants,settings){
    if(!injected&&participants.some(item=>item.participantId==='run_lifecycle_foundation')){
      injected=true;const db=new Database(input.databasePath);
      try{db.prepare('UPDATE libra_subjects SET updated_at_ms=coalesce(updated_at_ms,0)+1').run();}finally{db.close();}
    }
    return input.unitOfWork.execute(participants,settings);
  }},options={schemaManifest,unitOfWork,now:()=>2000},
    lifecycle=require('../../src/helix/domains/libra/application/libra-run-lifecycle-service').createLibraRunLifecycleService(options),
    coordinator=require('../../src/helix/domains/libra/application/libra-run-coordinator').createLibraRunCoordinator({...options,
      runExecutionGuard:{check:()=>({kind:'ready',readFence:input.unitOfWork.captureReadFence()})},
      libraRunLifecycleService:lifecycle,workResultReader:{},workspaceProductPort:{},movieProductionReader:{
        readRunSnapshot:()=>({run:{libraRunId:input.libraRunId,state:'active',packageRevisionHead:0,
          executionBasisDigest:input.admitted.executionBasisDigest},spec:{contentProfile:'movie'}}),
        readFact(){throw new Error('fixture-after-unguarded-lifecycle');}}});
  let result;try{result=coordinator.reconcile(input.libraRunId);}catch(error){
    if(error.message!=='fixture-after-unguarded-lifecycle')throw error;
  }
  const db=new Database(input.databasePath,{readonly:true});
  try{
    assert.equal(result?.kind,'pending');assert.equal(result.reasonCode,'owner_view_changed');assert.equal(injected,true);
    assert.equal(db.prepare('SELECT state_revision FROM libra_runs').get().state_revision,1);
  }finally{db.close();}
}));

test('a suspended Run resumes through its fenced lifecycle without admitting Work',()=>fixture(input=>{
  const db=new Database(input.databasePath);try{
    db.prepare("UPDATE libra_decision_basis_revisions SET status='unresolved',unresolved_reason_code='required_input_missing' WHERE decision_basis_id='basis-1'").run();
    let at=2000;const options={schemaManifest,unitOfWork:input.unitOfWork,now:()=>at},
      service=require('../../src/helix/domains/libra/application/libra-run-lifecycle-service').createLibraRunLifecycleService(options);
    assert.equal(service.reconcile(input.libraRunId).kind,'suspend');
    db.prepare("UPDATE libra_decision_basis_revisions SET status='ready',unresolved_reason_code=NULL WHERE decision_basis_id='basis-1'").run();
    at=62000;
    const {guardedRunWrite}=require('../../src/helix/domains/libra/application/run-execution-write-guard'),scopes=[],
      result=guardedRunWrite({check(scope){scopes.push(scope);return {kind:'ready',readFence:input.unitOfWork.captureReadFence()};}},
        {libraRunId:input.libraRunId,executionBasisDigest:input.admitted.executionBasisDigest},
        readFence=>service.reconcile(input.libraRunId,{readFence}),{purpose:'lifecycle'});
    assert.equal(result.kind,'resume');assert.equal(scopes[0].purpose,'lifecycle');
    assert.equal(db.prepare('SELECT state FROM libra_runs').get().state,'active');
    assert.equal(db.prepare('SELECT count(*) n FROM fx_supporting_works').get().n,0);
  }finally{db.close();}
}));
test('freshness validates Control only for primary_control bindings and preserves related_derived obligations',()=>fixture((input)=>{const db=new Database(input.databasePath),primary=db.prepare("SELECT material_key FROM libra_material_bindings WHERE authority_kind='primary_control'").get().material_key,identity={mountScopeId:'mount-1',inode:'12',sizeBytes:50,fingerprintAlgorithm:'middle-256k-sha256',fingerprintVersion:1,contentFingerprint:D('related-content')},materialKey=canonicalDigest({schema:'physical-material-identity@2',...identity});db.prepare('INSERT INTO libra_material_bindings (subject_id,material_key,role,authority_kind,primary_material_key,association_evidence_digest,disposition_basis_digest,mount_scope_id,inode,fingerprint_algorithm,fingerprint_version,content_fingerprint,size_bytes,endpoint_id,location,binding_revision,health_state,evidence_digest,origin_intake_decision_id,origin_offer_id,origin_candidate_package_id,origin_package_revision,origin_package_digest,origin_candidate_delivery_snapshot_digest,origin_related_reference_set_digest,origin_related_disposition_scope_digest,current) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('subject-1',materialKey,'poster','related_derived',primary,D('association'),D('disposition'),identity.mountScopeId,identity.inode,identity.fingerprintAlgorithm,identity.fingerprintVersion,identity.contentFingerprint,identity.sizeBytes,'endpoint-1','/library/poster.jpg',1,'active',D('related-binding'),'intake-1','offer-1','candidate-1',1,D('package'),D('delivery'),D('related'),D('related-scope'),1);db.close();const assessed=createRunLifecycleStore({schemaManifest,unitOfWork:input.unitOfWork}).assess({libraRunId:input.libraRunId,assessedAtMs:2000});assert.equal(assessed.kind,'assessment');assert.equal(assessed.assessment.readiness,'ready');assert.equal(assessed.assessment.comparison,'same');assert.equal(assessed.assessment.currentBasis.members.length,1);}));
test('same semantic Acceptance Spec with new provenance keeps the original Run',()=>fixture((input)=>{const db=new Database(input.databasePath),old=db.prepare("SELECT * FROM libra_acceptance_specs WHERE acceptance_spec_id='spec-1'").get(),spec=JSON.parse(old.spec_json),recordDigest=D('record-2');Object.assign(spec,{acceptanceSpecId:'spec-2',specRevision:2,recordDigest,decisionBasisId:'basis-2'});db.prepare('INSERT INTO libra_decision_basis_revisions (decision_basis_id,subject_id,basis_kind,basis_revision,expected_head_revision,expected_head_snapshot_digest,routing_decision_id,query_result_set_digest,routing_input_digest,spec_input_digest,product_scope_digest,input_set_digest,status,basis_digest,committed_at_ms) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('basis-2','subject-1','acceptance_spec',2,4,D('head-4'),null,D('queries-2'),null,D('spec-input-2'),old.product_scope_digest,D('inputs-2'),'ready',D('basis-2'),2);db.prepare('INSERT INTO libra_acceptance_specs (acceptance_spec_id,subject_id,shelf_id,shelf_routing_projection_revision,shelf_projection_digest,shelf_standard_revision,shelf_standard_digest,decision_basis_id,product_scope_digest,spec_revision,spec_schema_ref,spec_json,spec_digest,record_digest,structure_kind,content_profile,published_at_ms) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('spec-2','subject-1',old.shelf_id,old.shelf_routing_projection_revision,old.shelf_projection_digest,old.shelf_standard_revision,old.shelf_standard_digest,'basis-2',old.product_scope_digest,2,old.spec_schema_ref,canonicalJson(spec),old.spec_digest,recordDigest,old.structure_kind,old.content_profile,2);const head={subjectId:'subject-1',headRevision:5,currentRoutingDecisionId:null,currentDecisionBasisId:'basis-2',currentAcceptanceSpecId:'spec-2'},headDigest=canonicalDigest({schema:'libra.subject-decision-head@1',...head});db.prepare('UPDATE libra_subject_decision_heads SET head_revision=?,head_digest=?,current_decision_basis_id=?,current_acceptance_spec_id=?,updated_at_ms=? WHERE subject_id=?').run(5,headDigest,'basis-2','spec-2',2,'subject-1');db.close();const assessed=createRunLifecycleStore({schemaManifest,unitOfWork:input.unitOfWork}).assess({libraRunId:input.libraRunId,assessedAtMs:2000});assert.equal(assessed.kind,'assessment');assert.equal(assessed.assessment.currentBasis.acceptanceSpecRef.acceptanceSpecId,'spec-2');assert.notEqual(assessed.assessment.originalBasis.acceptanceSpecRef.recordDigest,assessed.assessment.currentBasis.acceptanceSpecRef.recordDigest);assert.equal(assessed.assessment.originalBasis.acceptanceSpecRef.specDigest,assessed.assessment.currentBasis.acceptanceSpecRef.specDigest);assert.equal(assessed.assessment.comparison,'same');assert.equal(assessed.assessment.dimensionResults.find((item)=>item.dimension==='acceptance_spec').result,'same');assert.equal(assessed.assessment.dimensionResults.find((item)=>item.dimension==='output_requirement').result,'same');}));
test('owner-row mismatch rolls back Run, head, revision, Result, and marker together',()=>fixture((input)=>{const store=createRunLifecycleStore({schemaManifest,unitOfWork:input.unitOfWork}),evidence=freshness(input);evidence.currentBasis={...evidence.currentBasis,contentProfile:'jav'};evidence.assessmentDigest=canonicalDigest(Object.fromEntries(Object.entries(evidence).filter(([key])=>key!=='assessmentDigest')));const decision=lifecycleDecision(input,evidence,'freshness_confirmed');assert.throws(()=>store.transition({decision,commitMarker:'bad-marker',resultId:'bad-result'}),/Owner rows|Comparable Basis/);const db=new Database(input.databasePath,{readonly:true});assert.equal(db.prepare('SELECT state_revision FROM libra_runs').get().state_revision,1);assert.equal(db.prepare('SELECT head_revision FROM libra_run_admission_heads').get().head_revision,1);assert.equal(db.prepare('SELECT COUNT(*) n FROM fx_commit_markers').get().n,1);assert.equal(db.prepare("SELECT COUNT(*) n FROM fx_commit_markers WHERE commit_marker='bad-marker'").get().n,0);db.close();}));
test('unresolved current Decision Basis suspends and persists the immutable recovery snapshot',()=>fixture((input)=>{const db=new Database(input.databasePath);db.prepare("UPDATE libra_decision_basis_revisions SET status='unresolved',unresolved_reason_code='required_input_missing' WHERE decision_basis_id='basis-1'").run();db.close();const evidence=freshness(input,'unresolved'),decision=lifecycleDecision(input,evidence,'suspend'),result=createRunLifecycleStore({schemaManifest,unitOfWork:input.unitOfWork}).transition({decision,commitMarker:'suspend-marker',resultId:'suspend-result'}).result;assert.equal(result.committedState,'suspended');const check=new Database(input.databasePath,{readonly:true}),row=check.prepare('SELECT state,recovery_attempt_ordinal,recovery_next_due_at_ms,recovery_policy_digest FROM libra_runs').get();assert.equal(row.state,'suspended');assert.equal(row.recovery_attempt_ordinal,0);assert.equal(row.recovery_next_due_at_ms,62000);assert.equal(row.recovery_policy_digest,evidence.recoveryPolicy.policyDigest);check.close();}));
test('reprioritizes an active Run without consuming freshness-only Owner rows',()=>fixture((input)=>{const intent={libraRunId:input.libraRunId,actorId:'user-1',idempotencyKey:'priority-1',expectedPriorityClass:'normal',requestedPriorityClass:'expedited',intentKind:'accelerate',issuedAtMs:2000};intent.intentId=canonicalDigest({schema:'libra.run-priority-intent-id@1',libraRunId:intent.libraRunId,actorId:intent.actorId,idempotencyKey:intent.idempotencyKey});intent.intentDigest=canonicalDigest(intent);const decision=buildRunLifecycleDecision({libraRunId:input.libraRunId,expectedStateRevision:input.admitted.stateRevision,expectedStateDigest:input.admitted.stateDigest,transitionKind:'set_priority',newPriority:{priorityClass:'expedited',priorityIntentDigest:intent.intentDigest},transitionEvidence:intent,expectedAdmissionHeadRevision:input.admitted.committedAdmissionHeadRevision,expectedActiveScopeSetDigest:input.admitted.activeScopeSetDigest});const result=createRunLifecycleStore({schemaManifest,unitOfWork:input.unitOfWork}).transition({decision,commitMarker:'priority-marker',resultId:'priority-result'}).result;assert.equal(result.committedState,'active');const db=new Database(input.databasePath,{readonly:true}),row=db.prepare('SELECT priority_class,priority_intent_digest,state_revision FROM libra_runs').get();assert.equal(row.priority_class,'expedited');assert.equal(row.priority_intent_digest,intent.intentDigest);assert.equal(row.state_revision,2);db.close();}));
test('declares exactly the canonical lifecycle transaction read-table superset',()=>{const store=createRunLifecycleStore({schemaManifest,unitOfWork:{execute(){throw new Error('unused');}}}),actual=[...new Set([...store.repositoryManifest.libraTableIds,...store.repositoryManifest.foundationTableIds,...store.repositoryManifest.controlHistoryTableIds])].sort();assert.deepEqual(actual,[...lifecycleTransaction.readTables].sort());});
test('completes the Run with Delivery Receipt, Inbox, head removal, Result, and marker atomically',()=>fixture((input)=>{const packageDigest=D('on-deck-package'),onDeckPackageId='package-1',offerId=canonicalDigest({schema:'libra.product-offer-id@1',onDeckPackageId,packageDigest}),handoffReceipt={receiptId:'arca-receipt-1',custodyId:'custody-1',arcaBindingSetDigest:D('arca-bindings'),controlRevisionSetDigest:D('arca-controls'),receiptDigest:D('arca-receipt')},acceptanceDecisionId='arca-decision-1',messageId=canonicalDigest({schema:'arca.product-accepted-message-id@1',offerId,acceptanceDecisionId,receiptDigest:handoffReceipt.receiptDigest}),message={messageKind:'arca.product.accepted@1',messageId,offerId,onDeckPackageId,packageDigest,libraRunId:input.libraRunId,acceptanceDecisionId,acceptanceDecisionDigest:D('arca-decision'),handoffReceipt,dedupKey:messageId};const db=new Database(input.databasePath);db.prepare('INSERT INTO libra_product_packages (on_deck_package_id,offer_id,package_revision,libra_run_id,package_digest,state,published_at_ms) VALUES (?,?,?,?,?,?,?)').run(onDeckPackageId,offerId,1,input.libraRunId,packageDigest,'published',2);db.close();const decision=buildRunLifecycleDecision({libraRunId:input.libraRunId,expectedStateRevision:input.admitted.stateRevision,expectedStateDigest:input.admitted.stateDigest,transitionKind:'complete',transitionEvidence:message,expectedAdmissionHeadRevision:input.admitted.committedAdmissionHeadRevision,expectedActiveScopeSetDigest:input.admitted.activeScopeSetDigest}),crashing={execute(participants){return input.unitOfWork.execute(participants.map((participant)=>participant.participantId!=='run_lifecycle_foundation'?participant:{...participant,execute(context){participant.execute(context);throw new Error('fixture-crash-after-lifecycle-foundation');}}));}};assert.throws(()=>createRunLifecycleStore({schemaManifest,unitOfWork:crashing}).transition({decision,commitMarker:'complete-crash',resultId:'complete-crash-result'}),/fixture-crash/);const rolledBack=new Database(input.databasePath,{readonly:true});assert.equal(rolledBack.prepare('SELECT state_revision FROM libra_runs').get().state_revision,1);assert.equal(rolledBack.prepare('SELECT COUNT(*) n FROM libra_delivery_receipts').get().n,0);assert.equal(rolledBack.prepare('SELECT COUNT(*) n FROM fx_inbox').get().n,0);rolledBack.close();const store=createRunLifecycleStore({schemaManifest,unitOfWork:input.unitOfWork}),result=store.transition({decision,commitMarker:'complete-marker',resultId:'complete-result'}).result;assert.equal(result.committedState,'completed');assert.equal(result.deliveryReceiptId,canonicalDigest({schema:'libra.product-delivery-receipt-id@1',offerId}));const check=new Database(input.databasePath,{readonly:true}),run=check.prepare('SELECT state,state_revision,terminal_at_ms FROM libra_runs').get(),receipt=check.prepare('SELECT * FROM libra_delivery_receipts').get(),inbox=check.prepare('SELECT * FROM fx_inbox').get(),head=check.prepare('SELECT * FROM libra_run_admission_heads').get();assert.equal(run.state,'completed');assert.equal(run.state_revision,2);assert.equal(receipt.handoff_receipt_id,handoffReceipt.receiptId);assert.equal(receipt.closure_digest,null);assert.equal(inbox.message_id,messageId);assert.equal(inbox.result_digest,result.resultDigest);assert.equal(head.active_scope_set_digest,activeRunScopeSetDigest('subject-1',[]));assert.equal(check.prepare('SELECT COUNT(*) n FROM fx_outbox').get().n,0);check.close();}));
test('freezes only from terminal Work, Plan, Event, Attempt, and immutable Retry Policy evidence',()=>fixture((input)=>{const capabilityRef='helix://capabilities/libra/test/v1',workBasisDigest=D('terminal-work-basis'),retryPolicyDigest=D('retry-policy'),terminalEvidenceDigest=D('attempt-evidence'),member={workId:'work-1',planId:'plan-1',workBasisDigest,terminalEventId:'event-1',capabilityRef,failureClass:'permanent',failureCode:'exhausted',attemptCount:1,retryPolicyDigest,terminalEvidenceDigest};member.memberDigest=canonicalDigest({schema:'libra.run-terminal-blocker-member@1',...member});const evidence={libraRunId:input.libraRunId,executionBasisDigest:input.admitted.executionBasisDigest,blockerKind:'capability_exhausted',blockedWorks:[member],assessedAtMs:2000};evidence.blockerSetDigest=canonicalDigest({schema:'libra.run-terminal-blocker-set@1',libraRunId:evidence.libraRunId,executionBasisDigest:evidence.executionBasisDigest,blockerKind:evidence.blockerKind,items:evidence.blockedWorks});evidence.evidenceId=canonicalDigest({schema:'libra.run-terminal-delivery-evidence-id@1',libraRunId:evidence.libraRunId,executionBasisDigest:evidence.executionBasisDigest,blockerKind:evidence.blockerKind,blockerSetDigest:evidence.blockerSetDigest,assessedAtMs:evidence.assessedAtMs});evidence.evidenceDigest=canonicalDigest(evidence);const db=new Database(input.databasePath);db.prepare('INSERT INTO fx_supporting_works (work_id,owner_domain,process_type,process_id,work_kind,basis_digest,priority_class,state,idempotency_key,created_at_ms,updated_at_ms) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(member.workId,'libra','libra_run',input.libraRunId,'production',workBasisDigest,'normal','failed','work-key',1,2);db.prepare('INSERT INTO fx_workflow_plans (plan_id,attempt_id,planner_ref,planner_version,catalog_digest,basis_digest,graph_digest,state,created_at_ms) VALUES (?,?,?,?,?,?,?,?,?)').run(member.planId,null,'planner',1,D('catalog'),workBasisDigest,D('graph'),'planned',1);db.prepare('INSERT INTO fx_workflow_events (event_id,plan_id,node_id,work_id,attempt_id,owner_domain,capability_ref,contract_version,state,priority_class) VALUES (?,?,?,?,?,?,?,?,?,?)').run(member.terminalEventId,member.planId,'node-1',member.workId,null,'libra',capabilityRef,1,'failed','normal');db.prepare('INSERT INTO fx_event_attempts (event_attempt_id,event_id,ordinal,state,outcome_kind,failure_class,failure_code,evidence_digest,started_at_ms,finished_at_ms) VALUES (?,?,?,?,?,?,?,?,?,?)').run('event-attempt-1',member.terminalEventId,1,'completed','failed',member.failureClass,member.failureCode,terminalEvidenceDigest,1,2);db.close();const decision=lifecycleDecision(input,evidence,'freeze'),result=createRunLifecycleStore({schemaManifest,unitOfWork:input.unitOfWork,resolveRetryPolicyDigest:(ref)=>ref===capabilityRef?retryPolicyDigest:null}).transition({decision,commitMarker:'terminal-marker',resultId:'terminal-result'}).result;assert.equal(result.committedState,'frozen');const check=new Database(input.databasePath,{readonly:true});assert.equal(check.prepare('SELECT state FROM libra_runs').get().state,'frozen');assert.equal(check.prepare('SELECT transition_evidence_digest FROM libra_run_revisions ORDER BY state_revision DESC LIMIT 1').get().transition_evidence_digest,evidence.evidenceDigest);check.close();}));
for(const mutate of [false,true])test('terminal rejected-Plan freeze conserves exact evidence and rejects graph drift: '+mutate,()=>fixture(input=>{
  const workId='rejected-work',workBasisDigest=D('rejected-work-basis'),db=new Database(input.databasePath);
  db.prepare('INSERT INTO fx_supporting_works(work_id,owner_domain,process_type,process_id,work_kind,basis_digest,priority_class,state,idempotency_key,created_at_ms,updated_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(workId,'libra','libra_run',input.libraRunId,'workspace_media_production',workBasisDigest,'normal','failed','rejected-key',1,2);
  db.prepare('INSERT INTO fx_work_attempts(attempt_id,work_id,ordinal,basis_digest,state,started_at_ms,finished_at_ms,failure_code) VALUES(?,?,?,?,?,?,?,?)')
    .run('rejected-attempt',workId,1,workBasisDigest,'failed',1,2,'jav_part_copy_incompatible');
  db.prepare('INSERT INTO fx_workflow_plans(plan_id,attempt_id,planner_ref,planner_version,catalog_digest,basis_digest,graph_digest,state,created_at_ms) VALUES(?,?,?,?,?,?,?,?,?)')
    .run('rejected-plan','rejected-attempt','helix://libra/planners/workspace-media/v1',1,D('catalog'),workBasisDigest,D('graph'),'contract_unplannable',2);
  const store=createRunLifecycleStore({schemaManifest,unitOfWork:input.unitOfWork,resolveRetryPolicyDigest:()=>{throw Error('A rejected Plan has no Capability Retry Policy.');}});
  const built=store.buildTerminalEvidence({libraRunId:input.libraRunId,workId,blockerKind:'product_unachievable',assessedAtMs:3});
  assert.equal(built.evidence.blockedWorks[0].blockerSource,'plan_rejection');
  assert.equal(built.evidence.blockedWorks[0].terminalEventId,undefined);
  if(mutate)db.prepare('UPDATE fx_workflow_plans SET graph_digest=? WHERE plan_id=?').run(D('changed'),'rejected-plan');
  const request={decision:lifecycleDecision(input,built.evidence,'freeze'),commitMarker:'rejected-marker',resultId:'rejected-result'};
  if(mutate) {
    assert.throws(()=>store.transition(request),{code:'P9_RUN_LIFECYCLE_TERMINAL'});
    assert.equal(db.prepare('SELECT state FROM libra_runs').get().state,'active');
  } else {
    assert.equal(store.transition(request).result.committedState,'frozen');
    assert.equal(store.transition(request).replayed,true);
  }
  assert.equal(db.prepare('SELECT count(*) n FROM fx_workflow_events WHERE work_id=?').get(workId).n,0);db.close();
}));

test('freezes from a terminal succeeded Work only when its durable typed Result proves business unachievable',()=>fixture((input)=>{
  const capabilityRef='libra.external_material.candidate.select@1',workId='external-search-work',planId='external-search-plan',
    eventId='external-selection-event',workBasisDigest=D('external-search-basis'),retryPolicyDigest=D('external-search-retry'),
    selectedResult={result:'not_selected',selectionReasonCode:'no_available_candidate'},resultDigest=canonicalDigest(selectedResult),db=new Database(input.databasePath);
  db.prepare('INSERT INTO fx_supporting_works (work_id,owner_domain,process_type,process_id,work_kind,basis_digest,priority_class,state,idempotency_key,created_at_ms,updated_at_ms) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(workId,'libra','libra_run',input.libraRunId,'external_search_selection',workBasisDigest,'normal','succeeded','external-search-key',1,2);
  db.prepare('INSERT INTO fx_workflow_plans (plan_id,attempt_id,planner_ref,planner_version,catalog_digest,basis_digest,graph_digest,state,created_at_ms) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(planId,null,'planner',1,D('catalog'),workBasisDigest,D('graph'),'planned',1);
  db.prepare('INSERT INTO fx_workflow_events (event_id,plan_id,node_id,work_id,attempt_id,owner_domain,capability_ref,contract_version,state,priority_class,result_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(eventId,planId,'node-1',workId,null,'libra',capabilityRef,1,'succeeded','normal','external-selection-result');
  db.prepare('INSERT INTO fx_event_attempts (event_attempt_id,event_id,ordinal,state,outcome_kind,started_at_ms,finished_at_ms) VALUES (?,?,?,?,?,?,?)')
    .run('external-selection-attempt',eventId,1,'completed','succeeded',1,2);
  db.prepare('INSERT INTO fx_event_result_bindings (result_id,event_id,outcome_kind,result_schema_ref,result_json,result_digest,committed_at_ms) VALUES (?,?,?,?,?,?,?)')
    .run('external-selection-result',eventId,'succeeded','helix://contracts/types/SelectedAcquisitionCandidate/v1',canonicalJson(selectedResult),resultDigest,2);
  db.close();
  const store=createRunLifecycleStore({schemaManifest,unitOfWork:input.unitOfWork,
    resolveRetryPolicyDigest:(ref)=>ref===capabilityRef?retryPolicyDigest:null}),built=store.buildTerminalEvidence({
      libraRunId:input.libraRunId,workId,blockerKind:'product_unachievable',assessedAtMs:2000,
      terminalResult:{eventId,failureClass:'business_unachievable',failureCode:'no_available_candidate',resultDigest}});
  assert.equal(built.kind,'terminal_evidence');
  assert.equal(built.evidence.blockedWorks[0].failureClass,'business_unachievable');
  assert.equal(built.evidence.blockedWorks[0].terminalEvidenceDigest,resultDigest);
  const result=store.transition({decision:lifecycleDecision(input,built.evidence,'freeze'),
    commitMarker:'business-terminal-marker',resultId:'business-terminal-result'}).result;
  assert.equal(result.committedState,'frozen');
}));

test('freezes a measured size-only Product through the exact size-cap admission mapping',()=>fixture((input)=>{
  const {store,built}=sizeCapTerminal(input,['max_size_exceeded']);
  const result=store.transition({decision:lifecycleDecision(input,built.evidence,'freeze'),
    commitMarker:'size-cap-marker',resultId:'size-cap-transition-result'}).result;
  assert.equal(result.committedState,'frozen');
  assert.equal(built.evidence.blockedWorks[0].failureCode,'size_cap_requires_admission');
}));

test('rejects size-cap admission when measured Product has any additional media Gap',()=>fixture((input)=>{
  const {store,built}=sizeCapTerminal(input,['max_size_exceeded','video_codec_unmet']);
  assert.throws(()=>store.transition({decision:lifecycleDecision(input,built.evidence,'freeze'),
    commitMarker:'size-cap-wide-marker',resultId:'size-cap-wide-result'}),
  (error)=>error.code==='P9_RUN_LIFECYCLE_TERMINAL');
}));

test('freezes a zero-cast Run from the succeeded Metadata Provider Result without converting it to executor failure',()=>fixture((input)=>{
  const capabilityRef='libra.product_metadata.fetch@1',workId='metadata-provider-work',planId='metadata-provider-plan',
    eventId='metadata-provider-event',workBasisDigest=D('metadata-provider-basis'),retryPolicyDigest=D('metadata-provider-retry'),
    selectedResult={sourceKind:'provider',peopleHints:[],descriptiveFacts:{entries:[]}},resultDigest=canonicalDigest(selectedResult),db=new Database(input.databasePath);
  db.prepare('INSERT INTO fx_supporting_works (work_id,owner_domain,process_type,process_id,work_kind,basis_digest,priority_class,state,idempotency_key,created_at_ms,updated_at_ms) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(workId,'libra','libra_run',input.libraRunId,'product_metadata_observation',workBasisDigest,'normal','succeeded','metadata-provider-key',1,2);
  db.prepare('INSERT INTO fx_workflow_plans (plan_id,attempt_id,planner_ref,planner_version,catalog_digest,basis_digest,graph_digest,state,created_at_ms) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(planId,null,'planner',1,D('catalog'),workBasisDigest,D('graph'),'planned',1);
  db.prepare('INSERT INTO fx_workflow_events (event_id,plan_id,node_id,work_id,attempt_id,owner_domain,capability_ref,contract_version,state,priority_class,result_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(eventId,planId,'node-1',workId,null,'libra',capabilityRef,1,'succeeded','normal','external-selection-result');
  db.prepare('INSERT INTO fx_event_attempts (event_attempt_id,event_id,ordinal,state,outcome_kind,started_at_ms,finished_at_ms) VALUES (?,?,?,?,?,?,?)')
    .run('external-selection-attempt',eventId,1,'completed','succeeded',1,2);
  db.prepare('INSERT INTO fx_event_result_bindings (result_id,event_id,outcome_kind,result_schema_ref,result_json,result_digest,committed_at_ms) VALUES (?,?,?,?,?,?,?)')
    .run('external-selection-result',eventId,'succeeded','helix://contracts/capabilities/libra.product_metadata.fetch/v1/result',canonicalJson(selectedResult),resultDigest,2);
  db.close();
  const store=createRunLifecycleStore({schemaManifest,unitOfWork:input.unitOfWork,
    resolveRetryPolicyDigest:(ref)=>ref===capabilityRef?retryPolicyDigest:null}),built=store.buildTerminalEvidence({
      libraRunId:input.libraRunId,workId,blockerKind:'product_unachievable',assessedAtMs:2000,
    terminalResult:{eventId,failureClass:'business_unachievable',failureCode:'product_metadata_required_cast_missing',resultDigest}});
  assert.equal(built.kind,'terminal_evidence');
  assert.equal(built.evidence.blockedWorks[0].failureClass,'business_unachievable');
  assert.equal(built.evidence.blockedWorks[0].failureCode,'product_metadata_required_cast_missing');
  assert.equal(built.evidence.blockedWorks[0].terminalEvidenceDigest,resultDigest);
  const result=store.transition({decision:lifecycleDecision(input,built.evidence,'freeze'),
    commitMarker:'business-terminal-marker',resultId:'business-terminal-result'}).result;
  assert.equal(result.committedState,'frozen');
  const check=new Database(input.databasePath,{readonly:true});
  assert.equal(check.prepare('SELECT state FROM fx_supporting_works WHERE work_id=?').get(workId).state,'succeeded');
  assert.equal(check.prepare('SELECT state FROM libra_runs WHERE libra_run_id=?').get(input.libraRunId).state,'frozen');
  const evidence=JSON.parse(check.prepare('SELECT transition_evidence_json FROM libra_run_revisions WHERE libra_run_id=? ORDER BY state_revision DESC LIMIT 1').get(input.libraRunId).transition_evidence_json);
  assert.equal(evidence.blockedWorks[0].failureCode,'product_metadata_required_cast_missing');
  check.close();
}));

test('secondary target persists once, stays active, and replays without replacing the Run',()=>fixture((input)=>{
  const capabilityRef='libra.product_metadata.fetch@1',workId='metadata-provider-work',planId='metadata-provider-plan',
    eventId='metadata-provider-event',workBasisDigest=D('metadata-provider-basis'),retryPolicyDigest=D('metadata-provider-retry'),
    selectedResult={sourceKind:'provider',peopleHints:[],descriptiveFacts:{entries:[]}},resultDigest=canonicalDigest(selectedResult),db=new Database(input.databasePath);
  db.prepare('INSERT INTO fx_supporting_works (work_id,owner_domain,process_type,process_id,work_kind,basis_digest,priority_class,state,idempotency_key,created_at_ms,updated_at_ms) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(workId,'libra','libra_run',input.libraRunId,'product_metadata_observation',workBasisDigest,'normal','succeeded','metadata-provider-key',1,2);
  db.prepare('INSERT INTO fx_workflow_plans (plan_id,attempt_id,planner_ref,planner_version,catalog_digest,basis_digest,graph_digest,state,created_at_ms) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(planId,null,'planner',1,D('catalog'),workBasisDigest,D('graph'),'planned',1);
  db.prepare('INSERT INTO fx_workflow_events (event_id,plan_id,node_id,work_id,attempt_id,owner_domain,capability_ref,contract_version,state,priority_class,result_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(eventId,planId,'node-1',workId,null,'libra',capabilityRef,1,'succeeded','normal','external-selection-result');
  db.prepare('INSERT INTO fx_event_attempts (event_attempt_id,event_id,ordinal,state,outcome_kind,started_at_ms,finished_at_ms) VALUES (?,?,?,?,?,?,?)')
    .run('external-selection-attempt',eventId,1,'completed','succeeded',1,2);
  db.prepare('INSERT INTO fx_event_result_bindings (result_id,event_id,outcome_kind,result_schema_ref,result_json,result_digest,committed_at_ms) VALUES (?,?,?,?,?,?,?)')
    .run('external-selection-result',eventId,'succeeded','helix://contracts/capabilities/libra.product_metadata.fetch/v1/result',canonicalJson(selectedResult),resultDigest,2);
  db.close();
  const store=createRunLifecycleStore({schemaManifest,unitOfWork:input.unitOfWork,
    resolveRetryPolicyDigest:(ref)=>ref===capabilityRef?retryPolicyDigest:null}),built=store.buildTerminalEvidence({
      libraRunId:input.libraRunId,workId,blockerKind:'product_unachievable',assessedAtMs:2000,
    terminalResult:{eventId,failureClass:'business_unachievable',failureCode:'product_metadata_required_cast_missing',resultDigest}});
  assert.equal(built.kind,'terminal_evidence');
  assert.equal(built.evidence.blockedWorks[0].failureClass,'business_unachievable');
  assert.equal(built.evidence.blockedWorks[0].failureCode,'product_metadata_required_cast_missing');
  assert.equal(built.evidence.blockedWorks[0].terminalEvidenceDigest,resultDigest);
  const result=store.transition({decision:lifecycleDecision(input,built.evidence,'secondary_target'),
    commitMarker:'business-terminal-marker',resultId:'business-terminal-result'}).result;
  assert.equal(result.committedState,'active');
  const replay=store.transition({decision:lifecycleDecision(input,built.evidence,'secondary_target'),commitMarker:'business-terminal-marker',resultId:'business-terminal-result'});
  assert.equal(replay.replayed,true);
  const check=new Database(input.databasePath,{readonly:true});
  assert.equal(check.prepare('SELECT state FROM fx_supporting_works WHERE work_id=?').get(workId).state,'succeeded');
  assert.equal(check.prepare('SELECT state FROM libra_runs WHERE libra_run_id=?').get(input.libraRunId).state,'active');
  const evidence=JSON.parse(check.prepare('SELECT transition_evidence_json FROM libra_run_revisions WHERE libra_run_id=? ORDER BY state_revision DESC LIMIT 1').get(input.libraRunId).transition_evidence_json);
  assert.equal(evidence.blockedWorks[0].failureCode,'product_metadata_required_cast_missing');
  check.close();
}));

test('published Package custody drift rejects a non-complete transition with zero writes',()=>fixture((input)=>{const onDeckPackageId='package-custody',packageDigest=D('custody-package'),offerId=canonicalDigest({schema:'libra.product-offer-id@1',onDeckPackageId,packageDigest}),db=new Database(input.databasePath);db.prepare('INSERT INTO libra_product_packages (on_deck_package_id,offer_id,package_revision,libra_run_id,package_digest,state,published_at_ms) VALUES (?,?,?,?,?,?,?)').run(onDeckPackageId,offerId,1,input.libraRunId,packageDigest,'published',2);db.prepare('INSERT INTO libra_product_package_materials (on_deck_package_id,ordinal,material_key,committed_control_revision,committed_control_projection_digest,member_digest) SELECT ?,0,material_key,2,?,? FROM libra_run_material_members LIMIT 1').run(onDeckPackageId,D('committed-control'),D('package-member'));db.prepare("UPDATE fx_material_controls SET owner_domain='arca',owner_scope_type='on_deck',owner_scope_id='other-custody'").run();db.close();const intent={libraRunId:input.libraRunId,actorId:'user-1',idempotencyKey:'custody-priority',expectedPriorityClass:'normal',requestedPriorityClass:'expedited',intentKind:'accelerate',issuedAtMs:2000};intent.intentId=canonicalDigest({schema:'libra.run-priority-intent-id@1',libraRunId:intent.libraRunId,actorId:intent.actorId,idempotencyKey:intent.idempotencyKey});intent.intentDigest=canonicalDigest(intent);const decision=buildRunLifecycleDecision({libraRunId:input.libraRunId,expectedStateRevision:input.admitted.stateRevision,expectedStateDigest:input.admitted.stateDigest,transitionKind:'set_priority',newPriority:{priorityClass:'expedited',priorityIntentDigest:intent.intentDigest},transitionEvidence:intent,expectedAdmissionHeadRevision:input.admitted.committedAdmissionHeadRevision,expectedActiveScopeSetDigest:input.admitted.activeScopeSetDigest});assert.throws(()=>createRunLifecycleStore({schemaManifest,unitOfWork:input.unitOfWork}).transition({decision,commitMarker:'custody-marker',resultId:'custody-result'}),/no longer owned by Libra/);const check=new Database(input.databasePath,{readonly:true});assert.equal(check.prepare('SELECT state_revision FROM libra_runs').get().state_revision,1);assert.equal(check.prepare('SELECT head_revision FROM libra_run_admission_heads').get().head_revision,1);assert.equal(check.prepare("SELECT COUNT(*) n FROM fx_commit_markers WHERE commit_marker='custody-marker'").get().n,0);check.close();}));

test('freshness waits for the durable delivery message when promoted Package material has Arca custody without completing the Run',()=>fixture(input=>{
  const db=new Database(input.databasePath),onDeckPackageId='promoted-package',packageDigest=D('promoted-package'),
    offerId=canonicalDigest({schema:'libra.product-offer-id@1',onDeckPackageId,packageDigest}),materialKey=D('promoted-product');
  try{
    db.prepare('INSERT INTO libra_product_packages (on_deck_package_id,offer_id,package_revision,libra_run_id,package_digest,state,published_at_ms) VALUES (?,?,?,?,?,?,?)').run(onDeckPackageId,offerId,1,input.libraRunId,packageDigest,'published',2);
    db.prepare('INSERT INTO libra_product_package_materials (on_deck_package_id,ordinal,material_key,committed_control_revision,committed_control_projection_digest,member_digest) VALUES(?,0,?,2,?,?)')
      .run(onDeckPackageId,materialKey,D('product-control'),D('product-member'));
    db.prepare('INSERT INTO fx_material_controls SELECT ?,mount_scope_id,?,size_bytes,fingerprint_algorithm,fingerprint_version,content_fingerprint,owner_domain,owner_scope_type,owner_scope_id,control_revision,state,updated_at_ms FROM fx_material_controls LIMIT 1')
      .run(materialKey,'promoted-inode');
    const store=createRunLifecycleStore({schemaManifest,unitOfWork:input.unitOfWork});
    assert.equal(store.assess({libraRunId:input.libraRunId,assessedAtMs:2000}).assessment.comparison,'same');
    db.prepare("UPDATE fx_material_controls SET owner_domain='arca',owner_scope_type='on_deck',owner_scope_id='pending-custody' WHERE material_key=?").run(materialKey);
    const snapshot=()=>JSON.stringify(['libra_runs','libra_run_admission_heads','fx_commit_markers','fx_event_result_bindings'].map(table=>db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all())),before=snapshot();
    assert.deepEqual(store.assess({libraRunId:input.libraRunId,assessedAtMs:2000}),{kind:'handoff_resolution_pending',libraRunId:input.libraRunId});
    assert.equal(snapshot(),before);assert.equal(db.prepare('SELECT state FROM libra_runs').get().state,'active');
  }finally{db.close();}
}));

test('user can end an active Run after Work and Effect closure, with a durable replay and outcome',()=>fixture((input)=>{
  let draining=true;
  const admin=require('../../src/helix/domains/libra/application/libra-run-admin-service').createLibraRunAdminService({
    schemaManifest,unitOfWork:input.unitOfWork,libraRunExecutionProjection:{invalidate(){}},
    cancelProcessWorks:()=>({drainingWorks:draining?1:0}),
  });
  const command={expectedRunStateRevision:input.admitted.stateRevision,
    expectedRunStateDigest:input.admitted.stateDigest,idempotencyKey:'user-discard-active'};
  const pending=admin.discard(input.libraRunId,command);
  assert.equal(pending.resultKind,'closure_pending');
  const before=new Database(input.databasePath,{readonly:true});
  assert.equal(before.prepare('SELECT state FROM libra_runs').get().state,'active');
  assert.equal(before.prepare('SELECT state FROM fx_material_controls').get().state,'controlled');
  assert.equal(before.prepare('SELECT COUNT(*) n FROM libra_run_outcomes').get().n,0);
  before.close();
  draining=false;
  const resumed=require('../../src/helix/domains/libra/application/libra-run-admin-service').createLibraRunAdminService({
    schemaManifest,unitOfWork:input.unitOfWork,libraRunExecutionProjection:{invalidate(){}},
    cancelProcessWorks:()=>({drainingWorks:0}),
  });
  const pendingPage=resumed.listPendingCancellations({cursor:null,limit:10});
  assert.equal(pendingPage.length,1);
  const result=resumed.reconcileCancellation(pendingPage[0].scope.subjectId);
  assert.equal(result.resultKind,'discarded');
  assert.deepEqual(admin.discard(input.libraRunId,command),result);
  const after=new Database(input.databasePath,{readonly:true});
  assert.equal(after.prepare('SELECT state FROM libra_runs').get().state,'discarded');
  assert.equal(after.prepare('SELECT state FROM fx_material_controls').get().state,'released');
  assert.equal(after.prepare('SELECT COUNT(*) n FROM libra_run_discard_receipts').get().n,1);
  assert.equal(after.prepare('SELECT COUNT(*) n FROM libra_run_outcomes').get().n,1);
  assert.equal(after.prepare('SELECT state FROM libra_task_cancellations').get().state,'completed');
  assert.equal(after.prepare('SELECT status FROM libra_subjects').get().status,'abandoned');
  assert.equal(admin.readOutcome(input.libraRunId).reasonCode,'user_cancelled');
  after.close();
}));

test('active Run discard stays pending while a Work is unfinished',()=>fixture((input)=>{
  const db=new Database(input.databasePath);
  db.prepare('INSERT INTO fx_supporting_works (work_id,owner_domain,process_type,process_id,work_kind,basis_digest,priority_class,state,idempotency_key,created_at_ms,updated_at_ms) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run('open-work','libra','libra_run',input.libraRunId,'product_identity',D('open-work-basis'),'normal','admitted','open-work-key',1,2);
  const admin=require('../../src/helix/domains/libra/application/libra-run-admin-service').createLibraRunAdminService({
    schemaManifest,unitOfWork:input.unitOfWork,libraRunExecutionProjection:{invalidate(){}}});
  const command={expectedRunStateRevision:input.admitted.stateRevision,
    expectedRunStateDigest:input.admitted.stateDigest,idempotencyKey:'pending-active-discard'};
  assert.equal(admin.discard(input.libraRunId,command).resultKind,'closure_pending');
  assert.equal(db.prepare('SELECT state FROM libra_runs').get().state,'active');
  assert.equal(db.prepare('SELECT state FROM fx_material_controls').get().state,'controlled');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM libra_run_discard_decisions').get().n,0);
  db.prepare("UPDATE fx_supporting_works SET state='cancelled' WHERE work_id='open-work'").run();
  assert.equal(admin.discard(input.libraRunId,command).resultKind,'discarded');
  db.close();
}));

test('Arca acceptance wins cancellation even before Libra consumes the delivery receipt',()=>fixture(input=>{
  const db=new Database(input.databasePath),offerId='accepted-before-receipt';
  try{
    db.prepare('INSERT INTO libra_product_packages (on_deck_package_id,offer_id,package_revision,libra_run_id,package_digest,state,published_at_ms) VALUES (?,?,1,?,?,?,2)')
      .run('accepted-package',offerId,input.libraRunId,D('accepted-package'),'published');
    const options={schemaManifest,unitOfWork:input.unitOfWork,libraRunExecutionProjection:{invalidate(){}},
      readArcaFormationStatus:()=>new Map([[offerId,{stage:'in_progress',onDeckRunId:'arca-run'}]])};
    const createAdmin=require('../../src/helix/domains/libra/application/libra-run-admin-service').createLibraRunAdminService;
    const body={expectedRunStateRevision:input.admitted.stateRevision,expectedRunStateDigest:input.admitted.stateDigest,idempotencyKey:'cancel-accepted'};
    assert.equal(createAdmin(options).discard(input.libraRunId,body).reasonCode,'handoff_b_already_accepted');
    assert.equal(db.prepare('SELECT count(*) n FROM libra_task_cancellations').get().n,0);
    const cancellations=require('../../src/helix/domains/libra/persistence/task-cancellation-store').createTaskCancellationStore(options);
    cancellations.request('subject-1',input.libraRunId,body);
    assert.equal(createAdmin(options).reconcileCancellation('subject-1').reasonCode,'handoff_b_already_accepted');
    assert.equal(cancellations.get('subject-1').state,'handoff_accepted');
    assert.equal(db.prepare('SELECT count(*) n FROM libra_run_discard_decisions').get().n,0);
    assert.equal(db.prepare('SELECT state FROM fx_material_controls').get().state,'controlled');
  }finally{db.close();}
}));

test('discard is an atomic exit that releases original input Control without deleting files',()=>fixture((input)=>{
  const store=createRunDiscardStore({schemaManifest,unitOfWork:input.unitOfWork});
  const activeCommand=buildRunDiscardCommand({libraRunId:input.libraRunId,expectedRunStateRevision:input.admitted.stateRevision,
    expectedRunStateDigest:input.admitted.stateDigest,actorId:'system',idempotencyKey:'discard-active-system'});
  const activeResult=store.inspect(activeCommand);assert.equal(activeResult.resultKind,'invalid_state',JSON.stringify(activeResult));
  const capabilityRef='helix://capabilities/libra/test/v1',workBasisDigest=D('discard-work-basis'),
    retryPolicyDigest=D('discard-retry-policy'),terminalEvidenceDigest=D('discard-attempt-evidence'),
    member={workId:'discard-work',planId:'discard-plan',workBasisDigest,terminalEventId:'discard-event',capabilityRef,
      failureClass:'permanent',failureCode:'exhausted',attemptCount:1,retryPolicyDigest,terminalEvidenceDigest};
  member.memberDigest=canonicalDigest({schema:'libra.run-terminal-blocker-member@1',...member});
  const evidence={libraRunId:input.libraRunId,executionBasisDigest:input.admitted.executionBasisDigest,
    blockerKind:'capability_exhausted',blockedWorks:[member],assessedAtMs:2000};
  evidence.blockerSetDigest=canonicalDigest({schema:'libra.run-terminal-blocker-set@1',libraRunId:evidence.libraRunId,
    executionBasisDigest:evidence.executionBasisDigest,blockerKind:evidence.blockerKind,items:evidence.blockedWorks});
  evidence.evidenceId=canonicalDigest({schema:'libra.run-terminal-delivery-evidence-id@1',libraRunId:evidence.libraRunId,
    executionBasisDigest:evidence.executionBasisDigest,blockerKind:evidence.blockerKind,
    blockerSetDigest:evidence.blockerSetDigest,assessedAtMs:evidence.assessedAtMs});evidence.evidenceDigest=canonicalDigest(evidence);
  const db=new Database(input.databasePath);
  db.prepare('INSERT INTO fx_supporting_works (work_id,owner_domain,process_type,process_id,work_kind,basis_digest,priority_class,state,idempotency_key,created_at_ms,updated_at_ms) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(member.workId,'libra','libra_run',input.libraRunId,'production',workBasisDigest,'normal','failed','discard-work-key',1,2);
  db.prepare('INSERT INTO fx_workflow_plans (plan_id,attempt_id,planner_ref,planner_version,catalog_digest,basis_digest,graph_digest,state,created_at_ms) VALUES (?,?,?,?,?,?,?,?,?)').run(member.planId,null,'planner',1,D('catalog'),workBasisDigest,D('graph'),'planned',1);
  db.prepare('INSERT INTO fx_workflow_events (event_id,plan_id,node_id,work_id,attempt_id,owner_domain,capability_ref,contract_version,state,priority_class) VALUES (?,?,?,?,?,?,?,?,?,?)').run(member.terminalEventId,member.planId,'node-1',member.workId,null,'libra',capabilityRef,1,'failed','normal');
  db.prepare('INSERT INTO fx_event_attempts (event_attempt_id,event_id,ordinal,state,outcome_kind,failure_class,failure_code,evidence_digest,started_at_ms,finished_at_ms) VALUES (?,?,?,?,?,?,?,?,?,?)').run('discard-attempt',member.terminalEventId,1,'completed','failed',member.failureClass,member.failureCode,terminalEvidenceDigest,1,2);db.close();
  const frozen=createRunLifecycleStore({schemaManifest,unitOfWork:input.unitOfWork,
    resolveRetryPolicyDigest:(ref)=>ref===capabilityRef?retryPolicyDigest:null}).transition({
      decision:lifecycleDecision(input,evidence,'freeze'),commitMarker:'discard-freeze-marker',resultId:'discard-freeze-result'}).result;
  const command=buildRunDiscardCommand({libraRunId:input.libraRunId,expectedRunStateRevision:frozen.committedStateRevision,
    expectedRunStateDigest:frozen.committedStateDigest,actorId:'admin',idempotencyKey:'discard-frozen'});
  const inspected=store.inspect(command);assert.equal(inspected.kind,'ready');
  const crashingUnitOfWork={execute(participants){return input.unitOfWork.execute(participants.map((participant)=>
    participant.participantId!=='libra_run_discard_foundation'?participant:{...participant,execute(context){
      participant.execute(context);throw new Error('fixture-crash-after-discard-foundation');}}));}};
  const crashStore=createRunDiscardStore({schemaManifest,unitOfWork:crashingUnitOfWork});
  assert.throws(()=>crashStore.commit(inspected),/fixture-crash-after-discard-foundation/);
  const rolledBack=new Database(input.databasePath,{readonly:true});
  assert.equal(rolledBack.prepare('SELECT state FROM libra_runs').get().state,'frozen');
  assert.equal(rolledBack.prepare('SELECT state FROM fx_material_controls').get().state,'controlled');
  assert.equal(rolledBack.prepare('SELECT COUNT(*) n FROM libra_run_outcomes').get().n,0);
  assert.equal(rolledBack.prepare('SELECT COUNT(*) n FROM libra_run_discard_decisions').get().n,0);rolledBack.close();
  const result=store.commit(inspected);assert.equal(result.resultKind,'discarded');assert.equal(result.cleanupMemberCount,0);
  assert.equal(result.discardReceipt.cleanupScopeId,null);
  const replay=store.inspect(command);assert.deepEqual(replay,result);
  const check=new Database(input.databasePath,{readonly:true});
  assert.equal(check.prepare('SELECT state FROM libra_runs').get().state,'discarded');
  assert.equal(check.prepare('SELECT state FROM fx_material_controls').get().state,'released');
  const outcomes=require('../../src/helix/domains/libra/persistence/run-outcome-store').createRunOutcomeStore({schemaManifest,unitOfWork:input.unitOfWork});
  const outcome=outcomes.get(input.libraRunId);
  assert.equal(outcome.outcome,'unable_to_on_deck');assert.equal(outcome.reasonCode,'user_cancelled');
  assert.deepEqual(outcome.responsibilityReceipt,result.discardReceipt);
  const intent=outcomes.requestReprocess(input.libraRunId,{expectedOutcomeDigest:outcome.outcomeDigest,actorId:'admin',idempotencyKey:'retry-1'});
  assert.equal(intent.replayed,false);
  assert.equal(outcomes.requestReprocess(input.libraRunId,{expectedOutcomeDigest:outcome.outcomeDigest,actorId:'admin',idempotencyKey:'retry-1'}).replayed,true);
  const nextIntent=outcomes.requestReprocess(input.libraRunId,{expectedOutcomeDigest:outcome.outcomeDigest,actorId:'admin',idempotencyKey:'retry-2'});
  assert.notEqual(nextIntent.intentId,intent.intentId,'an earlier observation request cannot permanently consume recovery');
  assert.deepEqual(outcomes.sourceFieldIds(input.libraRunId),['field-1']);
  assert.equal(check.prepare('SELECT COUNT(*) n FROM libra_workspace_cleanup_scopes').get().n,0);
  assert.equal(check.prepare("SELECT COUNT(*) n FROM fx_outbox WHERE message_kind='libra.workspace-cleanup.requested@1'").get().n,1);
  assert.equal(check.prepare("SELECT consumer_domain FROM fx_outbox_deliveries WHERE message_id=(SELECT message_id FROM fx_outbox WHERE message_kind='libra.workspace-cleanup.requested@1')").get().consumer_domain,'libra');
  check.close();
}));

test('discard accepts an active Run whose Handoff B Delivery Receipt is already rejected',()=>fixture((input)=>{
  const packageDigest=D('rejected-package'),onDeckPackageId='package-rejected',
    offerId=canonicalDigest({schema:'libra.product-offer-id@1',onDeckPackageId,packageDigest}),
    db=new Database(input.databasePath);
  db.prepare('INSERT INTO libra_product_packages (on_deck_package_id,offer_id,package_revision,libra_run_id,package_digest,state,published_at_ms) VALUES (?,?,?,?,?,?,?)')
    .run(onDeckPackageId,offerId,1,input.libraRunId,packageDigest,'published',2);
  db.prepare('INSERT INTO libra_delivery_receipts (receipt_id,offer_id,on_deck_package_id,package_digest,result,rejection_digest,closure_digest,received_at_ms) VALUES (?,?,?,?,?,?,?,?)')
    .run(D('delivery-receipt'),offerId,onDeckPackageId,packageDigest,'rejected',D('rejection'),D('closure'),2);
  db.close();
  const store=createRunDiscardStore({schemaManifest,unitOfWork:input.unitOfWork});
  const command=buildRunDiscardCommand({libraRunId:input.libraRunId,expectedRunStateRevision:input.admitted.stateRevision,
    expectedRunStateDigest:input.admitted.stateDigest,actorId:'admin',idempotencyKey:'discard-rejected'});
  const inspected=store.inspect(command);
  assert.equal(inspected.kind,'ready', inspected.resultKind || inspected.kind);
  const options={schemaManifest,unitOfWork:input.unitOfWork,libraRunExecutionProjection:{invalidate(){}}};
  const admin=require('../../src/helix/domains/libra/application/libra-run-admin-service').createLibraRunAdminService(options);
  const coordinator=require('../../src/helix/domains/libra/application/libra-run-coordinator').createLibraRunCoordinator({
    ...options,workResultReader:{},workspaceProductPort:{},movieProductionReader:{
      readRunSnapshot:()=>({run:{libraRunId:input.libraRunId,state:'active',packageRevisionHead:1}}),
      readPublishedDeliveryRef:()=>({offerId}),readDeliveryReceipt:()=>({result:'rejected'})},
    resolveRejectedRun:admin.reconcileRejected});
  const result=coordinator.reconcile(input.libraRunId);
  assert.equal(result.kind,'unable_to_on_deck');
  assert.equal(result.resultKind,'discarded');
  const check=new Database(input.databasePath,{readonly:true});
  assert.equal(check.prepare('SELECT state FROM libra_runs').get().state,'discarded');
  const outcome=JSON.parse(check.prepare('SELECT outcome_json FROM libra_run_outcomes').get().outcome_json);
  assert.equal(outcome.reasonCode,'processing_failed');
  assert.deepEqual(outcome.terminalReasons.map(x=>x.failureCode),['handoff_b_rejected']);
  check.close();
}));


test('Discard replay rejects a changed bounded Record, immutable Decision, or marker',()=>fixture(input=>{
  const store=createRunDiscardStore({schemaManifest,unitOfWork:input.unitOfWork});
  const command=buildRunDiscardCommand({libraRunId:input.libraRunId,expectedRunStateRevision:input.admitted.stateRevision,
    expectedRunStateDigest:input.admitted.stateDigest,actorId:'admin',idempotencyKey:'bounded-discard'});
  const result=store.commit(store.inspect(command));
  assert.deepEqual(store.inspect(command),result);
  const db=new Database(input.databasePath);
  try {
    const row=db.prepare("SELECT * FROM fx_event_result_bindings WHERE evidence_schema_ref LIKE '%LibraRunDiscardDecisionRecord%'").get();
    assert.ok(Buffer.byteLength(row.evidence_json)<65536);
    const record=JSON.parse(row.evidence_json),changed={...record,committedRunStateRevision:record.committedRunStateRevision+1};
    db.prepare('UPDATE fx_event_result_bindings SET evidence_json=?,evidence_digest=? WHERE result_id=?')
      .run(canonicalJson(changed),canonicalDigest(changed),row.result_id);
    assert.throws(()=>store.inspect(command),{code:'P9_DISCARD_RECORD_INTEGRITY'});
    db.prepare('UPDATE fx_event_result_bindings SET evidence_json=?,evidence_digest=? WHERE result_id=?')
      .run(row.evidence_json,row.evidence_digest,row.result_id);
    const revision=db.prepare('SELECT * FROM libra_run_revisions WHERE libra_run_id=? AND state_revision=?')
      .get(input.libraRunId,record.committedRunStateRevision);
    const decision=JSON.parse(revision.transition_evidence_json);decision.actorId='foreign';
    db.prepare('UPDATE libra_run_revisions SET transition_evidence_json=? WHERE libra_run_id=? AND state_revision=?')
      .run(canonicalJson(decision),input.libraRunId,record.committedRunStateRevision);
    assert.throws(()=>store.inspect(command),{code:'P9_DISCARD_RECORD_INTEGRITY'});
    db.prepare('UPDATE libra_run_revisions SET transition_evidence_json=? WHERE libra_run_id=? AND state_revision=?')
      .run(revision.transition_evidence_json,input.libraRunId,record.committedRunStateRevision);
    db.prepare('UPDATE fx_commit_markers SET commit_digest=? WHERE result_id=?').run(D('foreign'),row.result_id);
    assert.throws(()=>store.inspect(command),{code:'P9_DISCARD_RECORD_INTEGRITY'});
  } finally {db.close();}
}));


test('terminal Result evidence reads only its exact Work events and referenced Plan',()=>fixture(input=>{
  const original=input.unitOfWork,reads=[];
  input.unitOfWork={execute(participants){return original.execute(participants.map(p=>({...p,execute(c){return p.execute({...c,repository(id){const r=c.repository(id);return {...r,invoke(name,args){reads.push(name);assert.ok(!['list_plans','list_events'].includes(name),'Global execution history is outside this terminal query.');return r.invoke(name,args);}};}});}})));}};
  const {built}=sizeCapTerminal(input,['size_cap_exceeded']);
  assert.equal(built.evidence.blockedWorks.length,1);assert.ok(reads.includes('find_plan'));assert.ok(reads.includes('find_event'));
}));

function defectRequirements(profile){
  const rules=require('../../src/helix/domains/arca/model/rule-template-contracts').BETA_RECOMMENDED_RULES;
  const requirements=JSON.parse(JSON.stringify(rules.profileRuleSets.find(item=>item.contentProfile===profile).baseRequirements));
  if(profile==='movie'){
    requirements.metadata.requiredFieldCodes=['title','tmdb_movie_id'];
    requirements.space={unit:'product',maxSizeGiB:1,maxSizeBytes:1073741824};
  }
  return requirements;
}
function seedSucceededWork(db,libraRunId,workId,workKind,capabilityRef,result){
  const planId=workId+'-plan',eventId=workId+'-event',resultId=workId+'-result';
  db.prepare('INSERT INTO fx_supporting_works(work_id,owner_domain,process_type,process_id,work_kind,basis_digest,priority_class,state,idempotency_key,created_at_ms,updated_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(workId,'libra','libra_run',libraRunId,workKind,D(workId+'-basis'),'normal','succeeded',workId+'-key',1,2);
  db.prepare('INSERT INTO fx_workflow_plans(plan_id,planner_ref,planner_version,catalog_digest,basis_digest,graph_digest,state,created_at_ms) VALUES(?,?,?,?,?,?,?,?)')
    .run(planId,'planner',1,D('catalog'),D(workId+'-basis'),D('graph'),'planned',1);
  db.prepare('INSERT INTO fx_plan_nodes(plan_id,node_id,capability_ref,input_bindings_json) VALUES(?,?,?,?)')
    .run(planId,'node-1',capabilityRef,canonicalJson({bindings:[]}));
  db.prepare('INSERT INTO fx_workflow_events(event_id,plan_id,node_id,work_id,owner_domain,capability_ref,contract_version,state,priority_class,result_id) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(eventId,planId,'node-1',workId,'libra',capabilityRef,1,'succeeded','normal',resultId);
  db.prepare('INSERT INTO fx_event_attempts(event_attempt_id,event_id,ordinal,state,outcome_kind,started_at_ms,finished_at_ms) VALUES(?,?,?,?,?,?,?)')
    .run(workId+'-attempt',eventId,1,'completed','succeeded',1,2);
  db.prepare('INSERT INTO fx_event_result_bindings(result_id,event_id,outcome_kind,result_schema_ref,result_json,result_digest,committed_at_ms) VALUES(?,?,?,?,?,?,?)')
    .run(resultId,eventId,'succeeded','fixture.result@1',canonicalJson(result),canonicalDigest(result),2);
}
function seedProductFacts(db,libraRunId,{profile='western_adult',title='Sample',identitySubject='subject-1',omitIdentity=false,omitMetadata=false,
  actor=true,mismatchedIdentity=false,mismatchedCast=false}={}){
  const identity=require('../../src/helix/domains/libra/model/product-fact-contracts').buildResolvedProductIdentity({
    subjectId:identitySubject,contentProfile:profile,structureKind:'single',identityKind:profile==='western_adult'?'internal_identity':'tmdb_movie',
    producerRef:'libra.product_identity.resolve@1',basisDigest:D('identity-basis'),observedAtMs:1,
    providerIdentities:[profile==='western_adult'?{provider:'internal',namespace:'internal_identity',providerKey:'us-adult:fixture'}:
      {provider:'tmdb',namespace:'tmdb_movie',providerKey:'123'}],displayEntries:[{key:'title',value:'Sample'}]});
  const actorRelation={relationId:D('relation'),personId:'person-1',displayName:'Actor',displayNameNormalized:'actor',role:'actor',
    source:profile==='western_adult'?'user_actor_choice':'provider',providerIdentities:[],originEvidenceDigest:D('actor'),confidenceClass:'user_confirmed'},
    relations=actor?[{...actorRelation,relationDigest:canonicalDigest(actorRelation)}]:[],
    relationsDigest=canonicalDigest({schema:'libra.media-cast-relations@1',relations}),castBody={subjectId:'subject-1',
      sourceBasisKind:profile==='western_adult'?'us_adult_actor':'metadata_observation',sourceBasisDigest:D('cast-basis'),relations,relationsDigest,relationCount:relations.length},
    castDigest=canonicalDigest({schema:'libra.media-cast-fact@1',...castBody}),
    cast={schemaRef:'helix://contracts/types/MediaCastFact/v1',schemaVersion:1,
      factId:canonicalDigest({schema:'libra.product-fact-id@1',libraRunId,factKind:'media_cast',factRevision:1}),ownerDomain:'libra',
      aggregateType:'libra_product_fact',aggregateId:canonicalDigest({schema:'libra.product-fact-aggregate-id@1',libraRunId,factKind:'media_cast'}),
      revision:1,factSchemaRef:'helix://contracts/types/MediaCastFact/v1',factDigest:castDigest,commitMarker:'fixture-cast-marker',committedAtMs:1,...castBody};
  const descriptiveBody={schemaRef:'helix://contracts/records/descriptive-facts/v1',schemaVersion:1,recordKind:'descriptive-facts',
    entries:[{key:'title',value:title}]},descriptiveFacts={...descriptiveBody,recordDigest:canonicalDigest(descriptiveBody)};
  const metadataBody={subjectId:'subject-1',resolvedIdentityDigest:mismatchedIdentity?D('foreign-identity'):identity.identityDigest,sourceBasisKind:profile==='western_adult'?'western_analysis':'metadata_observation',
    sourceBasisDigest:D('metadata-basis'),metadataObservationSetDigest:profile==='western_adult'?null:D('observations'),
    westernAnalysisVariantDigest:profile==='western_adult'?D('analysis'):null,fieldProvenance:[],descriptiveFacts,providerIdentities:[],
    mediaCastFactRef:{productFactId:cast.factId,factRevision:1,factDigest:mismatchedCast?D('foreign-cast'):cast.factDigest},verifiedArtifactManifestDigest:D('artifacts')},
    metadataDigest=canonicalDigest({schema:'libra.product-metadata@1',...metadataBody}),
    metadata={schemaRef:'helix://contracts/types/ProductMetadataFact/v1',schemaVersion:1,
      factId:canonicalDigest({schema:'libra.product-fact-id@1',libraRunId,factKind:'product_metadata',factRevision:1}),ownerDomain:'libra',
      aggregateType:'libra_product_fact',aggregateId:canonicalDigest({schema:'libra.product-fact-aggregate-id@1',libraRunId,factKind:'product_metadata'}),
      revision:1,factSchemaRef:'helix://contracts/types/ProductMetadataFact/v1',factDigest:metadataDigest,commitMarker:'fixture-metadata-marker',
      committedAtMs:1,productMetadataDigest:metadataDigest,...metadataBody};
  const validator=require('../../src/helix/foundation/capability/contract-validator').createCapabilityContractValidator({schemas:[
    require('../../src/helix/contracts/types/ProductMetadataFact/v1/schema.json'),require('../../src/helix/contracts/types/MediaCastFact/v1/schema.json'),
    require('../../src/helix/contracts/domain-types/ResolvedProviderIdentity/v1/schema.json'),require('../../src/helix/contracts/types/PhysicalMaterialIdentity/v2/schema.json')]});
  validator.validate(metadata.schemaRef,metadata);validator.validate(cast.schemaRef,cast);
  const insert=db.prepare('INSERT INTO libra_product_fact_revisions(product_fact_id,libra_run_id,fact_kind,fact_revision,schema_ref,fact_json,fact_digest,evidence_digest,result_digest) VALUES(?,?,?,?,?,?,?,?,?)');
  if(!omitIdentity)insert.run('fixture-identity',libraRunId,'resolved_identity',1,identity.schemaRef,canonicalJson(identity),identity.identityDigest,D('identity-evidence'),canonicalDigest(identity));
  insert.run(cast.factId,libraRunId,'media_cast',1,cast.schemaRef,canonicalJson(cast),cast.factDigest,D('cast-evidence'),canonicalDigest(cast));
  if(!omitMetadata)insert.run(metadata.factId,libraRunId,'product_metadata',1,metadata.schemaRef,canonicalJson(metadata),metadata.factDigest,D('metadata-evidence'),canonicalDigest(metadata));
}
function frozenSizePreview(input,{profile='western_adult',title='Sample',identitySubject='subject-1',omitIdentity=false,omitMetadata=false,
  actor=true,missingArtifact=null,mismatchedIdentity=false,mismatchedCast=false,verificationChange={}}={}){
  const db=new Database(input.databasePath),verification={libraRunId:input.libraRunId,candidateKind:'workspace_output',result:'failed',reasonCodes:['max_size_exceeded'],
    verificationId:D('size-verification'),candidateBasisDigest:D('size-candidate'),productMaterialHandleId:'workspace-product-1',
    productMaterialHandleDigest:D('workspace-product'),productMaterialFenceDigest:D('workspace-fence'),workspaceMediaHandleId:'workspace-media-1',
    spaceSummary:{unit:'product',actualSizeBytes:1610612736,maxSizeBytes:1073741824,withinLimit:false},
    decodeSummary:{samplePointsPercent:[5,50,95],passedSamplePointsPercent:[5,50,95],decodeDigest:D('playback')},...verificationChange};
  try{
    seedProductFacts(db,input.libraRunId,{profile,title,identitySubject,omitIdentity,omitMetadata,actor,mismatchedIdentity,mismatchedCast});
    for(const kind of ['nfo','poster'].filter(item=>item!==missingArtifact))
      seedSucceededWork(db,input.libraRunId,'artifact-'+kind,'artifact_production','shared.artifact.manifest.verify@1',{result:'passed',requirement:{artifactKind:kind}});
    if(profile==='movie')seedSucceededWork(db,input.libraRunId,'metadata-observation','product_metadata_observation','libra.product_metadata.fetch@1',
      {sourcePriority:0,evidenceId:'metadata-evidence',descriptiveFacts:{entries:[{key:'title',value:'Sample'},{key:'tmdb_movie_id',value:'123'}]},peopleHints:[]});
    const {store,built}=sizeCapTerminal(input,['max_size_exceeded'],verification);
    db.prepare('INSERT INTO fx_plan_nodes(plan_id,node_id,capability_ref,input_bindings_json) VALUES(?,?,?,?)')
      .run('size-cap-plan','node-1','libra.product_media.verify@1',canonicalJson({bindings:[]}));
    store.transition({decision:lifecycleDecision(input,built.evidence,'freeze'),commitMarker:'size-preview-freeze',resultId:'size-preview-frozen'});
    return {verification};
  }finally{db.close();}
}
function defectAdmin(input){return require('../../src/helix/domains/libra/application/libra-run-admin-service').createLibraRunAdminService({
  schemaManifest,unitOfWork:input.unitOfWork,now:()=>3000,libraRunExecutionProjection:{invalidate(){}}});}
function manualDefectCommand(preview){return {expectedRunStateRevision:preview.frozenRunStateRevision,expectedRunStateDigest:preview.frozenRunStateDigest,
  expectedDefectCandidateDigest:preview.candidateDigest,idempotencyKey:'manual-defect',acknowledged:true};}

test('US size-only preview reads committed same-Run facts and supports explicit manual confirmation',()=>fixture(input=>{
  frozenSizePreview(input);const admin=defectAdmin(input),preview=admin.previewDefects(input.libraRunId);
  assert.equal(preview.eligibility,'eligible');assert.deepEqual(preview.defects.map(item=>item.defectCode),['size_cap_exceeded']);
  assert.deepEqual(preview.waivedRequirementCodes,['max_size_exceeded']);assert.equal(preview.sizeForecast.measured,true);
  const command=manualDefectCommand(preview);
  assert.throws(()=>admin.admitWithDefects(input.libraRunId,{...command,acknowledged:false}),{code:'LIBRA_DEFECT_ADMISSION_INPUT'});
  const accepted=admin.admitWithDefects(input.libraRunId,command);
  assert.equal(accepted.resultKind,'defect_admitted');assert.equal(accepted.authorizedDefectManifest.authorizationSource,'manual');
  assert.equal(admin.admitWithDefects(input.libraRunId,command).replayed,true);
},{contentProfile:'western_adult',requirements:defectRequirements('western_adult')}));

test('US manual confirmation rechecks the exact Product Facts shown by the preview',()=>fixture(input=>{
  frozenSizePreview(input);const admin=defectAdmin(input),preview=admin.previewDefects(input.libraRunId),db=new Database(input.databasePath);
  try{
    assert.equal(preview.eligibility,'eligible');
    db.prepare('DELETE FROM libra_product_fact_revisions WHERE libra_run_id=? AND fact_kind=?').run(input.libraRunId,'product_metadata');
    const before=db.prepare('SELECT count(*) n FROM libra_run_revisions').get().n;
    assert.throws(()=>admin.admitWithDefects(input.libraRunId,manualDefectCommand(preview)),{code:'P9_DEFECT_ADMISSION_EVIDENCE_PENDING'});
    assert.equal(db.prepare('SELECT state FROM libra_runs').get().state,'frozen');
    assert.equal(db.prepare('SELECT count(*) n FROM libra_run_revisions').get().n,before);
  }finally{db.close();}
},{contentProfile:'western_adult',requirements:defectRequirements('western_adult')}));

test('US size preview rejects corrupt persisted Product Metadata instead of treating it as a missing observation',()=>fixture(input=>{
  frozenSizePreview(input);const db=new Database(input.databasePath);
  try{
    const row=db.prepare("SELECT fact_json FROM libra_product_fact_revisions WHERE fact_kind='product_metadata'").get(),value=JSON.parse(row.fact_json);
    value.descriptiveFacts.entries[0].value='changed';
    db.prepare("UPDATE libra_product_fact_revisions SET fact_json=? WHERE fact_kind='product_metadata'").run(canonicalJson(value));
    assert.throws(()=>defectAdmin(input).previewDefects(input.libraRunId),{code:'P14_MOVIE_PRODUCTION_FACT_DRIFT'});
    assert.equal(db.prepare('SELECT state FROM libra_runs').get().state,'frozen');
  }finally{db.close();}
},{contentProfile:'western_adult',requirements:defectRequirements('western_adult')}));

test('US size preview cannot use a Spec belonging to another Subject',()=>fixture(input=>{
  frozenSizePreview(input);const db=new Database(input.databasePath);
  try{
    const row=db.prepare('SELECT spec_json FROM libra_acceptance_specs').get(),spec=JSON.parse(row.spec_json);spec.subjectId='foreign-subject';
    db.prepare('UPDATE libra_acceptance_specs SET spec_json=?').run(canonicalJson(spec));
    assert.equal(defectAdmin(input).previewDefects(input.libraRunId).eligibility,'ineligible');
    assert.equal(db.prepare('SELECT state FROM libra_runs').get().state,'frozen');
  }finally{db.close();}
},{contentProfile:'western_adult',requirements:defectRequirements('western_adult')}));

test('Movie standing authorization never automatically admits a US size defect',()=>fixture(input=>{
  frozenSizePreview(input);const admin=defectAdmin(input);
  admin.setAutomaticAuthorization({enabled:true,expectedRevision:0,idempotencyKey:'enable-movie',acknowledged:true});
  const before=new Database(input.databasePath,{readonly:true});
  try{
    const revisions=before.prepare('SELECT count(*) n FROM libra_run_revisions').get().n;
    assert.equal(admin.reconcileFrozen(input.libraRunId).kind,'awaiting_defect_decision');
    assert.equal(before.prepare('SELECT state FROM libra_runs').get().state,'frozen');
    assert.equal(before.prepare('SELECT count(*) n FROM libra_run_revisions').get().n,revisions);
  }finally{before.close();}
},{contentProfile:'western_adult',requirements:defectRequirements('western_adult')}));

test('an existing Movie standing authorization still admits its exact eligible size defect',()=>fixture(input=>{
  frozenSizePreview(input,{profile:'movie'});const admin=defectAdmin(input);
  admin.setAutomaticAuthorization({enabled:true,expectedRevision:0,idempotencyKey:'enable-movie',acknowledged:true});
  const db=new Database(input.databasePath,{readonly:true}),head=db.prepare('SELECT * FROM libra_run_admission_heads').get();db.close();
  const result=admin.reconcileFrozen(input.libraRunId);
  assert.equal(result.kind,'defect_admitted');assert.equal(result.authorizedDefectManifest.authorizationSource,'standing');
  assert.deepEqual(result.authorizedDefectManifest.waivedRequirementCodes,['max_size_exceeded']);
  const manifest=result.authorizedDefectManifest,decision=buildRunLifecycleDecision({libraRunId:input.libraRunId,
    expectedStateRevision:manifest.frozenRunRef.stateRevision,expectedStateDigest:manifest.frozenRunRef.stateDigest,
    transitionKind:'defect_admit',transitionEvidence:manifest,expectedAdmissionHeadRevision:head.head_revision,
    expectedActiveScopeSetDigest:head.active_scope_set_digest});
  admin.setAutomaticAuthorization({enabled:false,expectedRevision:1,idempotencyKey:'revoke-movie'});
  const replay=createRunLifecycleStore({schemaManifest,unitOfWork:input.unitOfWork}).transition({decision,
    commitMarker:canonicalDigest({schema:'libra.defect-admission-marker@1',defectDecisionId:manifest.defectDecisionId,decisionDigest:decision.decisionDigest}),
    resultId:canonicalDigest({schema:'libra.defect-admission-result-id@1',defectDecisionId:manifest.defectDecisionId})});
  assert.equal(replay.replayed,true);assert.equal(replay.result.committedState,'active');
},{contentProfile:'movie',requirements:defectRequirements('movie')}));

test('the lifecycle transaction rejects standing authorization for US even if the coordinator is bypassed',()=>fixture(input=>{
  frozenSizePreview(input);const admin=defectAdmin(input);
  admin.setAutomaticAuthorization({enabled:true,expectedRevision:0,idempotencyKey:'enable-movie',acknowledged:true});
  const preview=admin.previewDefects(input.libraRunId),standing=admin.readAutomaticAuthorization(),
    {eligibility,missingEvidence,ineligibleReasons,pathResults,sizeForecast,...candidate}=preview;
  assert.throws(()=>admin.admitWithDefects(input.libraRunId,manualDefectCommand(preview),standing),{code:'LIBRA_DEFECT_AUTHORIZATION_SCOPE'});
  const manifest=require('../../src/helix/domains/libra/model/defect-admission-contracts').buildAuthorizedDefectManifest({
    candidate,actorId:'admin',idempotencyKey:'bypass',acknowledged:true,decidedAtMs:3000,standingAuthorization:standing}),
    db=new Database(input.databasePath,{readonly:true});
  try{
    const run=db.prepare('SELECT * FROM libra_runs').get(),head=db.prepare('SELECT * FROM libra_run_admission_heads').get(),
      before=db.prepare('SELECT count(*) n FROM libra_run_revisions').get().n,
      decision=buildRunLifecycleDecision({libraRunId:input.libraRunId,expectedStateRevision:run.state_revision,expectedStateDigest:run.state_digest,
        transitionKind:'defect_admit',transitionEvidence:manifest,expectedAdmissionHeadRevision:head.head_revision,
        expectedActiveScopeSetDigest:head.active_scope_set_digest});
    assert.throws(()=>createRunLifecycleStore({schemaManifest,unitOfWork:input.unitOfWork}).transition({decision,
      commitMarker:'forged-standing-marker',resultId:'forged-standing-result'}),{code:'LIBRA_DEFECT_AUTHORIZATION_SCOPE'});
    assert.equal(db.prepare('SELECT state FROM libra_runs').get().state,'frozen');
    assert.equal(db.prepare('SELECT count(*) n FROM libra_run_revisions').get().n,before);
  }finally{db.close();}
},{contentProfile:'western_adult',requirements:defectRequirements('western_adult')}));

test('Movie actor-only defect keeps its existing provider evidence and requires manual confirmation',()=>{
  const requirements=defectRequirements('movie');requirements.metadata.requiredFieldCodes=['actor','title','tmdb_movie_id'];
  return fixture(input=>{
    const db=new Database(input.databasePath),observation={sourceKind:'provider',sourcePriority:0,evidenceId:'actor-observation',peopleHints:[],
      descriptiveFacts:{entries:[{key:'title',value:'Sample'},{key:'tmdb_movie_id',value:'123'}]}};
    try{
      seedSucceededWork(db,input.libraRunId,'metadata-observation','product_metadata_observation','libra.product_metadata.fetch@1',observation);
      for(const kind of ['nfo','poster'])seedSucceededWork(db,input.libraRunId,'artifact-'+kind,'artifact_production',
        'shared.artifact.manifest.verify@1',{result:'passed',requirement:{artifactKind:kind}});
      seedSucceededWork(db,input.libraRunId,'media-proof','workspace_media_production','libra.product_media.verify@1',
        {libraRunId:input.libraRunId,candidateKind:'direct_input',result:'passed',reasonCodes:[],verificationId:D('actor-media-proof'),
          productMaterialHandleId:'original',decodeSummary:{samplePointsPercent:[5,50,95],passedSamplePointsPercent:[5,50,95],decodeDigest:D('actor-playback')}});
      const store=createRunLifecycleStore({schemaManifest,unitOfWork:input.unitOfWork,resolveRetryPolicyDigest:()=>D('actor-policy')}),
        built=store.buildTerminalEvidence({libraRunId:input.libraRunId,workId:'metadata-observation',blockerKind:'product_unachievable',assessedAtMs:2000,
          terminalResult:{eventId:'metadata-observation-event',failureClass:'business_unachievable',failureCode:'product_metadata_required_cast_missing',
            resultDigest:canonicalDigest(observation)}});
      store.transition({decision:lifecycleDecision(input,built.evidence,'freeze'),commitMarker:'actor-freeze',resultId:'actor-frozen'});
      const admin=defectAdmin(input),preview=admin.previewDefects(input.libraRunId);
      assert.equal(preview.eligibility,'eligible');assert.deepEqual(preview.defects.map(item=>item.defectCode),['actor_unavailable']);
      assert.deepEqual(preview.defects[0].metadataFieldCodes,['actor']);
      assert.equal(admin.reconcileFrozen(input.libraRunId).kind,'awaiting_defect_decision');
      assert.equal(admin.admitWithDefects(input.libraRunId,manualDefectCommand(preview)).authorizedDefectManifest.authorizationSource,'manual');
    }finally{db.close();}
  },{contentProfile:'movie',requirements});
});

for(const [name,change,expected]of [
  ['missing identity',{omitIdentity:true},'evidence_pending'],['missing product metadata',{omitMetadata:true},'evidence_pending'],
  ['foreign identity',{identitySubject:'foreign-subject'},'ineligible'],['missing title',{title:''},'ineligible'],
  ['different identity binding',{mismatchedIdentity:true},'ineligible'],['different cast binding',{mismatchedCast:true},'ineligible'],
  ['missing actor',{actor:false},'ineligible'],['missing poster',{missingArtifact:'poster'},'ineligible'],
  ['missing playback evidence',{verificationChange:{decodeSummary:null}},'evidence_pending'],
  ['failed playback sample',{verificationChange:{decodeSummary:{samplePointsPercent:[5,50,95],passedSamplePointsPercent:[5,50],decodeDigest:D('failed-playback')}}},'ineligible'],
  ['contradictory measured size',{verificationChange:{spaceSummary:{unit:'product',actualSizeBytes:512,maxSizeBytes:1073741824,withinLimit:true}}},'ineligible'],
])test('US size preview rejects '+name,()=>fixture(input=>{
  frozenSizePreview(input,change);const admin=defectAdmin(input),preview=admin.previewDefects(input.libraRunId);
  assert.equal(preview.eligibility,expected);
  const db=new Database(input.databasePath,{readonly:true});try{assert.equal(db.prepare('SELECT state FROM libra_runs').get().state,'frozen');}finally{db.close();}
},{contentProfile:'western_adult',requirements:defectRequirements('western_adult')}));

for(const reason of ['playback_decode_failed','output_handle_mismatch'])test('size-only freeze rejects file safety failure '+reason,()=>fixture(input=>{
  const {store,built}=sizeCapTerminal(input,['max_size_exceeded',reason]);
  assert.throws(()=>store.transition({decision:lifecycleDecision(input,built.evidence,'freeze'),commitMarker:'unsafe-'+reason,resultId:'unsafe-result-'+reason}),
    {code:'P9_RUN_LIFECYCLE_TERMINAL'});
},{contentProfile:'western_adult',requirements:defectRequirements('western_adult')}));
