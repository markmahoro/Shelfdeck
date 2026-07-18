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
const { activeTriageRule, createDefaultTriageRuleRegistry } = require('../../src/helix/domains/procurement/model/procurement-run-contracts');
const { createProcurementRunAdmissionStore } = require('../../src/helix/domains/procurement/persistence/procurement-run-admission-store');
const { createProcurementRunSealStore } = require('../../src/helix/domains/procurement/persistence/procurement-run-seal-store');

const generatedRoot = path.resolve(__dirname, '../../src/helix/foundation/persistence/generated');
const schemaDdl = fs.readFileSync(path.join(generatedRoot, 'clean-schema.sql'), 'utf8');
const schemaManifest = JSON.parse(fs.readFileSync(path.join(generatedRoot, 'clean-schema.manifest.json'), 'utf8'));
const D = (value) => canonicalDigest({ value });
function identity() { const value={ schemaRef:'helix://contracts/types/PhysicalMaterialIdentity/v1', schemaVersion:1,
  mountScopeId:'mount-1', inode:'42', contentHashAlgorithm:'sha256', contentHash:D('content') }; return { ...value, materialKey:materialKey(value) }; }
function controlSnapshot(material) { const evidence={schema:'foundation.material-control-evidence@1',materialKey:material.materialKey,
  resultKind:'available',controlRevision:0,controlState:'uncontrolled'}; const value={materialKey:material.materialKey,resultKind:'available',
  controlRevision:0,controlState:'uncontrolled',regionProjection:'uncontrolled',evidenceDigest:canonicalDigest(evidence)};
  return {...value,projectionDigest:canonicalDigest(value)}; }
function controlledSnapshot(material) { const evidence={schema:'foundation.material-control-evidence@1',materialKey:material.materialKey,
  resultKind:'available',controlRevision:1,controlState:'controlled',ownerDomain:'procurement',ownerScopeType:'material_field',ownerScopeId:'field-1'};
  const value={materialKey:material.materialKey,resultKind:'available',controlRevision:1,controlState:'controlled',ownerDomain:'procurement',
    ownerScopeType:'material_field',ownerScopeId:'field-1',regionProjection:'procurement',evidenceDigest:canonicalDigest(evidence)};
  return {...value,projectionDigest:canonicalDigest(value)}; }
function member(material, control) { const value={ordinal:0,materialKey:material.materialKey,selectionRole:'triage_input',bindingRevision:1,
  eligibilityRevision:2,eligibilityBasisDigest:D('eligibility'),lastSnapshotDigest:D('snapshot'),lastObservationId:'observation-1',
  endpointId:'endpoint-1',location:'/field/title.mkv',realityDigest:D('reality'),provenanceDigest:D('provenance'),
  controlSnapshot:control,admissionControlAction:control.controlState==='controlled'?'assert_same_field':'acquire'}; return {...value,basisMemberDigest:canonicalDigest(value)}; }
function basis(registry, material, control) { const selected={procurementRunId:'run-1',fieldId:'field-1',members:[member(material,control)]};
  selected.selectionDigest=canonicalDigest({schema:'procurement.selected-field-material-set@1',...selected});
  const value={procurementRunId:'run-1',fieldId:'field-1',fieldStatus:'active',fieldAccess:{revision:1,digest:D('access')},
    terminalObservation:{revision:1,fieldObservationWorkId:'observation-work-1'},extractionPolicy:{policyId:'policy-1',revision:1,digest:D('policy')},
    triageRule:activeTriageRule(registry),selectedFieldMaterialSet:selected}; return {...value,basisDigest:canonicalDigest(value)}; }
function handle(runBasis) { const memberValue=runBasis.selectedFieldMaterialSet.members[0]; return {
  schemaRef:'helix://contracts/types/ResponsibilityControlCommitHandle/v1',schemaVersion:1,handleId:'handle-1',operationKind:'acquire',
  ownerDomain:'procurement',processType:'procurement_run',processId:runBasis.procurementRunId,
  basisRef:{objectType:'procurement_run_execution_basis',objectId:runBasis.procurementRunId,revision:1,digest:runBasis.basisDigest},
  basisDigest:runBasis.basisDigest,canonicalFactSetDigest:runBasis.basisDigest,bindingSetDigest:runBasis.selectedFieldMaterialSet.selectionDigest,
  controlScopeDigest:runBasis.selectedFieldMaterialSet.selectionDigest,
  expectedControlRevisions:[{materialKey:memberValue.materialKey,revision:memberValue.controlSnapshot.controlRevision}],
  receiptContract:'helix://contracts/types/ProcurementControlReceipt/v1',eventFenceDigest:D('fence')}; }
