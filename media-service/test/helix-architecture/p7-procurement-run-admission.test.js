'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const { materialKey } = require('../../src/helix/foundation/persistence/material-control');
const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const { activeTriageRule, createDefaultTriageRuleRegistry, ruleDigestFor, authorityDigestFor } = require('../../src/helix/domains/procurement/model/procurement-run-contracts');
const { emptySelectionSnapshot, failedRunMaterialDigest, memberPreconditionDigest } = require('../../src/helix/domains/procurement/model/procurement-retry-contracts');
const { createProcurementRunAdmissionStore } = require('../../src/helix/domains/procurement/persistence/procurement-run-admission-store');
const { createProcurementRetryIntentStore } = require('../../src/helix/domains/procurement/persistence/procurement-retry-intent-store');
const { createProcurementRetryAdmissionStore } = require('../../src/helix/domains/procurement/persistence/procurement-retry-admission-store');
const { createProcurementRunSealStore } = require('../../src/helix/domains/procurement/persistence/procurement-run-seal-store');
const { createSingleScopeSelection } = require('./helpers/procurement-selection-fixture');
const { createSynchronousDomainWork } = require('../../src/helix/foundation/execution/synchronous-domain-work');
const { createFailedPreparationRetryAdminService } = require('../../src/helix/domains/procurement/application/failed-preparation-retry-admin-service');
const { createOutboxDispatcherHost } = require('../../src/helix/foundation/execution/outbox-dispatcher-host');
const { createCatalogPlanProofReader } = require('../../src/helix/foundation/execution/catalog-plan-proof-reader');
const { createStoredPlanContractVerifier } = require('../../src/helix/foundation/execution/stored-plan-contract-verifier');

const generatedRoot = path.resolve(__dirname, '../../src/helix/foundation/persistence/generated');
const schemaDdl = fs.readFileSync(path.join(generatedRoot, 'clean-schema.sql'), 'utf8');
const schemaManifest = JSON.parse(fs.readFileSync(path.join(generatedRoot, 'clean-schema.manifest.json'), 'utf8'));
const D = (value) => canonicalDigest({ value });
const PROFILE_HINT = Object.freeze({
  fieldId:'field-1',
  revision:1,
  contentProfileHint:'mixed',
  hintDigest:canonicalDigest({
    schema:'procurement.material-field-profile-hint@1',
    fieldId:'field-1',
    revision:1,
    contentProfileHint:'mixed',
  }),
});
function identity() { const value={ schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v2', schemaVersion:2,
  mountScopeId:'mount-1', inode:'42', sizeBytes:100, fingerprintAlgorithm:'middle-256k-sha256', fingerprintVersion:1,
  contentFingerprint:D('content') }; return { ...value, materialKey:materialKey(value) }; }
function controlSnapshot(material) { const evidence={schema:'foundation.material-control-evidence@1',materialKey:material.materialKey,
  resultKind:'available',controlRevision:0,controlState:'uncontrolled'}; const value={materialKey:material.materialKey,resultKind:'available',
  controlRevision:0,controlState:'uncontrolled',regionProjection:'uncontrolled',evidenceDigest:canonicalDigest(evidence)};
  return {...value,projectionDigest:canonicalDigest(value)}; }
function controlledSnapshot(material) { const evidence={schema:'foundation.material-control-evidence@1',materialKey:material.materialKey,
  resultKind:'available',controlRevision:1,controlState:'controlled',ownerDomain:'procurement',ownerScopeType:'material_field',ownerScopeId:'field-1'};
  const value={materialKey:material.materialKey,resultKind:'available',controlRevision:1,controlState:'controlled',ownerDomain:'procurement',
    ownerScopeType:'material_field',ownerScopeId:'field-1',regionProjection:'procurement',evidenceDigest:canonicalDigest(evidence)};
  return {...value,projectionDigest:canonicalDigest(value)}; }
function member(material, control) { const value={ordinal:0,materialKey:material.materialKey,selectionRole:'triage_input',physicalIdentity:material,sizeBytes:100,bindingRevision:1,
  eligibilityRevision:2,eligibilityBasisDigest:D('eligibility'),lastSnapshotDigest:D('snapshot'),lastObservationId:'observation-1',
  endpointId:'endpoint-1',location:'/field/title.mkv',realityDigest:D('reality'),provenanceDigest:D('provenance'),
  controlSnapshot:control,admissionControlAction:control.controlState==='controlled'?'assert_same_field':'acquire'}; return {...value,basisMemberDigest:canonicalDigest(value)}; }
function basis(registry, material, control) { const selected=createSingleScopeSelection({procurementRunId:'run-1',fieldId:'field-1',members:[member(material,control)]});
  const value={procurementRunId:'run-1',fieldId:'field-1',fieldStatus:'active',fieldAccess:{revision:1,digest:D('access')},
    profileHintSnapshot:PROFILE_HINT,terminalObservation:{revision:1,fieldObservationWorkId:'observation-work-1',profileHintSnapshot:PROFILE_HINT},extractionPolicy:{policyId:'policy-1',revision:1,digest:D('policy')},
    triageRule:activeTriageRule(registry),selectedFieldMaterialSet:selected}; return {...value,basisDigest:canonicalDigest(value)}; }
