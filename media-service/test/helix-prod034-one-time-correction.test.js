'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { TARGETS, inspectPlan, applyCorrection } = require('../scripts/helix-prod034-one-time-correction');

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shelfdeck-prod034-'));
  const database = new Database(path.join(directory, 'shelfdeck.db'));
  const schema = fs.readFileSync(path.join(__dirname, '..', 'src', 'helix', 'foundation', 'persistence', 'generated', 'clean-schema.sql'), 'utf8');
  database.exec(schema);
  for (const [targetIndex, target] of TARGETS.entries()) {
    database.prepare("INSERT INTO libra_subjects(subject_id,status) VALUES (?,'active')").run(target.subjectId);
    database.prepare("INSERT INTO libra_runs(libra_run_id,subject_id,state,state_revision) VALUES (?,?,'discarded',4)").run(target.libraRunId, target.subjectId);
    database.prepare("INSERT INTO libra_product_packages(on_deck_package_id,offer_id,libra_run_id,subject_id,package_digest,state) VALUES (?,?,?,?,?,'published')")
      .run(target.packageId, target.offerId, target.libraRunId, target.subjectId, target.packageDigest);
    database.prepare("INSERT INTO arca_ondeck_custodies(custody_id,on_deck_package_id,package_digest,state) VALUES (?,?,?,'active')")
      .run(target.custodyId, target.packageId, target.packageDigest);
    database.prepare("INSERT INTO arca_ondeck_runs(on_deck_run_id,custody_id,state) VALUES (?,?,'blocked')")
      .run(target.onDeckRunId, target.custodyId);
    database.prepare("INSERT INTO fx_supporting_works(work_id,owner_domain,process_type,process_id,state,definition_json) VALUES (?,'arca','arca_ondeck_run',?,'failed','{}')")
      .run(`work-${targetIndex}`, target.onDeckRunId);
    database.prepare("INSERT INTO libra_formation_projections(subject_id,classification,current_package_id,current_offer_id) VALUES (?,'in_progress',?,?)")
      .run(target.subjectId, target.packageId, target.offerId);
    for (let index = 0; index < target.controlledMaterialCount; index += 1) {
      const materialKey = String(targetIndex * 100 + index + 1).padStart(64, '0');
      database.prepare("INSERT INTO fx_material_controls(material_key,owner_domain,owner_scope_type,owner_scope_id,control_revision,state) VALUES (?,'arca','on_deck_custody',?,2,'controlled')")
        .run(materialKey, target.custodyId);
    }
    for (let index = 0; index < target.activeBindingCount; index += 1) {
      const materialKey = String(targetIndex * 1000 + index + 1).padStart(64, '0');
      database.prepare("INSERT INTO arca_material_bindings(owner_object_type,owner_object_id,material_key,role,binding_revision,health_state,current,episode_claims_json) VALUES ('on_deck_custody',?,?,?,1,'active',1,'{}')")
        .run(target.custodyId, materialKey, `role-${index}`);
    }
  }
  return { directory, database };
}

test('PROD-034 releases only the exact aborted handoffs and removes stale projections', () => {
  const { directory, database } = fixture();
  try {
    const before = inspectPlan(database);
    assert.equal(before.ready, true);
    assert.deepEqual(before.totals, { controlledMaterials:7, activeBindings:35, staleProjections:2 });

    const result = applyCorrection(database, 123456);
    assert.deepEqual(result, { replayed:false, releasedControls:7, releasedBindings:35, removedProjections:2 });
    const after = inspectPlan(database);
    assert.equal(after.ready, true);
    assert.equal(after.alreadyCorrected, true);
    assert.deepEqual(after.totals, { controlledMaterials:0, activeBindings:0, staleProjections:0 });
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM fx_material_control_revisions WHERE operation_kind='release'").get().count, 7);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM arca_ondeck_custodies WHERE state='released'").get().count, 2);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM libra_runs WHERE state='discarded'").get().count, 2);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM fx_supporting_works').get().count, 2);

    assert.deepEqual(applyCorrection(database, 123457), { replayed:true, releasedControls:0, releasedBindings:0, removedProjections:0 });
  } finally {
    database.close();
    fs.rmSync(directory, { recursive:true, force:true });
  }
});

test('PROD-034 fails closed when a target has an active Attempt', () => {
  const { directory, database } = fixture();
  try {
    database.prepare("INSERT INTO fx_work_attempts(attempt_id,work_id,state) VALUES ('active-attempt','work-0','running')").run();
    const plan = inspectPlan(database);
    assert.equal(plan.ready, false);
    assert.ok(plan.targets[0].errors.includes('arca_attempt_still_active'));
    assert.throws(() => applyCorrection(database, 123456), /PROD034_TARGET_STATE_MISMATCH/);
  } finally {
    database.close();
    fs.rmSync(directory, { recursive:true, force:true });
  }
});
