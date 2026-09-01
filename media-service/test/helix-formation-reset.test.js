'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { canonicalDigest } = require('../src/helix/contracts/canonical-json');
const { activeRunScopeSetDigest } = require('../src/helix/domains/libra/model/run-admission-contracts');
const { runStateDigest } = require('../src/helix/domains/libra/model/run-lifecycle-contracts');
const { emptyReferenceSetDigest, workspaceStateDigest } = require('../src/helix/domains/libra/model/workspace-admission-contracts');
const { applyReset, assertSafeTranscodeRoot, inspectPlan } = require('../scripts/helix-formation-reset');

const schemaDdl = fs.readFileSync(path.join(
  __dirname, '../src/helix/foundation/persistence/generated/clean-schema.sql',
), 'utf8');
const DIGEST = 'a'.repeat(64);

function fixture(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
  const dataDir = path.join(root, 'data');
  const transcodeDir = path.join(root, 'transcode');
  fs.mkdirSync(dataDir);
  fs.mkdirSync(transcodeDir);
  const database = new Database(path.join(dataDir, 'shelfdeck.db'));
  database.exec(schemaDdl);
  database.pragma('foreign_keys = ON');
  return { root, dataDir, transcodeDir, database };
}

function close(value) {
  value.database.close();
  fs.rmSync(value.root, { recursive:true, force:true });
}

function seedSubjectRun(database, suffix, state = 'active') {
  const subjectId = `subject-${suffix}`;
  const runId = `run-${suffix}`;
  const workspaceId = canonicalDigest({ workspace:suffix });
  const initialState = { libraRunId:runId,stateRevision:1,state,acceptanceSpecId:null,
    executionBasisDigest:DIGEST,runScopeDigest:DIGEST,priorityClass:'normal',priorityIntentDigest:DIGEST,
    transitionKind:'admitted',transitionEvidenceDigest:DIGEST };
  const stateDigest = runStateDigest(initialState);
  const activeScopeDigest = activeRunScopeSetDigest(subjectId, [{ libraRunId:runId,runScopeDigest:DIGEST,
    stateRevision:1,stateDigest }]);
  database.prepare(`INSERT INTO libra_subjects
    (subject_id,structure_kind,content_profile,status,intake_revision,current_continuity_set_digest,
     current_episode_scope_digest,created_at_ms,updated_at_ms)
    VALUES (?, 'single','movie','active',1,?,?,1,1)`).run(subjectId,DIGEST,DIGEST);
  database.prepare(`INSERT INTO libra_runs
    (libra_run_id,subject_id,admission_revision,execution_basis_record_json,execution_basis_digest,
     run_scope_digest,state,state_revision,state_digest,priority_class,priority_intent_digest,
     recovery_attempt_ordinal,created_at_ms)
    VALUES (?,?,1,'{}',?,?,?,1,?,'normal',?,0,1)`)
    .run(runId,subjectId,DIGEST,DIGEST,state,stateDigest,DIGEST);
  database.prepare(`INSERT INTO libra_run_admission_heads(subject_id,head_revision,active_scope_set_digest,updated_at_ms)
    VALUES (?,1,?,1)`).run(subjectId,activeScopeDigest);
  const referenceDigest = emptyReferenceSetDigest(workspaceId);
  const workspaceState = { workspaceId,workspaceRevision:1,state:'active',workspaceMaterialReferenceSetDigest:referenceDigest,
    transitionKind:'admitted',transitionEvidenceDigest:DIGEST };
  const workspaceDigest = workspaceStateDigest(workspaceState);
  database.transaction(() => {
    database.pragma('defer_foreign_keys = ON');
    database.prepare(`INSERT INTO libra_workspaces
      (workspace_id,libra_run_id,current_revision,state,state_digest,created_at_ms)
      VALUES (?,?,1,'active',?,1)`).run(workspaceId,runId,workspaceDigest);
    database.prepare(`INSERT INTO libra_workspace_revisions
      (workspace_id,workspace_revision,state,material_reference_set_digest,transition_kind,
       transition_evidence_digest,revision_digest,committed_at_ms)
      VALUES (?,1,'active',?,'admitted',?,?,1)`).run(workspaceId,referenceDigest,DIGEST,canonicalDigest(workspaceState));
  })();
  database.prepare(`INSERT INTO fx_workspace_registry(workspace_id,owner_domain,process_type,process_id,state,created_at_ms)
    VALUES (?,'libra','libra_run',?,'active',1)`).run(workspaceId,runId);
  return { subjectId, runId, workspaceId };
}