function retryIntent(registry, runBasis, material, expectedControl) {
  const headValue={fieldId:'field-1',fieldStatus:'active',profileHintSnapshot:PROFILE_HINT,fieldAccess:{revision:1,digest:D('access')},
    terminalObservation:{resultKind:'available',revision:1,fieldObservationWorkId:'observation-work-1',profileHintSnapshot:PROFILE_HINT},
    extractionPolicy:{policyId:'policy-1',revision:1,digest:D('policy')},triageRule:activeTriageRule(registry)};
  const retryAdmissionHead={...headValue,headDigest:canonicalDigest(headValue)};
  const item={ordinal:0,materialKey:material.materialKey,failedRunMaterialDigest:failedRunMaterialDigest({failedRunId:'run-1',
    failedRunBasisDigest:runBasis.basisDigest,ordinal:0,materialKey:material.materialKey,
    basisMemberDigest:runBasis.selectedFieldMaterialSet.members[0].basisMemberDigest,terminalEvidenceDigest:D('triage-failure')}),
    expectedBindingRevision:1,expectedEligibilityRevision:2,expectedEligibilityBasisDigest:D('eligibility'),
    expectedSelectionBasisDigest:emptySelectionSnapshot(material.materialKey).selectionBasisDigest,expectedSelectionHasConflict:false,
    expectedControlSnapshot:expectedControl};
  const members=[{...item,memberPreconditionDigest:memberPreconditionDigest(item)}];
  const retryScopeDigest=canonicalDigest({schema:'procurement.retry-scope@1',failedRunId:'run-1',failedRunBasisDigest:runBasis.basisDigest,
    items:members.map(({ordinal,materialKey,failedRunMaterialDigest})=>({ordinal,materialKey,failedRunMaterialDigest}))});
  const preconditionSetDigest=canonicalDigest({schema:'procurement.retry-precondition-set@1',retryAdmissionHeadDigest:retryAdmissionHead.headDigest,
    items:members.map(({ordinal,materialKey,memberPreconditionDigest})=>({ordinal,materialKey,memberPreconditionDigest}))});
  const value={retryIntentId:'retry-intent-1',fieldId:'field-1',failedRunId:'run-1',failedRunBasisDigest:runBasis.basisDigest,
    retryAdmissionHead,members,retryScopeDigest,preconditionSetDigest,actorId:'actor-1',idempotencyKey:'retry-key-1'};
  return {...value,intentDigest:canonicalDigest(value)};
}
function retryRunBasis(registry, material, control) { const rawMember={ordinal:0,materialKey:material.materialKey,selectionRole:'triage_input',physicalIdentity:material,sizeBytes:100,bindingRevision:1,
  eligibilityRevision:2,eligibilityBasisDigest:D('eligibility'),lastSnapshotDigest:D('snapshot'),lastObservationId:'observation-1',endpointId:'endpoint-1',
  location:'/field/title.mkv',realityDigest:D('reality'),provenanceDigest:D('provenance'),controlSnapshot:control,admissionControlAction:'assert_same_field'};
  const selected=createSingleScopeSelection({procurementRunId:'run-2',fieldId:'field-1',members:[{...rawMember,basisMemberDigest:canonicalDigest(rawMember)}]});
  const value={procurementRunId:'run-2',fieldId:'field-1',fieldStatus:'active',profileHintSnapshot:PROFILE_HINT,fieldAccess:{revision:1,digest:D('access')},terminalObservation:{revision:1,fieldObservationWorkId:'observation-work-1',profileHintSnapshot:PROFILE_HINT},extractionPolicy:{policyId:'policy-1',revision:1,digest:D('policy')},triageRule:activeTriageRule(registry),sourceRetryIntentId:'retry-intent-1',selectedFieldMaterialSet:selected};return{...value,basisDigest:canonicalDigest(value)}; }
function handle(runBasis) { const memberValue=runBasis.selectedFieldMaterialSet.members[0]; return {
  schemaRef:'helix://contracts/types/ResponsibilityControlCommitHandle/v1',schemaVersion:1,handleId:'handle-1',operationKind:'acquire',
  ownerDomain:'procurement',processType:'procurement_run',processId:runBasis.procurementRunId,
  basisRef:{objectType:'procurement_run_execution_basis',objectId:runBasis.procurementRunId,revision:1,digest:runBasis.basisDigest},
  basisDigest:runBasis.basisDigest,canonicalFactSetDigest:runBasis.basisDigest,bindingSetDigest:runBasis.selectedFieldMaterialSet.selectionDigest,
  controlScopeDigest:runBasis.selectedFieldMaterialSet.selectionDigest,
  expectedControlRevisions:[{materialKey:memberValue.materialKey,revision:memberValue.controlSnapshot.controlRevision}],
  receiptContract:{receiptSchemaRef:'helix://contracts/types/ProcurementControlReceipt/v1',
    controlRevisionSetSchemaRef:'procurement.control-revision-set@1'},eventFenceDigest:D('fence')}; }
