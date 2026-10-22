'use strict';

const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const test=require('node:test');const Database=require('better-sqlite3');
const {canonicalDigest,canonicalJson}=require('../../src/helix/contracts/canonical-json');const {openSqliteKernel}=require('../../src/helix/foundation/persistence/sqlite-kernel');const {createSqliteUnitOfWork}=require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const {activeRunScopeSetDigest,buildProductionMaterialManifest,buildRunAdmissionDecision,buildRunExecutionBasis}=require('../../src/helix/domains/libra/model/run-admission-contracts');const {createRunAdmissionStore}=require('../../src/helix/domains/libra/persistence/run-admission-store');
const generated=path.resolve(__dirname,'../../src/helix/foundation/persistence/generated'),schemaDdl=fs.readFileSync(path.join(generated,'clean-schema.sql'),'utf8'),schemaManifest=JSON.parse(fs.readFileSync(path.join(generated,'clean-schema.manifest.json'),'utf8'));const D=(value)=>canonicalDigest({value});
const EMPTY_RELATED_SCOPE={relatedReferenceSetDigest:canonicalDigest({schema:'procurement.related-reference-set@1',items:[]}),relatedDispositionScopeDigest:canonicalDigest({schema:'procurement.related-disposition-scope@1',items:[]}),items:[]};
function controlProjection(materialKey){const base={materialKey,resultKind:'available',controlRevision:2,controlState:'controlled',ownerDomain:'libra',ownerScopeType:'subject',ownerScopeId:'subject-1',regionProjection:'production'},evidenceDigest=canonicalDigest({schema:'foundation.material-control-evidence@1',materialKey,resultKind:'available',controlRevision:2,controlState:'controlled',ownerDomain:'libra',ownerScopeType:'subject',ownerScopeId:'subject-1'});return {...base,evidenceDigest,projectionDigest:canonicalDigest({...base,evidenceDigest})};}
function fixture(run){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'helix-p9-run-')),databasePath=path.join(dir,'db.sqlite');let now=100;openSqliteKernel({Database,databasePath,schemaDdl,schemaManifest,now:()=>now++}).close();const db=new Database(databasePath),identity={mountScopeId:'mount-1',inode:'11',sizeBytes:100,fingerprintAlgorithm:'middle-256k-sha256',fingerprintVersion:1,contentFingerprint:D('content')},materialKey=canonicalDigest({schema:'physical-material-identity@2',...identity}),control=controlProjection(materialKey),productScopeDigest=canonicalDigest({schema:'libra.product-scope@1',subjectId:'subject-1',scopeKind:'single',subjectIntakeRevision:1,episodeKeys:[]}),requirements={identity:{},structure:{structureKind:'single'},metadata:{},mandatoryMedia:{},space:{},inventory:{}},spec={acceptanceSpecId:'spec-1',specRevision:1,specDigest:D('spec'),recordDigest:D('record'),productScopeDigest,productScope:{subjectId:'subject-1',scopeKind:'single',subjectIntakeRevision:1,episodeKeys:[],scopeDigest:productScopeDigest},shelfId:'shelf-1',requirements};
  db.prepare('INSERT INTO libra_intake_decisions (intake_decision_id,candidate_package_id,source_field_id,source_field_access_revision,source_field_context_digest,candidate_identity_claim_digest) VALUES (?,?,?,?,?,?)').run('intake-1','candidate-1','field-1',1,D('field'),D('claim'));
  db.prepare('INSERT INTO libra_subjects (subject_id,structure_kind,content_profile,routing_anchor_intake_decision_id,status,intake_revision,current_continuity_set_digest,current_episode_scope_digest) VALUES (?,?,?,?,?,?,?,?)').run('subject-1','single','movie','intake-1','active',1,D('continuity'),D('episodes'));
  db.prepare('INSERT INTO libra_acceptance_specs (acceptance_spec_id,subject_id,shelf_id,shelf_routing_projection_revision,shelf_projection_digest,shelf_standard_revision,shelf_standard_digest,product_scope_digest,spec_revision,spec_schema_ref,spec_json,spec_digest,record_digest,structure_kind,content_profile,published_at_ms) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('spec-1','subject-1','shelf-1',1,D('projection'),1,D('standard'),productScopeDigest,1,'AcceptanceSpec@1',canonicalJson(spec),spec.specDigest,spec.recordDigest,'single','movie',1);
  db.prepare('INSERT INTO libra_subject_decision_heads (subject_id,head_revision,head_digest,current_acceptance_spec_id,updated_at_ms) VALUES (?,?,?,?,?)').run('subject-1',4,D('head'),'spec-1',1);
  db.prepare('INSERT INTO libra_material_bindings (subject_id,material_key,role,authority_kind,primary_material_key,association_evidence_digest,disposition_basis_digest,mount_scope_id,inode,fingerprint_algorithm,fingerprint_version,content_fingerprint,size_bytes,endpoint_id,location,binding_revision,health_state,evidence_digest,origin_intake_decision_id,origin_offer_id,origin_candidate_package_id,origin_package_revision,origin_package_digest,origin_candidate_delivery_snapshot_digest,origin_related_reference_set_digest,origin_related_disposition_scope_digest,current) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('subject-1',materialKey,'primary_payload','primary_control',null,null,null,identity.mountScopeId,identity.inode,identity.fingerprintAlgorithm,identity.fingerprintVersion,identity.contentFingerprint,100,'endpoint-1','/library/input.mkv',1,'active',D('binding'),'intake-1','offer-1','candidate-1',1,D('package'),D('delivery'),D('related'),D('related-scope'),1);
  db.prepare('INSERT INTO fx_material_controls VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(materialKey,identity.mountScopeId,identity.inode,identity.sizeBytes,identity.fingerprintAlgorithm,identity.fingerprintVersion,identity.contentFingerprint,'libra','subject','subject-1',2,'controlled',1);
  db.prepare('INSERT INTO fx_material_control_revisions VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(materialKey,1,'acquire',null,null,null,'libra','subject','subject-1',D('control-1'),'control-marker-1',1);
  db.prepare('INSERT INTO fx_material_control_revisions VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(materialKey,2,'replace_control_set','libra','subject','subject-1','libra','subject','subject-1',D('control-2'),'control-marker-2',2);db.close();
  const kernel=openSqliteKernel({Database,databasePath,schemaDdl,schemaManifest,now:()=>now++}),unitOfWork=createSqliteUnitOfWork({kernel});try{return run({databasePath,unitOfWork,identity,materialKey,control,spec});}finally{kernel.close();fs.rmSync(dir,{recursive:true,force:true});}}
function decision(input){const libraRunId=canonicalDigest({schema:'libra.run-id@1',subjectId:'subject-1',admissionRevision:1}),member={materialKey:input.materialKey,role:'primary_payload',physicalIdentity:input.identity,sizeBytes:100,location:{locationKind:'domain_binding',endpointId:'endpoint-1',location:'/library/input.mkv'},bindingKind:'libra_material_binding',bindingRevision:1,bindingEvidenceDigest:D('binding'),originCandidateDeliveryRef:{intakeDecisionId:'intake-1',offerId:'offer-1',candidatePackageId:'candidate-1',packageRevision:1,packageDigest:D('package'),candidateDeliverySnapshotDigest:D('delivery'),relatedReferenceSetDigest:D('related')},admittedControlRevision:2,admittedControlProjectionDigest:input.control.projectionDigest,episodeClaims:[]},manifest=buildProductionMaterialManifest({manifestRole:'run_input',manifestRevision:1,libraRunId,scopeKind:'single',members:[member]},input.spec),basis=buildRunExecutionBasis({subjectSnapshot:{subjectId:'subject-1',intakeRevision:1,structureKind:'single',contentProfile:'movie',continuitySetDigest:D('continuity'),episodeScopeDigest:D('episodes')},decisionHeadSnapshot:{subjectId:'subject-1',headState:'present',headRevision:4,headDigest:D('head'),currentRoutingDecisionId:null,currentDecisionBasisId:null,currentAcceptanceSpecId:'spec-1',snapshotDigest:D('head-snapshot')},acceptanceSpec:input.spec,shelfProjection:{routingProjectionRevision:1,projectionDigest:D('projection'),standardRevision:1,standardDigest:D('standard')},productionMaterialManifest:manifest,relatedDispositionScope:EMPTY_RELATED_SCOPE});return buildRunAdmissionDecision({admissionKind:'initial',subjectId:'subject-1',expectedRunAdmissionHead:{headState:'absent',headRevision:0,activeScopeSetDigest:activeRunScopeSetDigest('subject-1',[])},runExecutionBasis:basis,initialPriority:{priorityClass:'normal',priorityIntentDigest:canonicalDigest({schema:'libra.priority-intent-empty@1'})}});}
function replacementDecision(input,first){const db=new Database(input.databasePath),spec={...input.spec,acceptanceSpecId:'spec-2',specRevision:2,specDigest:D('spec-2'),recordDigest:D('record-2')};db.prepare('INSERT INTO libra_acceptance_specs (acceptance_spec_id,subject_id,shelf_id,shelf_routing_projection_revision,shelf_projection_digest,shelf_standard_revision,shelf_standard_digest,product_scope_digest,spec_revision,spec_schema_ref,spec_json,spec_digest,record_digest,structure_kind,content_profile,published_at_ms) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(spec.acceptanceSpecId,'subject-1','shelf-1',1,D('projection'),1,D('standard'),spec.productScopeDigest,2,'AcceptanceSpec@1',canonicalJson(spec),spec.specDigest,spec.recordDigest,'single','movie',2);db.prepare('UPDATE libra_subject_decision_heads SET head_revision=5,head_digest=?,current_acceptance_spec_id=?,updated_at_ms=2 WHERE subject_id=?').run(D('head-2'),spec.acceptanceSpecId,'subject-1');db.close();
  const libraRunId=canonicalDigest({schema:'libra.run-id@1',subjectId:'subject-1',admissionRevision:2}),member={materialKey:input.materialKey,role:'primary_payload',physicalIdentity:input.identity,sizeBytes:100,location:{locationKind:'domain_binding',endpointId:'endpoint-1',location:'/library/input.mkv'},bindingKind:'libra_material_binding',bindingRevision:1,bindingEvidenceDigest:D('binding'),originCandidateDeliveryRef:{intakeDecisionId:'intake-1',offerId:'offer-1',candidatePackageId:'candidate-1',packageRevision:1,packageDigest:D('package'),candidateDeliverySnapshotDigest:D('delivery'),relatedReferenceSetDigest:D('related')},admittedControlRevision:2,admittedControlProjectionDigest:input.control.projectionDigest,episodeClaims:[]},manifest=buildProductionMaterialManifest({manifestRole:'run_input',manifestRevision:1,libraRunId,scopeKind:'single',members:[member]},spec),basis=buildRunExecutionBasis({subjectSnapshot:{subjectId:'subject-1',intakeRevision:1,structureKind:'single',contentProfile:'movie',continuitySetDigest:D('continuity'),episodeScopeDigest:D('episodes')},decisionHeadSnapshot:{subjectId:'subject-1',headState:'present',headRevision:5,headDigest:D('head-2'),currentRoutingDecisionId:null,currentDecisionBasisId:null,currentAcceptanceSpecId:'spec-2',snapshotDigest:D('head-snapshot-2')},acceptanceSpec:spec,shelfProjection:{routingProjectionRevision:1,projectionDigest:D('projection'),standardRevision:1,standardDigest:D('standard')},productionMaterialManifest:manifest,relatedDispositionScope:EMPTY_RELATED_SCOPE});return buildRunAdmissionDecision({admissionKind:'replacement',subjectId:'subject-1',expectedRunAdmissionHead:{headState:'present',headRevision:first.committedAdmissionHeadRevision,activeScopeSetDigest:first.activeScopeSetDigest},runExecutionBasis:basis,replacementOfRunRef:{libraRunId:first.libraRunId,stateRevision:first.stateRevision,stateDigest:first.stateDigest,runScopeDigest:first.runScopeDigest,acceptanceSpecId:'spec-1',executionBasisDigest:first.executionBasisDigest},initialPriority:{priorityClass:first.priorityClass,priorityIntentDigest:first.priorityIntentDigest}});}

test('atomically admits immutable Run scope and replays from durable Result',()=>fixture((input)=>{const store=createRunAdmissionStore({schemaManifest,unitOfWork:input.unitOfWork}),request={decision:decision(input),commitMarker:'run-marker-1',resultId:'run-result-1'},first=store.admit(request),replay=store.admit(request);assert.equal(first.replayed,false);assert.equal(replay.replayed,true);assert.deepEqual(replay.result,first.result);const db=new Database(input.databasePath,{readonly:true});for(const table of ['libra_run_admission_heads','libra_runs','libra_run_revisions','libra_run_material_manifests','libra_run_material_members','fx_event_result_bindings','fx_commit_markers'])assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n,1);assert.equal(db.prepare('SELECT COUNT(*) n FROM fx_outbox').get().n,0);db.close();}));
test('replacement atomically supersedes the old Run and switches the exact active scope set',()=>fixture((input)=>{const store=createRunAdmissionStore({schemaManifest,unitOfWork:input.unitOfWork}),first=store.admit({decision:decision(input),commitMarker:'run-marker-1',resultId:'run-result-1'}).result,next=store.admit({decision:replacementDecision(input,first),commitMarker:'run-marker-2',resultId:'run-result-2'}).result;assert.equal(next.committedAdmissionHeadRevision,2);assert.equal(next.supersededRunRef.libraRunId,first.libraRunId);assert.equal(next.supersededRunRef.committedStateRevision,2);const db=new Database(input.databasePath,{readonly:true}),old=db.prepare('SELECT state,state_revision,superseded_by_run_id FROM libra_runs WHERE libra_run_id=?').get(first.libraRunId),head=db.prepare('SELECT * FROM libra_run_admission_heads').get();assert.deepEqual(old,{state:'superseded',state_revision:2,superseded_by_run_id:next.libraRunId});assert.equal(head.head_revision,2);assert.equal(head.active_scope_set_digest,next.activeScopeSetDigest);assert.equal(db.prepare('SELECT COUNT(*) n FROM libra_runs').get().n,2);assert.equal(db.prepare('SELECT COUNT(*) n FROM libra_run_revisions').get().n,3);assert.equal(db.prepare('SELECT COUNT(*) n FROM fx_outbox').get().n,0);db.close();}));
test('stale Control snapshot rolls back every Run admission write',()=>fixture((input)=>{const request={decision:decision(input),commitMarker:'run-marker-stale',resultId:'run-result-stale'},db=new Database(input.databasePath);db.prepare("UPDATE fx_material_controls SET owner_scope_id='other-subject'").run();db.close();assert.throws(()=>createRunAdmissionStore({schemaManifest,unitOfWork:input.unitOfWork}).admit(request));const check=new Database(input.databasePath,{readonly:true});for(const table of ['libra_run_admission_heads','libra_runs','libra_run_revisions','libra_run_material_manifests','libra_run_material_members','fx_event_result_bindings','fx_commit_markers'])assert.equal(check.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n,0);check.close();}));
test('crash after Result and marker writes leaves the canonical transaction wholly absent',()=>fixture((input)=>{const crashing={execute(participants){return input.unitOfWork.execute(participants.map((participant)=>participant.participantId!=='run_admission_foundation'?participant:{...participant,execute(context){participant.execute(context);throw new Error('fixture-crash-after-foundation-write');}}));}},store=createRunAdmissionStore({schemaManifest,unitOfWork:crashing});assert.throws(()=>store.admit({decision:decision(input),commitMarker:'run-marker-crash',resultId:'run-result-crash'}),/fixture-crash/);const db=new Database(input.databasePath,{readonly:true});for(const table of ['libra_run_admission_heads','libra_runs','libra_run_revisions','libra_run_material_manifests','libra_run_material_members','libra_run_material_episode_claims','fx_event_result_bindings','fx_commit_markers'])assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n,0);db.close();}));

test('admission persists a typed compact Evidence and rejects tampered replay',()=>fixture((input)=>{
  const store=createRunAdmissionStore({schemaManifest,unitOfWork:input.unitOfWork});
  const request={decision:decision(input),commitMarker:'compact-marker',resultId:'compact-result'};
  store.admit(request);
  const db=new Database(input.databasePath);
  const row=db.prepare('SELECT evidence_schema_ref,evidence_json,evidence_digest FROM fx_event_result_bindings').get();
  const record=JSON.parse(row.evidence_json);
  assert.equal(row.evidence_schema_ref,'helix://contracts/types/LibraRunAdmissionDecisionRecord/v1');
  assert.equal(record.runExecutionBasis,undefined);
  assert.equal(record.decisionDigest,request.decision.decisionDigest);
  assert.equal(row.evidence_digest,canonicalDigest(record));
  record.decisionDigest=D('tampered');
  db.prepare('UPDATE fx_event_result_bindings SET evidence_json=?,evidence_digest=?').run(canonicalJson(record),canonicalDigest(record));
  db.close();
  assert.throws(()=>store.admit(request),error=>error.code==='P9_RUN_ADMISSION_RECORD_DIGEST');
}));


test('superseded cleanup trigger proves the immutable old Run and its mutual replacement',()=>fixture(input=>{
 const store=createRunAdmissionStore({schemaManifest,unitOfWork:input.unitOfWork});
 const first=store.admit({decision:decision(input),commitMarker:'first',resultId:'first'}).result;
 const next=store.admit({decision:replacementDecision(input,first),commitMarker:'next',resultId:'next'}).result;
 const cleanup=require('../../src/helix/domains/libra/persistence/workspace-cleanup-store').createWorkspaceCleanupStore({schemaManifest,unitOfWork:input.unitOfWork});
 const trigger=cleanup.readSuperseded(first.libraRunId);
 assert.equal(trigger.replacementRunId,next.libraRunId);
 assert.equal(trigger.terminalRevision,2);
 const db=new Database(input.databasePath);
 try{db.prepare('UPDATE libra_runs SET supersedes_run_id=NULL WHERE libra_run_id=?').run(next.libraRunId);
 assert.throws(()=>cleanup.readSuperseded(first.libraRunId),{code:'P14_CLEANUP_SUPERSEDED_INVALID'});
 }finally{db.close();}
}));

test('no-Run cancellation rolls back every participant and verifies the committed terminal receipt',()=>fixture(input=>{
 const {createSubjectAbandonStore}=require('../../src/helix/domains/libra/persistence/subject-abandon-store');
 const {createTaskCancellationStore}=require('../../src/helix/domains/libra/persistence/task-cancellation-store');
 const options={schemaManifest,unitOfWork:input.unitOfWork},cancellations=createTaskCancellationStore(options);
 const intent=cancellations.request('subject-1',null,{idempotencyKey:'cancel-subject'}),store=createSubjectAbandonStore(options);
 const crashing={execute(participants){return input.unitOfWork.execute(participants.map(p=>p.participantId!=='commit_foundation'?p:
   {...p,execute(context){p.execute(context);throw new Error('cancel-crash');}}));}};
 const db=new Database(input.databasePath);
 try{
   assert.throws(()=>createSubjectAbandonStore({...options,unitOfWork:crashing}).commit('subject-1',intent),/cancel-crash/);
   assert.equal(db.prepare('SELECT status FROM libra_subjects').get().status,'active');
   assert.equal(db.prepare('SELECT state FROM fx_material_controls').get().state,'controlled');
   for(const table of ['libra_subject_abandon_decisions','libra_subject_abandon_receipts','fx_command_receipts','fx_outbox','fx_audit_records'])
     assert.equal(db.prepare('SELECT count(*) n FROM '+table).get().n,0,table);
   assert.equal(cancellations.get('subject-1').state,'pending');
   assert.equal(store.commit('subject-1',intent).resultKind,'abandoned');
   assert.ok(createSubjectAbandonStore(options).completed('subject-1'));
   cancellations.complete('subject-1');assert.equal(cancellations.get('subject-1').state,'completed');
   db.prepare("UPDATE fx_commit_markers SET commit_digest=? WHERE scope_type='subject'").run(D('corrupt-marker'));
   assert.throws(()=>store.completed('subject-1'),{code:'LIBRA_SUBJECT_ABANDON_CORRUPT'});
 }finally{db.close();}
}));

for(const administrative of [false,true])test((administrative?'administratively retired':'superseded')+' Workspace cleanup admits atomically and preserves terminal history',()=>fixture(input=>{
 const {buildReferenceSnapshot,referenceSetDigest,workspaceStateDigest}=require('../../src/helix/domains/libra/model/workspace-material-reference-contracts');
 const {createWorkspaceCleanupStore}=require('../../src/helix/domains/libra/persistence/workspace-cleanup-store');
 const {buildSupersededAdmission,buildAdministrativeAdmission,buildObservation,CYCLE_MS}=require('../../src/helix/domains/libra/model/workspace-cleanup-contracts');
 const store=createRunAdmissionStore({schemaManifest,unitOfWork:input.unitOfWork});
 const first=store.admit({decision:decision(input),commitMarker:'first',resultId:'first'}).result;
 const next=administrative?null:store.admit({decision:replacementDecision(input,first),commitMarker:'next',resultId:'next'}).result;
 const workspaceId=D('old-workspace'),identity={...input.identity,inode:'99',contentFingerprint:D('workspace-output')};
 const materialKey=canonicalDigest({schema:'physical-material-identity@2',...identity});
 const handle={schemaRef:'helix://contracts/types/WorkspaceMaterialHandle/v1',schemaVersion:1,handleId:D('output-handle'),
   workspaceId,ownerDomain:'libra',processId:first.libraRunId,endpointId:'endpoint-1',materialKey,physicalIdentity:identity,
   rootHandleRef:'root-1',relativePath:'output.mkv',digestAlgorithm:'middle-256k-sha256',digestHex:identity.contentFingerprint,
   sizeBytes:100,referenceRevision:1,accessScope:'workspace_material_read',fenceDigest:D('output-fence')};
 const ref=buildReferenceSnapshot({workspaceId,libraRunId:first.libraRunId,workspaceMaterialHandle:handle,referenceRevision:1,committedWorkspaceRevision:1,previousReferenceRevision:null,
   state:'working',episodeClaims:[],episodeScopeDigest:canonicalDigest({schema:'libra.production-episode-scope@1',items:[]}),productVerificationRef:null});
 const setDigest=referenceSetDigest(workspaceId,[ref]),state={workspaceId,workspaceRevision:1,state:'active',workspaceMaterialReferenceSetDigest:setDigest,
   transitionKind:'admitted',transitionEvidenceDigest:D('workspace-admission')};
 const db=new Database(input.databasePath);db.pragma('foreign_keys=OFF');
 try{
   db.prepare('INSERT INTO libra_workspaces (workspace_id,libra_run_id,current_revision,state,state_digest) VALUES (?,?,1,?,?)')
     .run(workspaceId,first.libraRunId,'active',workspaceStateDigest(state));
   db.prepare('INSERT INTO libra_workspace_revisions (workspace_id,workspace_revision,state,material_reference_set_digest,transition_kind,transition_evidence_digest,revision_digest,committed_at_ms) VALUES (?,1,?,?,?,?,?,1)')
     .run(workspaceId,'active',setDigest,'admitted',state.transitionEvidenceDigest,D('revision'));
   db.prepare('INSERT INTO libra_workspace_material_refs (workspace_id,libra_run_id,reference_id,material_handle_id,material_key,workspace_handle_schema_ref,workspace_handle_json,workspace_handle_digest,reference_revision,reference_state,episode_claims_schema_ref,episode_claims_json,episode_scope_digest,committed_workspace_revision,reference_digest) VALUES (?,?,?,?,?,?,?,?,1,?,?,?,?,1,?)')
     .run(workspaceId,first.libraRunId,ref.referenceId,handle.handleId,materialKey,handle.schemaRef,canonicalJson(handle),canonicalDigest(handle),
       'working','ProductionEpisodeClaims@1','[]',ref.episodeScopeDigest,ref.referenceDigest);
   if(administrative){
     const retirement=require('../../src/helix/domains/libra/persistence/formation-retirement-store').createFormationRetirementStore({schemaManifest,unitOfWork:input.unitOfWork});
     retirement.commit({retirementId:'reset-cleanup',subjectId:'subject-1',expectedSnapshotDigest:retirement.inspect('subject-1').snapshotDigest,
       backupDigest:D('backup'),manifestDigest:D('manifest'),retiringRunIds:[first.libraRunId],
       expectedControls:db.prepare("SELECT * FROM fx_material_controls WHERE owner_domain='libra' AND owner_scope_type='subject' AND owner_scope_id='subject-1' AND state='controlled'").all()});
   }
   const cleanup=createWorkspaceCleanupStore({schemaManifest,unitOfWork:input.unitOfWork}),snapshot=cleanup.inspect(first.libraRunId),
     observation=at=>buildObservation({workspaceId,observedAtMs:at,otherReferences:[],controls:snapshot.controls}),
     command=(administrative?buildAdministrativeAdmission:buildSupersededAdmission)({triggerSnapshot:administrative?cleanup.readAdministrative(first.libraRunId):cleanup.readSuperseded(first.libraRunId),libraRunRef:snapshot.run,workspaceRef:Object.fromEntries(Object.entries(snapshot.workspace).filter(([key])=>key!=='state')),
       references:snapshot.references,controls:snapshot.controls,observation1:observation(100),observation2:observation(100+CYCLE_MS)}),
     request={decision:command,commitMarker:'cleanup-marker',resultId:'cleanup-result'};
   db.prepare("INSERT INTO fx_supporting_works (work_id,owner_domain,process_type,process_id,state) VALUES ('old-work','libra','libra_run',?,'running')").run(first.libraRunId);
   assert.throws(()=>cleanup.admit(request),{code:'P14_CLEANUP_EXECUTION_PENDING'});
   db.prepare("UPDATE fx_supporting_works SET state='failed' WHERE work_id='old-work'").run();
   db.prepare("INSERT INTO fx_workflow_events (event_id,work_id) VALUES ('old-event','old-work')").run();
   db.prepare("INSERT INTO fx_event_attempts (event_attempt_id,event_id) VALUES ('old-attempt','old-event')").run();
   db.prepare("INSERT INTO fx_effect_journal (effect_id,event_attempt_id,state) VALUES ('old-effect','old-attempt','reconcile_required')").run();
   assert.throws(()=>cleanup.admit(request),{code:'P14_CLEANUP_EXECUTION_PENDING'});
   db.prepare("UPDATE fx_effect_journal SET state='failed' WHERE effect_id='old-effect'").run();
   assert.equal(db.prepare('SELECT count(*) n FROM libra_workspace_cleanup_scopes').get().n,0);
   const crashing={execute(participants){return input.unitOfWork.execute(participants.map(p=>p.participantId!=='cleanup_admission_foundation'?p:
     {...p,execute(context){p.execute(context);throw new Error('cleanup-crash');}}));}};
   assert.throws(()=>createWorkspaceCleanupStore({schemaManifest,unitOfWork:crashing}).admit(request),/cleanup-crash/);
   assert.equal(db.prepare('SELECT count(*) n FROM libra_workspace_cleanup_scopes').get().n,0);
   assert.equal(db.prepare('SELECT current_revision FROM libra_workspaces').get().current_revision,1);
   const admitted=cleanup.admit(request);assert.equal(admitted.replayed,false);
   assert.equal(createWorkspaceCleanupStore({schemaManifest,unitOfWork:input.unitOfWork}).admit(request).replayed,true);
   assert.equal(db.prepare('SELECT state FROM libra_runs WHERE libra_run_id=?').get(administrative?first.libraRunId:next.libraRunId).state,administrative?'administratively_retired':'active');
   assert.equal(db.prepare('SELECT owner_scope_id FROM fx_material_controls WHERE material_key=?').get(input.materialKey).owner_scope_id,administrative?null:'subject-1');
   assert.equal(db.prepare('SELECT trigger_kind FROM libra_workspace_cleanup_scopes').get().trigger_kind,administrative?'run_administratively_retired':'run_superseded');
 }finally{db.close();}
}));