function seedExecution(database, ownerDomain, processType, processId, suffix) {
  const workId = `work-${suffix}`, attemptId = `attempt-${suffix}`, planId = `plan-${suffix}`,
    eventId = `event-${suffix}`, eventAttemptId = `event-attempt-${suffix}`;
  database.prepare(`INSERT INTO fx_supporting_works
    (work_id,owner_domain,process_type,process_id,work_kind,basis_digest,priority_class,
     definition_json,definition_digest,state,idempotency_key,created_at_ms,updated_at_ms)
    VALUES (?,?,?,?, 'test',?,'normal','{}',?,'running',?,1,1)`)
    .run(workId,ownerDomain,processType,processId,DIGEST,DIGEST,`key-${suffix}`);
  database.prepare(`INSERT INTO fx_work_attempts(attempt_id,work_id,ordinal,basis_digest,state,started_at_ms)
    VALUES (?,?,1,?,'running',1)`).run(attemptId,workId,DIGEST);
  database.prepare(`INSERT INTO fx_workflow_plans(plan_id,attempt_id,planner_ref,planner_version,catalog_digest,basis_digest,graph_digest,state,created_at_ms)
    VALUES (?,?, 'test',1,?,?,?,'planned',1)`).run(planId,attemptId,DIGEST,DIGEST,DIGEST);
  database.prepare(`INSERT INTO fx_workflow_events(event_id,plan_id,node_id,work_id,attempt_id,owner_domain,
    capability_ref,contract_version,state,priority_class,ready_at_ms)
    VALUES (?,?, 'node',?,?,?,'test',1,'executing','normal',1)`)
    .run(eventId,planId,workId,attemptId,ownerDomain);
  database.prepare(`INSERT INTO fx_event_attempts(event_attempt_id,event_id,ordinal,executor_ref,executor_version,
    input_snapshot_digest,fence_snapshot_digest,state,started_at_ms)
    VALUES (?,?,1,'test',1,?,?,'executing',1)`).run(eventAttemptId,eventId,DIGEST,DIGEST);
  database.prepare(`INSERT INTO fx_effect_journal(effect_id,event_attempt_id,effect_class,idempotency_key,
    intent_digest,state,updated_at_ms) VALUES (?,?,?,?,?,'intended',1)`)
    .run(`effect-${suffix}`,eventAttemptId,'workspace_write',`effect-key-${suffix}`,DIGEST);
  return { workId, attemptId, planId, eventId, eventAttemptId };
}

function seedAcceptedOrphan(database, suffix) {
  const subjectId = `subject-orphan-${suffix}`;
  const intakeDecisionId = `intake-orphan-${suffix}`;
  const materialKey = `material-orphan-${suffix}`;
  database.transaction(() => {
    database.pragma('defer_foreign_keys = ON');
    database.prepare(`INSERT INTO libra_subjects
      (subject_id,structure_kind,content_profile,status,intake_revision,current_continuity_set_digest,
       current_episode_scope_digest,routing_anchor_intake_decision_id,created_at_ms,updated_at_ms)
      VALUES (?,'single','movie','active',1,?,?,?,1,1)`).run(subjectId,DIGEST,DIGEST,intakeDecisionId);
    database.prepare(`INSERT INTO libra_intake_decisions
      (intake_decision_id,decision_revision,decision_kind,offer_id,candidate_package_id,package_revision,
       package_digest,target_subject_id,accepted_result,decision_digest,decided_at_ms,
       candidate_delivery_snapshot_schema_ref,candidate_delivery_snapshot_json,
       decision_identity_evidence_schema_ref,decision_identity_evidence_json,decision_identity_evidence_digest)
      VALUES (?,1,'accepted_resolution',?, ?,1,?,?,'new_subject',?,1,'snapshot','{}','identity','{}',?)`)
      .run(intakeDecisionId,`offer-${suffix}`,`candidate-${suffix}`,DIGEST,subjectId,DIGEST,DIGEST);
    database.prepare(`INSERT INTO libra_handoff_a_receipts
      (receipt_id,intake_decision_id,outcome,offer_id,candidate_package_id,package_revision,package_digest,
       subject_id,subject_intake_revision,subject_continuity_head_revision,committed_at_ms)
      VALUES (?,?, 'accepted',?,?,1,?,?,1,1,1)`)
      .run(`receipt-${suffix}`,intakeDecisionId,`offer-${suffix}`,`candidate-${suffix}`,DIGEST,subjectId);
    database.prepare(`INSERT INTO libra_material_bindings
      (subject_id,material_key,role,authority_kind,binding_revision,health_state,origin_intake_decision_id,current)
      VALUES (?,?,'primary_payload','primary_control',1,'active',?,1)`)
      .run(subjectId,materialKey,intakeDecisionId);
  })();
  database.prepare(`INSERT INTO fx_material_controls(material_key,mount_scope_id,inode,size_bytes,
    fingerprint_algorithm,fingerprint_version,content_fingerprint,owner_domain,owner_scope_type,owner_scope_id,
    control_revision,state,updated_at_ms) VALUES (?, 'mount',?,1,'middle','1',?,'procurement','procurement_run',?,1,'controlled',1)`)
    .run(materialKey,`inode-${suffix}`,`fp-${suffix}`,`proc-run-${suffix}`);
  database.prepare(`INSERT INTO fx_material_control_revisions(material_key,revision,operation_kind,
    to_owner_domain,to_scope_type,to_scope_id,basis_digest,commit_marker,committed_at_ms)
    VALUES (?,1,'acquire','procurement','procurement_run',?,?,'procurement',1)`)
    .run(materialKey,`proc-run-${suffix}`,DIGEST);
  return { subjectId, intakeDecisionId, materialKey };
}