function insertWork(database,{workId,processType,processId,workKind,basisDigest,state}) {
  const definition={schemaRef:'helix://foundation/types/SupportingWorkDefinition/v1',schemaVersion:1,workId,ownerDomain:'procurement',
    processType,processId,workKind,workObjectiveTypeRef:'helix://procurement/work/'+workKind+'/v1',workObjectiveVersion:1,
    executionBasisId:processId+':basis',executionBasisDigest:basisDigest,dependencyRefs:[],priorityClass:'normal',priorityRevision:1,
    capabilityCatalogScope:'procurement',workspaceMaterialScope:[],idempotencyKey:workId,concurrencyScope:processType+'/'+processId+'/'+workKind,
    outputContractRef:'helix://procurement/results/'+workKind+'/v1'};
  const definitionJson=JSON.stringify(definition),definitionDigest=canonicalDigest(definition);
  database.prepare(`INSERT INTO fx_supporting_works
    (work_id,owner_domain,process_type,process_id,work_kind,basis_digest,priority_class,definition_schema_ref,definition_json,
     definition_digest,state,idempotency_key,created_at_ms,updated_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(workId,'procurement',processType,processId,workKind,basisDigest,'normal',definition.schemaRef,definitionJson,
      definitionDigest,state,workId,1,1);
}
function seed(database, material, control) {
  const transaction=database.transaction(()=>{
    database.prepare('INSERT INTO proc_material_fields(field_id,name,status,extraction_policy_id,extraction_policy_revision,current_access_revision,current_profile_hint_revision,current_observation_revision,created_at_ms,updated_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?)').run('field-1','Field','active','policy-1',1,1,1,null,1,1);
    database.prepare('INSERT INTO proc_field_profile_hint_revisions(field_id,revision,content_profile_hint,hint_schema_ref,hint_digest,effective_at_ms,actor_id) VALUES(?,?,?,?,?,?,?)')
      .run('field-1',1,'mixed','helix://contracts/application-types/MaterialFieldProfileHintSnapshot/v1',PROFILE_HINT.hintDigest,1,'fixture');
    database.prepare('INSERT INTO proc_extraction_policy_revisions VALUES(?,?,?,?,?,?)').run('policy-1',1,'helix://contracts/domain-types/ExtractionPolicy/v1','{}',D('policy'),1);
    database.prepare('INSERT INTO proc_field_access_revisions VALUES(?,?,?,?,?,?,?,?,?)').run('field-1',1,'endpoint-1','/field','mount-1',1,'field-access@1',D('access'),1);
    insertWork(database,{workId:'observation-work-1',processType:'field_observation',processId:'field-1',workKind:'observe',basisDigest:D('work'),state:'succeeded'});
    insertWork(database,{workId:'run-work-1',processType:'procurement_run',processId:'run-1',workKind:'admit',basisDigest:D('run-work'),state:'running'});
    database.prepare('INSERT INTO fx_work_attempts VALUES(?,?,?,?,?,?,?,?)').run('run-attempt-1','run-work-1',0,D('attempt'),'running',1,null,null);
    database.prepare('INSERT INTO fx_workflow_plans VALUES(?,?,?,?,?,?,?,?,?)').run('run-plan-1','run-attempt-1','procurement-planner',1,D('catalog'),D('plan-basis'),D('graph'),'planned',1);
    database.prepare('INSERT INTO fx_plan_nodes VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('run-plan-1','admit','procurement.material.control.acquire@1',1,'input@1','{}','parameters@1','{}','when@1','{}','responsibility_control_commit','fence@1','{}','resource@1','{}');
    database.prepare('INSERT INTO fx_plan_nodes VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('run-plan-1','seal','procurement.run.seal@1',1,'input@1','{}','parameters@1','{}','when@1','{}','domain_fact_commit','fence@1','{}','resource@1','{}');
    database.prepare('INSERT INTO fx_plan_nodes VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('run-plan-1','retry-intent','procurement.retry.intent.create@1',1,'input@1','{}','parameters@1','{}','when@1','{}','domain_fact_commit','fence@1','{}','resource@1','{}');
    database.prepare('INSERT INTO fx_plan_nodes VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('run-plan-1','retry-consume','procurement.retry.admit@1',1,'input@1','{}','parameters@1','{}','when@1','{}','domain_fact_commit','fence@1','{}','resource@1','{}');
    database.prepare('INSERT INTO fx_workflow_events VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('run-event-1','run-plan-1','admit','run-work-1','run-attempt-1','procurement','procurement.material.control.acquire@1',1,'executing','normal',1,null,null,null);
    database.prepare('INSERT INTO fx_workflow_events VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('seal-event-1','run-plan-1','seal','run-work-1','run-attempt-1','procurement','procurement.run.seal@1',1,'ready','normal',1,null,null,null);
    database.prepare('INSERT INTO fx_workflow_events VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('retry-event-1','run-plan-1','retry-intent','run-work-1','run-attempt-1','procurement','procurement.retry.intent.create@1',1,'ready','normal',1,null,null,null);
    database.prepare('INSERT INTO fx_workflow_events VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('retry-consume-event-1','run-plan-1','retry-consume','run-work-1','run-attempt-1','procurement','procurement.retry.admit@1',1,'ready','normal',1,null,null,null);
    database.prepare('INSERT INTO fx_commit_markers(commit_marker,owner_domain,scope_type,scope_id,commit_digest,committed_at_ms) VALUES(?,?,?,?,?,?)').run('observation-marker','procurement','material_field_observation','field-1',D('observation-marker'),1);
    database.prepare('INSERT INTO proc_field_observations(field_id,revision,observation_id,field_observation_work_id,access_revision,content_profile_hint,profile_hint_revision,profile_hint_digest,page_ordinal,expected_revision,cursor_in,cursor_out,page_digest,fact_digest,commit_marker,result_digest,observed_at_ms,completed) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run('field-1',1,'observation-1','observation-work-1',1,'mixed',1,PROFILE_HINT.hintDigest,0,0,null,null,D('page'),D('fact'),'observation-marker',D('result'),1,1);
    database.prepare('UPDATE proc_material_fields SET current_observation_revision=1 WHERE field_id=?').run('field-1');
    database.prepare(`INSERT INTO proc_field_materials VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'field-1',material.materialKey,material.mountScopeId,material.inode,material.fingerprintAlgorithm,material.fingerprintVersion,material.contentFingerprint,'endpoint-1',1,1,100,1,1,1,
      '/field/title.mkv',1,D('reality'),D('provenance'),D('snapshot'),'observation-1',2,'eligible','eligible',D('eligibility'),'active',1,1,
      D('selection'),control.regionProjection,control.controlRevision > 0 ? control.controlRevision : null,control.projectionDigest,1);
  });
  try { transaction(); } catch (error) { throw new Error(`seed failed: ${error.message || error.code}`, { cause:error }); }
}
function fixture(run) { const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-run-admission-')); const databasePath=path.join(root,'shelfdeck.db');
  let now=100; const kernel=openSqliteKernel({Database,databasePath,schemaDdl,schemaManifest,now:()=>now++});
  try{return run({databasePath,kernel,unitOfWork:createSqliteUnitOfWork({kernel})});}finally{kernel.close();try{fs.rmSync(root,{recursive:true,force:true});}catch{}} }

function failedRetryFixture(context, count) {
  const registry=createDefaultTriageRuleRegistry(),database=new Database(context.databasePath);
  const materials=Array.from({length:count},(_,index)=>{
    const {materialKey:_key,...value}=identity();value.inode=String(100+index);value.contentFingerprint=D('large-'+index);
    return {...value,materialKey:materialKey(value)};
  }).sort((a,b)=>a.materialKey.localeCompare(b.materialKey));
  seed(database,materials[0],controlSnapshot(materials[0]));
  const template=database.prepare('SELECT * FROM proc_field_materials').get(),columns=Object.keys(template);
  const insert=database.prepare(`INSERT INTO proc_field_materials(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`);
  database.transaction(()=>{
    for(const m of materials.slice(1)) {
      const projection=controlSnapshot(m),row={...template,material_key:m.materialKey,inode:m.inode,content_fingerprint:m.contentFingerprint,
        current_location:'/field/'+m.inode+'.mkv',control_projection_digest:projection.projectionDigest};
      insert.run(...columns.map(key=>row[key]));
    }
    database.prepare('UPDATE proc_field_materials SET current_location=? WHERE material_key=?').run('/field/'+materials[0].inode+'.mkv',materials[0].materialKey);
  })();
  const members=materials.map(m=>({...member(m,controlSnapshot(m)),location:'/field/'+m.inode+'.mkv',fieldRelativeLocation:m.inode+'.mkv'}));
  const selected=createSingleScopeSelection({procurementRunId:'run-1',fieldId:'field-1',members});
  const {basisDigest:_basis,...initial}=basis(registry,materials[0],controlSnapshot(materials[0]));
  const value={...initial,selectedFieldMaterialSet:selected},runBasis={...value,basisDigest:canonicalDigest(value)};
  const controlHandle={...handle(runBasis),expectedControlRevisions:materials.map(m=>({materialKey:m.materialKey,revision:0}))};
  const options={schemaManifest,unitOfWork:context.unitOfWork,triageRegistry:registry};
  createProcurementRunAdmissionStore(options).admit({basis:runBasis,controlHandle,
    commitMarker:{commitMarker:'run-marker-1',commitDigest:D('run-commit')},resultBinding:{resultId:'run-receipt-1',eventId:'run-event-1'}});
  const raw={decisionId:'seal-decision-1',procurementRunId:'run-1',expectedStateRevision:1,expectedRunBasisDigest:runBasis.basisDigest,
    sealOutcome:'failed',publishedCandidates:[],releasedMembers:materials.map(m=>({materialKey:m.materialKey,disposition:'triage_failed',evidenceDigest:D('failure-'+m.materialKey)}))};
  createProcurementRunSealStore(options).seal({decision:{...raw,decisionDigest:canonicalDigest(raw)},
    commitMarker:{commitMarker:'seal-marker-1',commitDigest:D('seal-commit')},resultBinding:{resultId:'seal-receipt-1',eventId:'seal-event-1'}});
  const request={fieldId:'field-1',idempotencyKey:'large-retry',failedProcurementRunId:'run-1',expectedFailedRunStateRevision:2,
    expectedFailedRunBasisDigest:runBasis.basisDigest,actorId:'test'};
  const service=overrides=>createFailedPreparationRetryAdminService({...options,workRuntime:createSynchronousDomainWork(options),...overrides});
  return {database,options,request,service};
}