function seed(database, material, control) {
  const transaction=database.transaction(()=>{
    database.prepare('INSERT INTO proc_material_fields VALUES(?,?,?,?,?,?,?,?,?)').run('field-1','Field','active','policy-1',1,1,null,1,1);
    database.prepare('INSERT INTO proc_extraction_policy_revisions VALUES(?,?,?,?,?,?)').run('policy-1',1,'helix://contracts/domain-types/ExtractionPolicy/v1','{}',D('policy'),1);
    database.prepare('INSERT INTO proc_field_access_revisions VALUES(?,?,?,?,?,?,?,?,?)').run('field-1',1,'endpoint-1','/field','mount-1',1,'field-access@1',D('access'),1);
    database.prepare('INSERT INTO fx_supporting_works VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('observation-work-1','procurement','field_observation','field-1','observe',D('work'),'normal','succeeded','observation-work-1',1,1);
    database.prepare('INSERT INTO fx_supporting_works VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('run-work-1','procurement','procurement_run','run-1','admit',D('run-work'),'normal','running','run-work-1',1,1);
    database.prepare('INSERT INTO fx_work_attempts VALUES(?,?,?,?,?,?,?,?)').run('run-attempt-1','run-work-1',0,D('attempt'),'running',1,null,null);
    database.prepare('INSERT INTO fx_workflow_plans VALUES(?,?,?,?,?,?,?,?,?)').run('run-plan-1','run-attempt-1','procurement-planner',1,D('catalog'),D('plan-basis'),D('graph'),'planned',1);
    database.prepare('INSERT INTO fx_plan_nodes VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('run-plan-1','admit','procurement.material.control.acquire@1',1,'input@1','{}','parameters@1','{}','when@1','{}','responsibility_control_commit','fence@1','{}','resource@1','{}');
    database.prepare('INSERT INTO fx_plan_nodes VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('run-plan-1','seal','procurement.run.seal@1',1,'input@1','{}','parameters@1','{}','when@1','{}','domain_fact_commit','fence@1','{}','resource@1','{}');
    database.prepare('INSERT INTO fx_workflow_events VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('run-event-1','run-plan-1','admit','run-work-1','run-attempt-1','procurement','procurement.material.control.acquire@1',1,'executing','normal',1,null,null,null);
    database.prepare('INSERT INTO fx_workflow_events VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('seal-event-1','run-plan-1','seal','run-work-1','run-attempt-1','procurement','procurement.run.seal@1',1,'ready','normal',1,null,null,null);
    database.prepare('INSERT INTO fx_commit_markers(commit_marker,owner_domain,scope_type,scope_id,commit_digest,committed_at_ms) VALUES(?,?,?,?,?,?)').run('observation-marker','procurement','material_field_observation','field-1',D('observation-marker'),1);
    database.prepare('INSERT INTO proc_field_observations VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('field-1',1,'observation-1','observation-work-1',1,0,0,null,null,D('page'),D('fact'),'observation-marker',D('result'),1,1);
    database.prepare('UPDATE proc_material_fields SET current_observation_revision=1 WHERE field_id=?').run('field-1');
    database.prepare(`INSERT INTO proc_field_materials VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      'field-1',material.materialKey,material.mountScopeId,material.inode,material.contentHashAlgorithm,material.contentHash,'endpoint-1',1,1,100,1,1,1,
      '/field/title.mkv',1,D('reality'),D('provenance'),D('snapshot'),'observation-1',2,'eligible','eligible',D('eligibility'),'active',1,1,
      D('selection'),control.regionProjection,control.controlRevision > 0 ? control.controlRevision : null,control.projectionDigest,1);
  });
  try { transaction(); } catch (error) { throw new Error(`seed failed: ${error.message || error.code}`, { cause:error }); }
}
function fixture(run) { const root=fs.mkdtempSync(path.join(os.tmpdir(),'helix-run-admission-')); const databasePath=path.join(root,'shelfdeck.db');
  let now=100; const kernel=openSqliteKernel({Database,databasePath,schemaDdl,schemaManifest,now:()=>now++});
  try{return run({databasePath,kernel,unitOfWork:createSqliteUnitOfWork({kernel})});}finally{kernel.close();try{fs.rmSync(root,{recursive:true,force:true});}catch{}} }

test('admits complete Run Basis, Selection, Control, receipt, and marker in one transaction and replays it',()=>fixture(({databasePath,unitOfWork})=>{
  const registry=createDefaultTriageRuleRegistry(); const material=identity(); const control=controlSnapshot(material); const runBasis=basis(registry,material,control);
  const database=new Database(databasePath); seed(database,material,control); database.close();
  const store=createProcurementRunAdmissionStore({schemaManifest,unitOfWork,triageRegistry:registry}); const request={basis:runBasis,controlHandle:handle(runBasis),
    commitMarker:{commitMarker:'run-marker-1',commitDigest:D('run-commit')},resultBinding:{resultId:'run-receipt-1',eventId:'run-event-1'},priorityClass:'normal'};
  const committed=store.admit(request); assert.equal(committed.replayed,false); assert.equal(committed.typedResult.acquiredMaterialCount,1);
  const replay=store.admit(request); assert.equal(replay.replayed,true); assert.deepEqual(replay.typedResult,committed.typedResult);
  const check=new Database(databasePath,{readonly:true}); assert.equal(check.prepare('SELECT COUNT(*) count FROM proc_procurement_runs').get().count,1);
  assert.equal(check.prepare('SELECT COUNT(*) count FROM proc_run_materials').get().count,1);
  assert.equal(check.prepare('SELECT control_revision FROM fx_material_controls').get().control_revision,1);
  assert.equal(check.prepare("SELECT COUNT(*) count FROM fx_outbox").get().count,0); check.close();
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

test('same-Field Control is asserted without a fake release/acquire revision',()=>fixture(({databasePath,unitOfWork})=>{
  const registry=createDefaultTriageRuleRegistry(); const material=identity(); const control=controlledSnapshot(material); const runBasis=basis(registry,material,control);
  const database=new Database(databasePath); seed(database,material,control);
  database.prepare(`INSERT INTO fx_material_controls VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(material.materialKey,material.mountScopeId,material.inode,
    material.contentHashAlgorithm,material.contentHash,'procurement','material_field','field-1',1,'controlled',1);
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