function seedOrphanPipelineToken(database, suffix) {
  const subjectId = `subject-token-orphan-${suffix}`;
  const processId = `intake-process-token-orphan-${suffix}`;
  database.prepare(`INSERT INTO libra_predeck_pipeline_tokens
    (subject_id,source_field_id,source_process_id,acquired_at_ms) VALUES (?,'field-orphan',?,1)`)
    .run(subjectId,processId);
  const execution = seedExecution(database, 'libra', 'libra_intake', processId, `token-orphan-${suffix}`);
  return { subjectId, processId, ...execution };
}

test('Formation Reset is an exact no-op on an empty database and preserves unrelated transcode entries', () => {
  const value = fixture('helix-formation-reset-empty');
  try {
    fs.writeFileSync(path.join(value.transcodeDir, 'unrelated.part'), 'keep');
    for (const mode of ['normal','nuclear']) {
      const plan = inspectPlan(value.database, mode);
      assert.equal(plan.ready, true);
      assert.equal(plan.counts.runs, 0);
      const result = applyReset({ database:value.database, mode, dataDir:value.dataDir,
        transcodeDir:value.transcodeDir, nowMs:1000 });
      assert.equal(result.verification.integrity, 'ok');
      assert.equal(fs.existsSync(path.join(value.transcodeDir, 'unrelated.part')), true);
    }
  } finally { close(value); }
});

test('Normal Reset terminalizes active Formation, releases Control, and only removes the exact Workspace', () => {
  const value = fixture('helix-formation-reset-normal');
  try {
    const seeded = seedSubjectRun(value.database, 'normal');
    const execution = seedExecution(value.database, 'libra', 'libra_run', seeded.runId, 'normal');
    value.database.prepare(`INSERT INTO libra_formation_projections(subject_id,classification,subject_status,
      display_identity,next_action_label,next_action_state,attention_state,added_at_ms,updated_at_ms)
      VALUES (?,'in_progress','active','Normal','整理中','running','none',1,1)`).run(seeded.subjectId);
    value.database.prepare(`INSERT INTO libra_predeck_pipeline_tokens(subject_id,source_field_id,source_process_id,acquired_at_ms)
      VALUES (?,'field','process',1)`).run(seeded.subjectId);
    value.database.prepare(`INSERT INTO fx_material_controls(material_key,mount_scope_id,inode,size_bytes,
      fingerprint_algorithm,fingerprint_version,content_fingerprint,owner_domain,owner_scope_type,owner_scope_id,
      control_revision,state,updated_at_ms) VALUES ('material-normal','mount','inode',1,'middle', '1','fp','libra','subject',?,1,'controlled',1)`)
      .run(seeded.subjectId);
    value.database.prepare(`INSERT INTO fx_material_control_revisions(material_key,revision,operation_kind,
      to_owner_domain,to_scope_type,to_scope_id,basis_digest,commit_marker,committed_at_ms)
      VALUES ('material-normal',1,'acquire','libra','subject',?,?,'initial',1)`).run(seeded.subjectId,DIGEST);
    value.database.prepare(`INSERT INTO libra_material_bindings(subject_id,material_key,role,authority_kind,
      binding_revision,health_state,origin_intake_decision_id,current)
      VALUES (?,'material-normal','primary_payload','primary_control',1,'active',NULL,1)`).run(seeded.subjectId);
    fs.mkdirSync(path.join(value.transcodeDir, seeded.workspaceId));
    fs.writeFileSync(path.join(value.transcodeDir, seeded.workspaceId, 'output.part'), 'partial');
    fs.mkdirSync(path.join(value.transcodeDir, 'unrelated-workspace'));

    const result = applyReset({ database:value.database, mode:'normal', dataDir:value.dataDir,
      transcodeDir:value.transcodeDir, nowMs:2000 });
    assert.equal(result.result.discardedRuns, 1);
    assert.equal(result.result.releasedControls, 1);
    assert.equal(fs.existsSync(path.join(value.transcodeDir, seeded.workspaceId)), false);
    assert.equal(fs.existsSync(path.join(value.transcodeDir, 'unrelated-workspace')), true);
    assert.deepEqual(value.database.prepare('SELECT status FROM libra_subjects WHERE subject_id=?').get(seeded.subjectId), { status:'abandoned' });
    assert.deepEqual(value.database.prepare('SELECT state,state_revision FROM libra_runs WHERE libra_run_id=?').get(seeded.runId),
      { state:'discarded', state_revision:2 });
    assert.equal(value.database.prepare('SELECT COUNT(*) count FROM libra_run_revisions WHERE libra_run_id=?').get(seeded.runId).count, 1);
    assert.deepEqual(value.database.prepare('SELECT state FROM fx_supporting_works WHERE work_id=?').get(execution.workId), { state:'cancelled' });
    assert.deepEqual(value.database.prepare('SELECT state FROM fx_event_attempts WHERE event_attempt_id=?').get(execution.eventAttemptId), { state:'completed' });
    assert.deepEqual(value.database.prepare('SELECT state,owner_domain FROM fx_material_controls WHERE material_key=?').get('material-normal'),
      { state:'released', owner_domain:null });
    assert.equal(value.database.prepare('SELECT COUNT(*) count FROM libra_formation_projections').get().count, 0);
    assert.equal(value.database.prepare('SELECT COUNT(*) count FROM libra_predeck_pipeline_tokens').get().count, 0);

    const revisionCount = value.database.prepare('SELECT COUNT(*) count FROM fx_material_control_revisions').get().count;
    applyReset({ database:value.database, mode:'normal', dataDir:value.dataDir,
      transcodeDir:value.transcodeDir, nowMs:3000 });
    assert.equal(value.database.prepare('SELECT COUNT(*) count FROM fx_material_control_revisions').get().count, revisionCount);
    assert.equal(value.database.prepare('SELECT state_revision FROM libra_runs WHERE libra_run_id=?').get(seeded.runId).state_revision, 2);
  } finally { close(value); }
});