for(const count of [1,574,601,1024]) test('bounded Retry Plan admits and replays '+count+' failed members',()=>fixture(context=>{
  const f=failedRetryFixture(context,count);
  try {
    const before=f.database.prepare("SELECT * FROM proc_run_materials WHERE procurement_run_id='run-1' ORDER BY material_key").all();
    const controlBefore=f.database.prepare('SELECT * FROM fx_material_control_revisions ORDER BY material_key,revision').all();
    const result=f.service().retry(f.request);
    assert.equal(result.retryAdmissionResult.resultKind,'created');
    const proofReader = createCatalogPlanProofReader(f.options), reasons = [];
    const planFacts = proofReader.verify(reader => reader.read(result.workId + ':plan:1'));
    assert.equal(createStoredPlanContractVerifier({ proofReader, onRejected: reason => reasons.push(reason) }).verify(planFacts),
      true, reasons.join('\n'));
    assert.deepEqual(f.service().retry(f.request).retryAdmissionResult,result.retryAdmissionResult);
    const sizes=f.database.prepare("SELECT length(CAST(input_bindings_json AS BLOB)) bytes FROM fx_plan_nodes WHERE plan_id LIKE 'failed-preparation-retry-%'").all();
    assert.equal(sizes.length,2);assert(sizes.every(row=>row.bytes<16384));
    assert.equal(f.database.prepare('SELECT COUNT(*) n FROM proc_procurement_retry_intents').get().n,1);
    assert.equal(f.database.prepare('SELECT COUNT(*) n FROM proc_procurement_retry_intent_materials').get().n,count);
    assert.equal(f.database.prepare('SELECT COUNT(*) n FROM proc_procurement_runs').get().n,2);
    assert.equal(f.database.prepare("SELECT COUNT(*) n FROM proc_run_materials WHERE procurement_run_id<>'run-1'").get().n,count);
    assert.equal(f.database.prepare("SELECT COUNT(*) n FROM fx_outbox WHERE message_kind='procurement_retry_intent_available'").get().n,1);
    assert.deepEqual(f.database.prepare("SELECT * FROM proc_run_materials WHERE procurement_run_id='run-1' ORDER BY material_key").all(),before);
    assert.deepEqual(f.database.prepare('SELECT * FROM fx_material_control_revisions ORDER BY material_key,revision').all(),controlBefore);
    assert.equal(f.database.prepare('PRAGMA foreign_key_check').all().length,0);
  } finally {f.database.close();}
}));

for(const boundary of ['before_plan','after_plan','before_intent','after_intent','after_admission','before_work_complete'])
  test('Retry command resumes exact durable facts after '+boundary,()=>fixture(context=>{
    const f=failedRetryFixture(context,3),crash=()=>{throw new Error('injected '+boundary);};
    try {
      const overrides={},runtime=createSynchronousDomainWork(f.options);
      if(boundary==='before_plan') overrides.workRuntime={...runtime,activate:crash};
      if(boundary==='after_plan') overrides.workRuntime={...runtime,activate(request){runtime.activate(request);crash();}};
      if(boundary==='before_work_complete') overrides.workRuntime={...runtime,complete:crash};
      if(boundary.includes('intent')) {
        const store=createProcurementRetryIntentStore(f.options);
        overrides.retryIntentStore={create(request){if(boundary==='after_intent')store.create(request);crash();}};
      }
      if(boundary==='after_admission') {
        const store=createProcurementRetryAdmissionStore(f.options);
        overrides.retryAdmissionStore={...store,consume(request){store.consume(request);crash();}};
      }
      assert.throws(()=>f.service(overrides).retry(f.request),/injected/);
      const result=f.service().retry(f.request);
      assert.equal(result.retryAdmissionResult.resultKind,'created');
      assert.equal(f.service().retry(f.request).replayed,true);
      assert.equal(f.database.prepare('SELECT count(*) n FROM proc_procurement_retry_intents').get().n,1);
      assert.equal(f.database.prepare('SELECT count(*) n FROM proc_procurement_runs').get().n,2);
      assert.equal(f.database.prepare("SELECT count(*) n FROM fx_outbox WHERE message_kind='procurement_retry_intent_available'").get().n,1);
      assert.equal(f.database.prepare("SELECT state FROM fx_supporting_works WHERE work_id=?").get(result.workId).state,'succeeded');
      assert.equal(f.database.prepare('PRAGMA foreign_key_check').all().length,0);
    } finally {f.database.close();}
  }));

test('Retry admission repeats the full CAS after proposal preparation',()=>fixture(context=>{
  const f=failedRetryFixture(context,3);
  try {
    const store=createProcurementRetryAdmissionStore(f.options);
    const result=f.service({retryAdmissionStore:{...store,prepare(request){
      const prepared=store.prepare(request);
      f.database.prepare("UPDATE proc_material_fields SET status='deregistered' WHERE field_id='field-1'").run();
      return prepared;
    }}}).retry(f.request);
    assert.equal(result.retryAdmissionResult.resultKind,'stale');
    assert.equal(result.retryAdmissionResult.staleMaterialCount,3);
    assert.equal(f.database.prepare('SELECT COUNT(*) n FROM proc_procurement_runs').get().n,1);
    assert.deepEqual(f.service().retry(f.request).retryAdmissionResult,result.retryAdmissionResult);
  } finally {f.database.close();}
}));

test('stored Retry Intent preserves its immutable rule while a changed active rule produces stale',()=>fixture(context=>{
  const f=failedRetryFixture(context,2),store=createProcurementRetryIntentStore(f.options);
  try {
    assert.throws(()=>f.service({retryIntentStore:{create(request){store.create(request);throw new Error('committed');}}}).retry(f.request),/committed/);
    const original=f.options.triageRegistry,{registryDigest:_digest,...old}=original;
    const active=original.entries.find(entry=>entry.ruleRef===original.activeRuleRef&&entry.revision===original.activeRuleRevision);
    const next={...active,revision:original.activeRuleRevision+1};next.ruleDigest=ruleDigestFor(next);next.authorityDigest=authorityDigestFor(next);
    const registry={...old,activeRuleRevision:next.revision,entries:[...old.entries,next]};registry.registryDigest=canonicalDigest(registry);
    const result=f.service({triageRegistry:registry}).retry(f.request);
    assert.equal(result.retryAdmissionResult.resultKind,'stale');
    assert.deepEqual(result.retryAdmissionResult.staleReasonCodes,['triage_rule_changed']);
    assert.equal(f.database.prepare('SELECT COUNT(*) n FROM proc_procurement_runs').get().n,1);
  } finally {f.database.close();}
}));

for(const [name,sql,code] of [
  ['member digest',"UPDATE proc_procurement_retry_intent_materials SET member_precondition_digest='"+'f'.repeat(64)+"'",'P7_RETRY_MEMBER_INVALID'],
  ['missing member','DELETE FROM proc_procurement_retry_intent_materials WHERE ordinal=1','P7_RETRY_ADMISSION_MEMBER_CORRUPT'],
  ['receipt digest',"UPDATE proc_procurement_retry_intents SET create_result_digest='"+'f'.repeat(64)+"'",'FAILED_PREPARATION_RETRY_INTENT_RECEIPT_CORRUPT'],
]) test('Retry recovery rejects corrupt '+name+' without creating a Run',()=>fixture(context=>{
  const f=failedRetryFixture(context,2),store=createProcurementRetryIntentStore(f.options);
  try {
    assert.throws(()=>f.service({retryIntentStore:{create(request){store.create(request);throw new Error('committed');}}}).retry(f.request),/committed/);
    f.database.prepare(sql).run();
    assert.throws(()=>f.service().retry(f.request),error=>error.code===code);
    assert.equal(f.database.prepare('SELECT COUNT(*) n FROM proc_procurement_runs').get().n,1);
  } finally {f.database.close();}
}));

test('published Retry refs reject changed Owner facts before Intent commit',()=>fixture(context=>{
  const f=failedRetryFixture(context,3),runtime=createSynchronousDomainWork(f.options);
  try {
    assert.throws(()=>f.service({workRuntime:{...runtime,activate(request){runtime.activate(request);throw new Error('after plan');}}}).retry(f.request),/after plan/);
    f.database.prepare('UPDATE proc_field_materials SET binding_revision=binding_revision+1').run();
    assert.throws(()=>f.service().retry(f.request),error=>error.code==='FAILED_PREPARATION_RETRY_FROZEN_BASIS_DRIFT');
    assert.equal(f.database.prepare('SELECT COUNT(*) n FROM proc_procurement_retry_intents').get().n,0);
    assert.equal(f.database.prepare('SELECT COUNT(*) n FROM proc_procurement_runs').get().n,1);
  } finally {f.database.close();}
}));

test('Retry refs reject malformed and substituted command scopes',()=>fixture(context=>{
  const f=failedRetryFixture(context,1),runtime=createSynchronousDomainWork(f.options);
  try {
    const result=f.service().retry(f.request),snapshot=runtime.snapshot(result.workId);
    for(const mutate of [r=>r.request.fieldId='foreign-field',r=>r.retryScopeDigest='invalid',r=>r.extra='unbounded',
      r=>r.request.idempotencyKey='x'.repeat(257)]) {
      const pages=structuredClone(snapshot.pages);mutate(pages[0].bindings[0].parameters);
      assert.throws(()=>f.service({workRuntime:{...runtime,snapshot:()=>({...snapshot,pages})}}).retry(f.request),
        error=>error.code==='FAILED_PREPARATION_RETRY_PLAN_REFERENCE_INVALID');
    }
    assert.throws(()=>f.service().retry({...f.request,actorId:'different'}),
      error=>error.code==='FAILED_PREPARATION_RETRY_IDEMPOTENCY_CONFLICT');
  } finally {f.database.close();}
}));

test('real dispatcher resumes a committed Retry Intent after SQLite process dependencies restart',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-large-retry-restart-')),databasePath=path.join(root,'shelfdeck.db');
  let kernel=openSqliteKernel({Database,databasePath,schemaDdl,schemaManifest}),database;
  t.after(()=>{database?.close();kernel.close();fs.rmSync(root,{recursive:true,force:true});});
  const f=failedRetryFixture({databasePath,unitOfWork:createSqliteUnitOfWork({kernel})},5);
  database=f.database;
  const intentStore=createProcurementRetryIntentStore(f.options);
  assert.throws(()=>f.service({retryIntentStore:{create(request){intentStore.create(request);throw new Error('process stopped');}}}).retry(f.request),/process stopped/);
  database.close();database=null;kernel.close();
  kernel=openSqliteKernel({Database,databasePath,schemaDdl,schemaManifest});
  const options={...f.options,unitOfWork:createSqliteUnitOfWork({kernel})};
  const service=createFailedPreparationRetryAdminService({...options,workRuntime:createSynchronousDomainWork(options)});
  let wakes=0;
  const dispatcher=createOutboxDispatcherHost({...options,failedPreparationRetryService:service,executionRuntimeHost:{wake(){wakes++;}},onError(error){throw error;}});
  assert.deepEqual(await dispatcher.recoverCommittedRetryIntents(),{kind:'advanced',delivered:1});
  assert.deepEqual(await dispatcher.recoverCommittedRetryIntents(),{kind:'idle',delivered:0});
  database=new Database(databasePath);
  assert.equal(database.prepare('SELECT state FROM proc_procurement_retry_intents').get().state,'consumed');
  assert.equal(database.prepare("SELECT state FROM fx_outbox WHERE message_kind='procurement_retry_intent_available'").get().state,'fully_acked');
  assert.equal(database.prepare('SELECT count(*) n FROM fx_inbox').get().n,1);
  assert.equal(database.prepare('SELECT count(*) n FROM proc_procurement_runs').get().n,2);
  assert.equal(wakes,1);
  assert.equal(service.retry(f.request).replayed,true);
});