test('both Reset modes clear Accepted Subjects without a token while preserving Procurement Control', () => {
  for (const mode of ['normal','nuclear']) {
    const value = fixture(`helix-formation-reset-orphan-${mode}`);
    try {
      const seeded = seedAcceptedOrphan(value.database, mode);
      const plan = inspectPlan(value.database, mode);
      assert.equal(plan.ready, true);
      assert.equal(plan.counts.orphanAcceptedSubjects, 1);
      assert.equal(plan.counts.preservedProcurementControls, 1);
      const result = applyReset({ database:value.database, mode, dataDir:value.dataDir,
        transcodeDir:value.transcodeDir, nowMs:3500 });
      assert.equal(result.verification.plan.counts.orphanAcceptedSubjects, 0);
      assert.deepEqual(value.database.prepare(`SELECT owner_domain,owner_scope_type,control_revision,state
        FROM fx_material_controls WHERE material_key=?`).get(seeded.materialKey), {
        owner_domain:'procurement', owner_scope_type:'procurement_run', control_revision:1, state:'controlled',
      });
      assert.equal(value.database.prepare('SELECT COUNT(*) count FROM fx_material_control_revisions WHERE material_key=?')
        .get(seeded.materialKey).count, 1);
      if (mode === 'normal') {
        assert.deepEqual(value.database.prepare('SELECT status FROM libra_subjects WHERE subject_id=?').get(seeded.subjectId),
          { status:'abandoned' });
      } else {
        assert.equal(value.database.prepare('SELECT COUNT(*) count FROM libra_subjects WHERE subject_id=?')
          .get(seeded.subjectId).count, 0);
      }
    } finally { close(value); }
  }
});

test('both Reset modes clear orphan pipeline tokens and their Intake execution responsibility', () => {
  for (const mode of ['normal','nuclear']) {
    const value = fixture(`helix-formation-reset-orphan-token-${mode}`);
    try {
      const seeded = seedOrphanPipelineToken(value.database, mode);
      const plan = inspectPlan(value.database, mode);
      assert.equal(plan.ready, true);
      assert.equal(plan.counts.orphanPipelineTokens, 1);
      assert.equal(plan.counts.works, 1);
      assert.deepEqual(plan.orphans.pipelineTokens.map((row) => row.subject_id), [seeded.subjectId]);
      assert.equal(plan.scope.orphanPipelineSourceProcessIds.includes(seeded.processId), true);

      const result = applyReset({ database:value.database, mode, dataDir:value.dataDir,
        transcodeDir:value.transcodeDir, nowMs:3550 });
      assert.equal(result.verification.plan.counts.orphanPipelineTokens, 0);
      assert.equal(value.database.prepare('SELECT COUNT(*) count FROM libra_predeck_pipeline_tokens WHERE subject_id=?')
        .get(seeded.subjectId).count, 0);
      if (mode === 'normal') {
        assert.deepEqual(value.database.prepare('SELECT state FROM fx_supporting_works WHERE work_id=?').get(seeded.workId),
          { state:'cancelled' });
      } else {
        assert.equal(value.database.prepare('SELECT COUNT(*) count FROM fx_supporting_works WHERE work_id=?')
          .get(seeded.workId).count, 0);
      }

      applyReset({ database:value.database, mode, dataDir:value.dataDir,
        transcodeDir:value.transcodeDir, nowMs:3560 });
      assert.equal(inspectPlan(value.database, mode).counts.orphanPipelineTokens, 0);
    } finally { close(value); }
  }
});

test('Normal Reset reconstructs a missing admission head only to terminalize the orphan Run', () => {
  const value = fixture('helix-formation-reset-orphan-run-head');
  try {
    const seeded = seedSubjectRun(value.database, 'missing-head');
    value.database.prepare('DELETE FROM libra_run_admission_heads WHERE subject_id=?').run(seeded.subjectId);
    const plan = inspectPlan(value.database, 'normal');
    assert.equal(plan.ready, true);
    assert.equal(plan.counts.orphanActiveRuns, 1);
    const result = applyReset({ database:value.database, mode:'normal', dataDir:value.dataDir,
      transcodeDir:value.transcodeDir, nowMs:3600 });
    assert.equal(result.result.createdAdmissionHeads, 1);
    assert.equal(result.verification.plan.counts.orphanActiveRuns, 0);
    assert.deepEqual(value.database.prepare('SELECT state FROM libra_runs WHERE libra_run_id=?').get(seeded.runId),
      { state:'discarded' });
  } finally { close(value); }
});