test('admits complete Run Basis, Selection, Control, receipt, and marker in one transaction and replays it',()=>fixture(({databasePath,unitOfWork})=>{
  const registry=createDefaultTriageRuleRegistry(); const material=identity(); const control=controlSnapshot(material); const runBasis=basis(registry,material,control);
  const database=new Database(databasePath); seed(database,material,control); database.close();
  const store=createProcurementRunAdmissionStore({schemaManifest,unitOfWork,triageRegistry:registry}); const request={basis:runBasis,controlHandle:handle(runBasis),
    commitMarker:{commitMarker:'run-marker-1',commitDigest:D('run-commit')},resultBinding:{resultId:'run-receipt-1',eventId:'run-event-1'},priorityClass:'normal'};
  const committed=store.admit(request); assert.equal(committed.replayed,false); assert.equal(committed.typedResult.acquiredMaterialCount,1);
  const replay=store.admit(request); assert.equal(replay.replayed,true); assert.deepEqual(replay.typedResult,committed.typedResult);
  const check=new Database(databasePath,{readonly:true}); assert.equal(check.prepare('SELECT COUNT(*) count FROM proc_procurement_runs').get().count,1);
  assert.equal(Number(check.prepare('SELECT candidate_package_revision_head FROM proc_procurement_runs').get().candidate_package_revision_head),0);
  assert.equal(check.prepare('SELECT COUNT(*) count FROM proc_run_materials').get().count,1);
  assert.equal(check.prepare('SELECT control_revision FROM fx_material_controls').get().control_revision,1);
  assert.equal(check.prepare("SELECT COUNT(*) count FROM fx_outbox").get().count,0); check.close();
}));

test('Reset barrier rejects retained observation admission without acquiring Control or producing a Run',()=>fixture(({databasePath,unitOfWork})=>{
  const registry=createDefaultTriageRuleRegistry(), material=identity(), control=controlSnapshot(material), runBasis=basis(registry,material,control);
  const database=new Database(databasePath);
  try {
    seed(database,material,control);
    database.prepare('INSERT INTO proc_field_reset_barriers VALUES(?,?,?,?)').run('field-1','a'.repeat(64),runBasis.terminalObservation.revision,1);
    const protectedTables = ['proc_procurement_runs','fx_material_controls','fx_commit_markers'];
    const before = protectedTables.map(table => database.prepare('SELECT * FROM '+table).all());
    const store=createProcurementRunAdmissionStore({schemaManifest,unitOfWork,triageRegistry:registry});
    const request={basis:runBasis,controlHandle:handle(runBasis),commitMarker:{commitMarker:'run-marker-1',commitDigest:D('run-commit')}};
    assert.throws(()=>store.admit(request),{code:'P7_RUN_ADMISSION_RESET_BARRIER'});
    // Even a larger revision cannot make a previous generation's Work fresh.
    database.exec('UPDATE proc_field_reset_barriers SET minimum_observation_revision=0');
    assert.throws(()=>store.admit(request),{code:'P7_RUN_ADMISSION_RESET_BARRIER'});
    protectedTables.forEach((table, index) => assert.deepEqual(database.prepare('SELECT * FROM '+table).all(),before[index]));
  } finally {database.close();}
}));

test('stale Field head rolls back Run, Control, Result, and marker together',()=>fixture(({databasePath,unitOfWork})=>{
  const registry=createDefaultTriageRuleRegistry(); const material=identity(); const control=controlSnapshot(material); const runBasis=basis(registry,material,control);
  const database=new Database(databasePath); seed(database,material,control); database.prepare("UPDATE proc_material_fields SET status='deregistered'").run(); database.close();
  const store=createProcurementRunAdmissionStore({schemaManifest,unitOfWork,triageRegistry:registry});
  assert.throws(()=>store.admit({basis:runBasis,controlHandle:handle(runBasis),commitMarker:{commitMarker:'run-marker-1',commitDigest:D('run-commit')},
    resultBinding:{resultId:'run-receipt-1',eventId:'run-event-1'}}),(error)=>error.code==='P7_RUN_ADMISSION_HEAD_STALE');
  const check=new Database(databasePath,{readonly:true}); assert.equal(check.prepare('SELECT COUNT(*) count FROM proc_procurement_runs').get().count,0);
  assert.equal(check.prepare('SELECT COUNT(*) count FROM fx_material_controls').get().count,0);
  assert.equal(check.prepare("SELECT COUNT(*) count FROM fx_commit_markers WHERE commit_marker='run-marker-1'").get().count,0); check.close();
}));

test('Profile Hint revision change makes the frozen terminal Observation stale for Run admission',()=>fixture(({databasePath,unitOfWork})=>{
  const registry=createDefaultTriageRuleRegistry(); const material=identity(); const control=controlSnapshot(material); const runBasis=basis(registry,material,control);
  const database=new Database(databasePath); seed(database,material,control);
  const westernHint={fieldId:'field-1',revision:2,contentProfileHint:'western_adult'};
  westernHint.hintDigest=canonicalDigest({schema:'procurement.material-field-profile-hint@1',...westernHint});
  database.prepare('INSERT INTO proc_field_profile_hint_revisions(field_id,revision,content_profile_hint,hint_schema_ref,hint_digest,effective_at_ms,actor_id) VALUES(?,?,?,?,?,?,?)')
    .run('field-1',2,'western_adult','helix://contracts/application-types/MaterialFieldProfileHintSnapshot/v1',westernHint.hintDigest,2,'fixture');
  database.prepare('UPDATE proc_material_fields SET current_profile_hint_revision=2 WHERE field_id=?').run('field-1');
  database.close();
  const store=createProcurementRunAdmissionStore({schemaManifest,unitOfWork,triageRegistry:registry});
  assert.throws(()=>store.admit({basis:runBasis,controlHandle:handle(runBasis),commitMarker:{commitMarker:'run-marker-profile-stale',commitDigest:D('run-profile-stale')},
    resultBinding:{resultId:'run-receipt-profile-stale',eventId:'run-event-1'}}),(error)=>error.code==='P7_RUN_ADMISSION_HEAD_STALE');
  const check=new Database(databasePath,{readonly:true});
  assert.equal(check.prepare('SELECT COUNT(*) count FROM proc_procurement_runs').get().count,0);
  assert.equal(check.prepare('SELECT COUNT(*) count FROM fx_material_controls').get().count,0);
  assert.equal(check.prepare("SELECT COUNT(*) count FROM fx_commit_markers WHERE commit_marker='run-marker-profile-stale'").get().count,0);
  check.close();
}));