test('Nuclear Reset rolls a package-owned Control back to its Procurement boundary', () => {
  const value = fixture('helix-formation-reset-package-control');
  try {
    const seeded = seedSubjectRun(value.database, 'package-control');
    const packageId = 'package-control';
    const materialKey = 'material-package-control';
    value.database.prepare(`INSERT INTO libra_product_packages
      (on_deck_package_id,offer_id,package_revision,libra_run_id,run_state_revision,subject_id,
       product_structure_json,production_provenance_json,attestation_json,package_digest,state,published_at_ms)
      VALUES (?,'offer-control',1,?,1,?,'{}','{}','{}',?,'published',1)`)
      .run(packageId,seeded.runId,seeded.subjectId,DIGEST);
    value.database.prepare(`INSERT INTO libra_product_package_materials
      (on_deck_package_id,ordinal,material_key,committed_control_revision,committed_control_projection_digest,member_digest)
      VALUES (?,0,?,2,?,?)`).run(packageId,materialKey,DIGEST,DIGEST);
    value.database.prepare(`INSERT INTO fx_material_controls(material_key,mount_scope_id,inode,size_bytes,
      fingerprint_algorithm,fingerprint_version,content_fingerprint,owner_domain,owner_scope_type,owner_scope_id,
      control_revision,state,updated_at_ms) VALUES (?,'mount','inode-control',1,'middle','1','fp-control','libra','on_deck_package',?,2,'controlled',2)`)
      .run(materialKey,packageId);
    value.database.prepare(`INSERT INTO fx_material_control_revisions(material_key,revision,operation_kind,
      to_owner_domain,to_scope_type,to_scope_id,basis_digest,commit_marker,committed_at_ms)
      VALUES (?,1,'acquire','procurement','procurement_run','proc-run-control',?,'control-1',1),
             (?,2,'transfer','libra','on_deck_package',?,?, 'control-2',2)`)
      .run(materialKey,DIGEST,materialKey,packageId,DIGEST);

    const plan = inspectPlan(value.database, 'nuclear');
    assert.equal(plan.ready, true);
    assert.equal(plan.counts.controlledMaterials, 1);
    const result = applyReset({ database:value.database, mode:'nuclear', dataDir:value.dataDir,
      transcodeDir:value.transcodeDir, nowMs:3700 });
    assert.equal(result.result.restoredProcurementControls, 1);
    assert.deepEqual(value.database.prepare(`SELECT owner_domain,owner_scope_type,owner_scope_id,control_revision,state
      FROM fx_material_controls WHERE material_key=?`).get(materialKey), {
      owner_domain:'procurement', owner_scope_type:'procurement_run', owner_scope_id:'proc-run-control',
      control_revision:1, state:'controlled',
    });
    assert.equal(value.database.prepare('SELECT COUNT(*) count FROM fx_material_control_revisions WHERE material_key=?')
      .get(materialKey).count, 1);
  } finally { close(value); }
});

test('Nuclear Reset deletes an uncommitted Libra-to-Arca graph but preserves committed collection facts', () => {
  const value = fixture('helix-formation-reset-nuclear');
  try {
    const target = seedSubjectRun(value.database, 'target');
    const intakeDecision = 'intake-decision-target';
    value.database.transaction(() => {
      value.database.pragma('defer_foreign_keys = ON');
      value.database.prepare(`INSERT INTO libra_intake_decisions
        (intake_decision_id,decision_revision,decision_kind,offer_id,candidate_package_id,package_revision,
         package_digest,target_subject_id,accepted_result,decision_digest,decided_at_ms,
         candidate_delivery_snapshot_schema_ref,candidate_delivery_snapshot_json,
         decision_identity_evidence_schema_ref,decision_identity_evidence_json,decision_identity_evidence_digest)
        VALUES (?,1,'accepted_resolution','handoff-a-offer-target','candidate-target',1,?,?,'new_subject',?,1,
          'snapshot','{}','identity','{}',?)`)
        .run(intakeDecision,DIGEST,target.subjectId,DIGEST,DIGEST);
      value.database.prepare('UPDATE libra_subjects SET routing_anchor_intake_decision_id=? WHERE subject_id=?')
        .run(intakeDecision,target.subjectId);
      value.database.prepare(`INSERT INTO libra_handoff_a_receipts
        (receipt_id,intake_decision_id,outcome,offer_id,candidate_package_id,package_revision,package_digest,
         subject_id,subject_intake_revision,subject_continuity_head_revision,committed_at_ms)
        VALUES ('handoff-a-receipt-target',?,'accepted','handoff-a-offer-target','candidate-target',1,?,?,1,1,1)`)
        .run(intakeDecision,DIGEST,target.subjectId);
    })();
    seedExecution(value.database, 'libra', 'libra_intake', intakeDecision, 'intake-target');
    const targetPackage = 'package-target', targetOffer = 'offer-target', targetAttempt = 'acceptance-attempt-target',
      targetDecision = 'acceptance-decision-target', targetCustody = 'custody-target', targetOnDeck = 'on-deck-target';
    value.database.prepare(`INSERT INTO libra_product_packages
      (on_deck_package_id,offer_id,package_revision,libra_run_id,run_state_revision,subject_id,
       product_structure_json,production_provenance_json,attestation_json,package_digest,state,published_at_ms)
      VALUES (?,?,1,?,1,?,'{}','{}','{}',?,'published',1)`)
      .run(targetPackage,targetOffer,target.runId,target.subjectId,DIGEST);
    value.database.prepare(`INSERT INTO arca_acceptance_attempts
      (acceptance_attempt_id,offer_id,on_deck_package_id,package_digest,state,created_at_ms)
      VALUES (?,?,?,?,'accepted',1)`).run(targetAttempt,targetOffer,targetPackage,DIGEST);
    value.database.prepare(`INSERT INTO arca_acceptance_decisions
      (acceptance_decision_id,acceptance_attempt_id,result,offer_id,on_deck_package_id,package_digest,decided_at_ms)
      VALUES (?,?,'accepted',?,?,?,1)`).run(targetDecision,targetAttempt,targetOffer,targetPackage,DIGEST);
    value.database.prepare(`INSERT INTO arca_handoff_b_receipts
      (receipt_id,acceptance_decision_id,outcome,offer_id,custody_id,on_deck_package_id,package_digest,committed_at_ms)
      VALUES ('receipt-target',?,'accepted',?,?,?,?,1)`).run(targetDecision,targetOffer,targetCustody,targetPackage,DIGEST);
    value.database.prepare(`INSERT INTO arca_ondeck_custodies
      (custody_id,acceptance_decision_id,on_deck_package_id,package_digest,state,accepted_at_ms)
      VALUES (?,?,?,?,'active',1)`).run(targetCustody,targetDecision,targetPackage,DIGEST);
    value.database.prepare(`INSERT INTO arca_ondeck_runs(on_deck_run_id,custody_id,state,created_at_ms)
      VALUES (?,?,'offloading',1)`).run(targetOnDeck,targetCustody);
    value.database.prepare(`INSERT INTO arca_material_bindings
      (owner_object_type,owner_object_id,material_key,role,authority_kind,binding_revision,health_state,current)
      VALUES ('on_deck_custody',?,'material-target','primary_payload','product_control',1,'active',1)`).run(targetCustody);
    value.database.prepare(`INSERT INTO fx_material_controls(material_key,mount_scope_id,inode,size_bytes,
      fingerprint_algorithm,fingerprint_version,content_fingerprint,owner_domain,owner_scope_type,owner_scope_id,
      control_revision,state,updated_at_ms) VALUES ('material-target','mount','inode-target',1,'middle','1','fp-target','arca','on_deck_custody',?,1,'controlled',1)`)
      .run(targetCustody);
    value.database.prepare(`INSERT INTO fx_material_control_revisions(material_key,revision,operation_kind,
      to_owner_domain,to_scope_type,to_scope_id,basis_digest,commit_marker,committed_at_ms)
      VALUES ('material-target',1,'transfer','arca','on_deck_custody',?,?,'target',1)`).run(targetCustody,DIGEST);
    const targetExecution = seedExecution(value.database, 'arca', 'arca_ondeck_run', targetOnDeck, 'target');

    const kept = seedSubjectRun(value.database, 'kept', 'completed');
    const keptPackage = 'package-kept', keptCustody = 'custody-kept', keptOnDeck = 'on-deck-kept';
    value.database.prepare(`INSERT INTO libra_product_packages
      (on_deck_package_id,offer_id,package_revision,libra_run_id,run_state_revision,subject_id,
       product_structure_json,production_provenance_json,attestation_json,package_digest,state,published_at_ms)
      VALUES (?,'offer-kept',1,?,1,?,'{}','{}','{}',?,'published',1)`)
      .run(keptPackage,kept.runId,kept.subjectId,DIGEST);
    value.database.prepare(`INSERT INTO arca_acceptance_attempts(acceptance_attempt_id,offer_id,on_deck_package_id,package_digest,state,created_at_ms)
      VALUES ('attempt-kept','offer-kept',?,?,'accepted',1)`).run(keptPackage,DIGEST);
    value.database.prepare(`INSERT INTO arca_acceptance_decisions(acceptance_decision_id,acceptance_attempt_id,result,offer_id,on_deck_package_id,package_digest,decided_at_ms)
      VALUES ('decision-kept','attempt-kept','accepted','offer-kept',?,?,1)`).run(keptPackage,DIGEST);
    value.database.prepare(`INSERT INTO arca_ondeck_custodies(custody_id,acceptance_decision_id,on_deck_package_id,package_digest,state,accepted_at_ms)
      VALUES (?,'decision-kept',?,?,'committed',1)`).run(keptCustody,keptPackage,DIGEST);
    value.database.prepare(`INSERT INTO arca_ondeck_runs(on_deck_run_id,custody_id,state,created_at_ms,terminal_at_ms)
      VALUES (?,?,'committed',1,2)`).run(keptOnDeck,keptCustody);
    value.database.prepare(`INSERT INTO arca_shelf_entries(shelf_entry_id,status,created_at_ms) VALUES ('entry-kept','active',1)`).run();
    value.database.prepare(`INSERT INTO arca_ondeck_commit_receipts
      (receipt_id,on_deck_run_id,shelf_entry_id,inventory_revision,deck_fact_revision,commit_digest,committed_at_ms)
      VALUES ('commit-kept',?,'entry-kept',1,1,?,2)`).run(keptOnDeck,DIGEST);
    value.database.prepare('UPDATE libra_runs SET supersedes_run_id=? WHERE libra_run_id=?')
      .run(target.runId,kept.runId);
    value.database.prepare('UPDATE libra_runs SET superseded_by_run_id=? WHERE libra_run_id=?')
      .run(kept.runId,target.runId);

    fs.mkdirSync(path.join(value.transcodeDir, target.workspaceId));
    fs.mkdirSync(path.join(value.transcodeDir, kept.workspaceId));
    const before = inspectPlan(value.database, 'nuclear');
    assert.equal(before.ready, true);
    assert.equal(before.scope.runIds.includes(target.runId), true);
    assert.equal(before.scope.runIds.includes(kept.runId), false);

    const result = applyReset({ database:value.database, mode:'nuclear', dataDir:value.dataDir,
      transcodeDir:value.transcodeDir, nowMs:4000 });
    assert.equal(result.result.deletedRuns, 1);
    assert.equal(value.database.prepare('SELECT COUNT(*) count FROM libra_subjects WHERE subject_id=?').get(target.subjectId).count, 0);
    assert.equal(value.database.prepare('SELECT COUNT(*) count FROM libra_intake_decisions WHERE intake_decision_id=?').get(intakeDecision).count, 0);
    assert.equal(value.database.prepare('SELECT COUNT(*) count FROM arca_ondeck_runs WHERE on_deck_run_id=?').get(targetOnDeck).count, 0);
    assert.equal(value.database.prepare('SELECT COUNT(*) count FROM fx_supporting_works WHERE work_id=?').get(targetExecution.workId).count, 0);
    assert.equal(value.database.prepare('SELECT COUNT(*) count FROM fx_material_controls WHERE material_key=?').get('material-target').count, 0);
    assert.equal(value.database.prepare('SELECT COUNT(*) count FROM libra_subjects WHERE subject_id=?').get(kept.subjectId).count, 1);
    assert.deepEqual(value.database.prepare('SELECT supersedes_run_id,superseded_by_run_id FROM libra_runs WHERE libra_run_id=?')
      .get(kept.runId), { supersedes_run_id:null, superseded_by_run_id:null });
    assert.equal(value.database.prepare('SELECT COUNT(*) count FROM arca_ondeck_commit_receipts WHERE on_deck_run_id=?').get(keptOnDeck).count, 1);
    assert.equal(fs.existsSync(path.join(value.transcodeDir, target.workspaceId)), false);
    assert.equal(fs.existsSync(path.join(value.transcodeDir, kept.workspaceId)), true);
    assert.equal(value.database.pragma('foreign_key_check').length, 0);
  } finally { close(value); }
});