test('same-Field Control is asserted without a fake release/acquire revision',()=>fixture(({databasePath,unitOfWork})=>{
  const registry=createDefaultTriageRuleRegistry(); const material=identity(); const control=controlledSnapshot(material); const runBasis=basis(registry,material,control);
  const database=new Database(databasePath); seed(database,material,control);
  database.prepare(`INSERT INTO fx_material_controls VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(material.materialKey,material.mountScopeId,material.inode,
    material.sizeBytes,material.fingerprintAlgorithm,material.fingerprintVersion,material.contentFingerprint,
    'procurement','material_field','field-1',1,'controlled',1);
  database.prepare(`INSERT INTO fx_material_control_revisions VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(material.materialKey,1,'acquire',null,null,null,
    'procurement','material_field','field-1',D('initial-control'),'observation-marker',1); database.close();
  const store=createProcurementRunAdmissionStore({schemaManifest,unitOfWork,triageRegistry:registry}); const committed=store.admit({basis:runBasis,
    controlHandle:handle(runBasis),commitMarker:{commitMarker:'run-marker-assert',commitDigest:D('run-assert')},
    resultBinding:{resultId:'run-receipt-assert',eventId:'run-event-1'}});
  assert.equal(committed.typedResult.assertedMaterialCount,1); assert.equal(committed.typedResult.acquiredMaterialCount,0);
  const check=new Database(databasePath,{readonly:true}); assert.equal(check.prepare('SELECT control_revision FROM fx_material_controls').get().control_revision,1);
  assert.equal(check.prepare('SELECT COUNT(*) count FROM fx_material_control_revisions').get().count,1); check.close();
}));

test('failed Run Seal releases Selection but preserves exact Procurement Control and replays its receipt',()=>fixture(({databasePath,unitOfWork})=>{
  const registry=createDefaultTriageRuleRegistry();const material=identity();const control=controlSnapshot(material);const runBasis=basis(registry,material,control);
  const database=new Database(databasePath);seed(database,material,control);database.close();
  createProcurementRunAdmissionStore({schemaManifest,unitOfWork,triageRegistry:registry}).admit({basis:runBasis,controlHandle:handle(runBasis),
    commitMarker:{commitMarker:'run-marker-1',commitDigest:D('run-commit')},resultBinding:{resultId:'run-receipt-1',eventId:'run-event-1'}});
  const raw={decisionId:'seal-decision-1',procurementRunId:'run-1',expectedStateRevision:1,expectedRunBasisDigest:runBasis.basisDigest,
    sealOutcome:'failed',publishedCandidates:[],releasedMembers:[{materialKey:material.materialKey,disposition:'triage_failed',evidenceDigest:D('triage-failure')}]};
  const decision={...raw,decisionDigest:canonicalDigest(raw)};const store=createProcurementRunSealStore({schemaManifest,unitOfWork});
  const request={decision,commitMarker:{commitMarker:'seal-marker-1',commitDigest:D('seal-commit')},resultBinding:{resultId:'seal-receipt-1',eventId:'seal-event-1'}};
  const committed=store.seal(request);assert.equal(committed.typedResult.sealOutcome,'failed');assert.equal(store.seal(request).replayed,true);
  const check=new Database(databasePath,{readonly:true});assert.deepEqual(check.prepare('SELECT state,state_revision,seal_outcome FROM proc_procurement_runs').get(),{state:'sealed',state_revision:2,seal_outcome:'failed'});
  assert.deepEqual(check.prepare('SELECT selection_state,terminal_disposition FROM proc_run_materials').get(),{selection_state:'released',terminal_disposition:'triage_failed'});
  assert.equal(check.prepare('SELECT control_revision FROM fx_material_controls').get().control_revision,1);check.close();
}));

test('creates one open Retry Intent with exact failed evidence, preconditions, receipt, marker, and internal Outbox',()=>fixture(({databasePath,unitOfWork})=>{
  const registry=createDefaultTriageRuleRegistry();const material=identity();const initial=controlSnapshot(material);const runBasis=basis(registry,material,initial);
  const database=new Database(databasePath);seed(database,material,initial);database.close();
  createProcurementRunAdmissionStore({schemaManifest,unitOfWork,triageRegistry:registry}).admit({basis:runBasis,controlHandle:handle(runBasis),
    commitMarker:{commitMarker:'run-marker-1',commitDigest:D('run-commit')},resultBinding:{resultId:'run-receipt-1',eventId:'run-event-1'}});
  const raw={decisionId:'seal-decision-1',procurementRunId:'run-1',expectedStateRevision:1,expectedRunBasisDigest:runBasis.basisDigest,
    sealOutcome:'failed',publishedCandidates:[],releasedMembers:[{materialKey:material.materialKey,disposition:'triage_failed',evidenceDigest:D('triage-failure')}]};
  createProcurementRunSealStore({schemaManifest,unitOfWork}).seal({decision:{...raw,decisionDigest:canonicalDigest(raw)},
    commitMarker:{commitMarker:'seal-marker-1',commitDigest:D('seal-commit')},resultBinding:{resultId:'seal-receipt-1',eventId:'seal-event-1'}});
  const intent=retryIntent(registry,runBasis,material,controlledSnapshot(material));
  const store=createProcurementRetryIntentStore({schemaManifest,unitOfWork,triageRegistry:registry});
  const request={intent,commitMarker:{commitMarker:'retry-marker-1',commitDigest:D('retry-create')},
    resultBinding:{resultId:'retry-receipt-1',eventId:'retry-event-1'},outbox:{messageId:'retry-message-1'}};
  const committed=store.create(request);assert.equal(committed.replayed,false);assert.equal(committed.typedResult.intentState,'open');
  assert.equal(store.create(request).replayed,true);
  const idempotentReplay=store.create({...request,commitMarker:{commitMarker:'retry-marker-unused',commitDigest:D('different-attempt')}});
  assert.equal(idempotentReplay.replayed,true);assert.equal(idempotentReplay.commitMarker,'retry-marker-1');
  const check=new Database(databasePath,{readonly:true});
  assert.deepEqual(check.prepare('SELECT state,state_revision,retry_member_count FROM proc_procurement_retry_intents').get(),{state:'open',state_revision:1,retry_member_count:1});
  assert.equal(check.prepare('SELECT COUNT(*) count FROM proc_procurement_retry_intent_materials').get().count,1);
  const message=check.prepare('SELECT message_kind,payload_schema_ref,payload_json FROM fx_outbox').get();
  assert.equal(message.message_kind,'procurement_retry_intent_available');assert.equal(JSON.parse(message.payload_json).messageKind,'procurement_retry_intent_available');check.close();
}));

test('consumes a stale Retry Intent with closed-precedence member evidence and creates no Run or Control change',()=>fixture(({databasePath,unitOfWork})=>{
  const registry=createDefaultTriageRuleRegistry();const material=identity();const initial=controlSnapshot(material);const runBasis=basis(registry,material,initial);
  const database=new Database(databasePath);seed(database,material,initial);database.close();
  createProcurementRunAdmissionStore({schemaManifest,unitOfWork,triageRegistry:registry}).admit({basis:runBasis,controlHandle:handle(runBasis),commitMarker:{commitMarker:'run-marker-1',commitDigest:D('run-commit')},resultBinding:{resultId:'run-receipt-1',eventId:'run-event-1'}});
  const raw={decisionId:'seal-decision-1',procurementRunId:'run-1',expectedStateRevision:1,expectedRunBasisDigest:runBasis.basisDigest,sealOutcome:'failed',publishedCandidates:[],releasedMembers:[{materialKey:material.materialKey,disposition:'triage_failed',evidenceDigest:D('triage-failure')}]};
  createProcurementRunSealStore({schemaManifest,unitOfWork}).seal({decision:{...raw,decisionDigest:canonicalDigest(raw)},commitMarker:{commitMarker:'seal-marker-1',commitDigest:D('seal-commit')},resultBinding:{resultId:'seal-receipt-1',eventId:'seal-event-1'}});
  const intent=retryIntent(registry,runBasis,material,controlledSnapshot(material));
  createProcurementRetryIntentStore({schemaManifest,unitOfWork,triageRegistry:registry}).create({intent,commitMarker:{commitMarker:'retry-marker-1',commitDigest:D('retry-create')},resultBinding:{resultId:'retry-receipt-1',eventId:'retry-event-1'},outbox:{messageId:'retry-message-1'}});
  const mutate=new Database(databasePath);mutate.prepare("UPDATE proc_material_fields SET status='deregistered'").run();mutate.close();
  const store=createProcurementRetryAdmissionStore({schemaManifest,unitOfWork,triageRegistry:registry});const request={retryIntentId:intent.retryIntentId,expectedStateRevision:1,expectedIntentDigest:intent.intentDigest,commitMarker:{commitMarker:'retry-consume-marker-1',commitDigest:D('retry-consume')},resultBinding:{resultId:'retry-consume-result-1',eventId:'retry-consume-event-1'}};
  const committed=store.consume(request);assert.equal(committed.replayed,false);assert.equal(committed.typedResult.resultKind,'stale');assert.deepEqual(committed.typedResult.staleReasonCodes,['field_status_changed']);assert.equal(store.consume(request).replayed,true);
  const check=new Database(databasePath,{readonly:true});assert.deepEqual(check.prepare('SELECT state,state_revision,new_run_id,primary_stale_reason_code FROM proc_procurement_retry_intents').get(),{state:'stale',state_revision:2,new_run_id:null,primary_stale_reason_code:'field_status_changed'});
  assert.deepEqual(check.prepare('SELECT consume_outcome,consume_stale_reason_code FROM proc_procurement_retry_intent_materials').get(),{consume_outcome:'stale',consume_stale_reason_code:'field_status_changed'});
  assert.equal(check.prepare('SELECT COUNT(*) count FROM proc_procurement_runs').get().count,1);assert.equal(check.prepare('SELECT COUNT(*) count FROM fx_material_control_revisions').get().count,1);assert.equal(check.prepare('SELECT COUNT(*) count FROM fx_outbox').get().count,1);check.close();
}));

test('consumes a matched Retry Intent into exactly one linked Run with shared outer Result and same-Field Control assertion',()=>fixture(({databasePath,unitOfWork})=>{
  const registry=createDefaultTriageRuleRegistry();const material=identity();const initial=controlSnapshot(material);const failedBasis=basis(registry,material,initial);
  const database=new Database(databasePath);seed(database,material,initial);database.close();
  createProcurementRunAdmissionStore({schemaManifest,unitOfWork,triageRegistry:registry}).admit({basis:failedBasis,controlHandle:handle(failedBasis),commitMarker:{commitMarker:'run-marker-1',commitDigest:D('run-commit')},resultBinding:{resultId:'run-receipt-1',eventId:'run-event-1'}});
  const raw={decisionId:'seal-decision-1',procurementRunId:'run-1',expectedStateRevision:1,expectedRunBasisDigest:failedBasis.basisDigest,sealOutcome:'failed',publishedCandidates:[],releasedMembers:[{materialKey:material.materialKey,disposition:'triage_failed',evidenceDigest:D('triage-failure')}]};
  createProcurementRunSealStore({schemaManifest,unitOfWork}).seal({decision:{...raw,decisionDigest:canonicalDigest(raw)},commitMarker:{commitMarker:'seal-marker-1',commitDigest:D('seal-commit')},resultBinding:{resultId:'seal-receipt-1',eventId:'seal-event-1'}});
  const intent=retryIntent(registry,failedBasis,material,controlledSnapshot(material));createProcurementRetryIntentStore({schemaManifest,unitOfWork,triageRegistry:registry}).create({intent,commitMarker:{commitMarker:'retry-marker-1',commitDigest:D('retry-create')},resultBinding:{resultId:'retry-receipt-1',eventId:'retry-event-1'},outbox:{messageId:'retry-message-1'}});
  const newBasis=retryRunBasis(registry,material,controlledSnapshot(material));const store=createProcurementRetryAdmissionStore({schemaManifest,unitOfWork,triageRegistry:registry});const request={retryIntentId:intent.retryIntentId,expectedStateRevision:1,expectedIntentDigest:intent.intentDigest,newRunBasis:newBasis,controlHandle:handle(newBasis),createdControlReceiptId:'retry-control-receipt-1',priorityClass:'normal',commitMarker:{commitMarker:'retry-consume-marker-1',commitDigest:D('retry-consume')},resultBinding:{resultId:'retry-consume-result-1',eventId:'retry-consume-event-1'}};
  const committed=store.consume(request);assert.equal(committed.replayed,false);assert.equal(committed.typedResult.resultKind,'created');assert.equal(committed.typedResult.createdControlReceipt.assertedMaterialCount,1);assert.equal(store.consume(request).replayed,true);
  const check=new Database(databasePath,{readonly:true});assert.deepEqual(check.prepare('SELECT state,state_revision,new_run_id,consume_result_digest FROM proc_procurement_retry_intents').get(),{state:'consumed',state_revision:2,new_run_id:'run-2',consume_result_digest:canonicalDigest(committed.typedResult)});
  assert.deepEqual(check.prepare("SELECT retry_intent_id,admission_commit_marker,admission_result_digest FROM proc_procurement_runs WHERE procurement_run_id='run-2'").get(),{retry_intent_id:'retry-intent-1',admission_commit_marker:'retry-consume-marker-1',admission_result_digest:canonicalDigest(committed.typedResult)});
  assert.deepEqual(check.prepare("SELECT consume_outcome,consume_stale_reason_code FROM proc_procurement_retry_intent_materials").get(),{consume_outcome:'matched',consume_stale_reason_code:null});assert.equal(check.prepare('SELECT COUNT(*) count FROM fx_material_control_revisions').get().count,1);check.close();
}));