test('Normal Reset retires an Accepted but uncommitted Arca On-deck responsibility', () => {
  const value = fixture('helix-formation-reset-normal-ondeck');
  try {
    const seeded = seedSubjectRun(value.database, 'normal-ondeck');
    const packageId = 'package-normal-ondeck', offerId = 'offer-normal-ondeck', attemptId = 'attempt-normal-ondeck',
      decisionId = 'decision-normal-ondeck', custodyId = 'custody-normal-ondeck', onDeckRunId = 'run-normal-ondeck';
    value.database.prepare(`INSERT INTO libra_product_packages
      (on_deck_package_id,offer_id,package_revision,libra_run_id,run_state_revision,subject_id,
       product_structure_json,production_provenance_json,attestation_json,package_digest,state,published_at_ms)
      VALUES (?,?,1,?,1,?,'{}','{}','{}',?,'published',1)`)
      .run(packageId,offerId,seeded.runId,seeded.subjectId,DIGEST);
    value.database.prepare(`INSERT INTO arca_acceptance_attempts
      (acceptance_attempt_id,offer_id,on_deck_package_id,package_digest,state,created_at_ms,finished_at_ms)
      VALUES (?,?,?,?,'accepted',1,2)`).run(attemptId,offerId,packageId,DIGEST);
    value.database.prepare(`INSERT INTO arca_acceptance_decisions
      (acceptance_decision_id,acceptance_attempt_id,result,offer_id,on_deck_package_id,package_digest,decided_at_ms)
      VALUES (?,?,'accepted',?,?,?,2)`).run(decisionId,attemptId,offerId,packageId,DIGEST);
    value.database.prepare(`INSERT INTO arca_ondeck_custodies
      (custody_id,acceptance_decision_id,on_deck_package_id,package_digest,state,accepted_at_ms)
      VALUES (?,?,?,?,'active',2)`).run(custodyId,decisionId,packageId,DIGEST);
    value.database.prepare(`INSERT INTO arca_handoff_b_receipts
      (receipt_id,acceptance_decision_id,outcome,offer_id,custody_id,on_deck_package_id,package_digest,committed_at_ms)
      VALUES ('receipt-normal-ondeck',?,'accepted',?,?,?,?,2)`)
      .run(decisionId,offerId,custodyId,packageId,DIGEST);
    value.database.prepare(`INSERT INTO arca_ondeck_runs(on_deck_run_id,custody_id,state,created_at_ms)
      VALUES (?,?,'offloading',2)`).run(onDeckRunId,custodyId);
    value.database.prepare(`INSERT INTO arca_material_bindings
      (owner_object_type,owner_object_id,material_key,role,authority_kind,binding_revision,health_state,current)
      VALUES ('on_deck_custody',?,'material-normal-ondeck','primary_payload','product_control',1,'active',1)`).run(custodyId);
    value.database.prepare(`INSERT INTO fx_material_controls(material_key,mount_scope_id,inode,size_bytes,
      fingerprint_algorithm,fingerprint_version,content_fingerprint,owner_domain,owner_scope_type,owner_scope_id,
      control_revision,state,updated_at_ms) VALUES ('material-normal-ondeck','mount','inode-ondeck',1,'middle','1','fp-ondeck','arca','on_deck_custody',?,1,'controlled',1)`)
      .run(custodyId);
    value.database.prepare(`INSERT INTO fx_material_control_revisions(material_key,revision,operation_kind,
      to_owner_domain,to_scope_type,to_scope_id,basis_digest,commit_marker,committed_at_ms)
      VALUES ('material-normal-ondeck',1,'transfer','arca','on_deck_custody',?,?,'normal-ondeck',1)`).run(custodyId,DIGEST);
    const work = seedExecution(value.database, 'arca', 'arca_ondeck_run', onDeckRunId, 'normal-ondeck');
    value.database.prepare(`INSERT INTO libra_formation_projections(subject_id,classification,subject_status,
      display_identity,next_action_label,next_action_state,attention_state,current_package_id,current_offer_id,added_at_ms,updated_at_ms)
      VALUES (?,'in_progress','active','Accepted','整理中','running','none',?,?,1,1)`)
      .run(seeded.subjectId,packageId,offerId);

    applyReset({ database:value.database, mode:'normal', dataDir:value.dataDir,
      transcodeDir:value.transcodeDir, nowMs:4500 });
    assert.deepEqual(value.database.prepare('SELECT state FROM arca_ondeck_custodies WHERE custody_id=?').get(custodyId), { state:'released' });
    assert.deepEqual(value.database.prepare('SELECT state,terminal_at_ms FROM arca_ondeck_runs WHERE on_deck_run_id=?').get(onDeckRunId),
      { state:'blocked', terminal_at_ms:4500 });
    assert.deepEqual(value.database.prepare('SELECT state FROM fx_supporting_works WHERE work_id=?').get(work.workId), { state:'cancelled' });
    assert.deepEqual(value.database.prepare('SELECT state,owner_domain FROM fx_material_controls WHERE material_key=?').get('material-normal-ondeck'),
      { state:'released', owner_domain:null });
    assert.equal(value.database.prepare('SELECT COUNT(*) count FROM libra_formation_projections WHERE subject_id=?').get(seeded.subjectId).count, 0);
  } finally { close(value); }
});

test('Formation Reset rejects broad transcode roots', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-formation-reset-guard-'));
  const dataDir = path.join(root, 'data');
  fs.mkdirSync(dataDir);
  try {
    assert.throws(() => assertSafeTranscodeRoot(path.parse(root).root, dataDir), /UNSAFE_TRANSCODE_ROOT/);
    assert.throws(() => assertSafeTranscodeRoot(root, dataDir), /UNSAFE_TRANSCODE_ROOT/);
    assert.throws(() => assertSafeTranscodeRoot(dataDir, dataDir), /UNSAFE_TRANSCODE_ROOT/);
  } finally { fs.rmSync(root, { recursive:true, force:true }); }
});

test('Nuclear Reset rolls the whole database graph back when a delete fails', () => {
  const value = fixture('helix-formation-reset-rollback');
  try {
    const seeded = seedSubjectRun(value.database, 'rollback');
    seedExecution(value.database, 'libra', 'libra_run', seeded.runId, 'rollback');
    value.database.exec(`CREATE TRIGGER block_nuclear_run_delete BEFORE DELETE ON libra_runs
      BEGIN SELECT RAISE(ABORT, 'forced reset failure'); END`);
    assert.throws(() => applyReset({ database:value.database, mode:'nuclear', dataDir:value.dataDir,
      transcodeDir:value.transcodeDir, nowMs:5000 }), /forced reset failure/);
    assert.equal(value.database.prepare('SELECT COUNT(*) count FROM libra_subjects WHERE subject_id=?').get(seeded.subjectId).count, 1);
    assert.equal(value.database.prepare('SELECT COUNT(*) count FROM libra_runs WHERE libra_run_id=?').get(seeded.runId).count, 1);
    assert.equal(value.database.prepare('SELECT COUNT(*) count FROM fx_supporting_works WHERE process_id=?').get(seeded.runId).count, 1);
    assert.equal(value.database.pragma('foreign_keys', { simple:true }), 1);
    assert.equal(value.database.pragma('foreign_key_check').length, 0);
  } finally { close(value); }
});
