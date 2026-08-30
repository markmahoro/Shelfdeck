'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { canonicalDigest } = require('../src/helix/contracts/canonical-json');

const CONFIRMATION = 'PROD034_RELEASE_ABORTED_HANDOFFS_V1';
const CORRECTION_SCHEMA = 'prod034.release-aborted-handoff@1';
const TARGETS = Object.freeze([
  Object.freeze({
    label:'唐人街探案 (2015)',
    subjectId:'libra-subject-85679e1ede4cecf2049d91b710e8472da7cf7c13',
    libraRunId:'1bbe89dc594f7b44cb809a685f6eb947b8384b3ed7252a985f6c85fb80ffd722',
    packageId:'e273c7d555595ea33e8761fed2d400620490695aca9dbd970ee81fbaeae58484',
    packageDigest:'c3eff0e222fb72bf11d8c129d5ea34755c8608d13ff1d03b6cc7b112ca5e9d88',
    offerId:'fdcff116ebb3817cebf1cb5857ca4643a817701b31db5c2f2d7bb5694c5ed35f',
    custodyId:'d93eea6eb28a12bfedd2b270d45d2eb50f0f9d10231c4bc9412db1ef6e4e7501',
    onDeckRunId:'fe3ed89c281662db25f5e5847817b80c509ca723891ec21d292edfdf906cb522',
    controlledMaterialCount:4,
    activeBindingCount:10,
  }),
  Object.freeze({
    label:'赤壁（上） (2008)',
    subjectId:'libra-subject-e8eced48d62bf1cf5dd4907d6edfa49f4123e7e3',
    libraRunId:'e70c731f18acc93e71633609f1f59e4d71e52608143a7c36bc783109ccda347a',
    packageId:'e7bc7f91bf4eb782b81b47834fddc0411eba79999ed8da54497f905cdf6b1008',
    packageDigest:'c093177ad85d681b6e3ccb1cfcffab050d615c28f3c2d48566e8f77220767801',
    offerId:'3cc44757b7b56fb6885f7896627c0ab260fe2e0a5e8d5714019b06a89e5d693f',
    custodyId:'9f240b97e61dc3a2637d712a9f589dd80e4ca3a0ed39d6af17f15997b7b616be',
    onDeckRunId:'32bab97ac9fb81ae65d67a0833beb5bcfb6feb00c6d4a2f3f07fb03d52de5074',
    controlledMaterialCount:3,
    activeBindingCount:25,
  }),
]);

function valueAfter(args, flag) {
  const assigned = args.find((arg) => arg.startsWith(`${flag}=`));
  if (assigned) return assigned.slice(flag.length + 1);
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function one(database, sql, values = []) {
  return database.prepare(sql).get(...values) || null;
}

function all(database, sql, values = []) {
  return database.prepare(sql).all(...values);
}

function correctionBasis(target) {
  return Object.freeze({ schema:CORRECTION_SCHEMA, incidentId:'PROD-034', correctionKind:'release_aborted_handoff',
    subjectId:target.subjectId, libraRunId:target.libraRunId, packageId:target.packageId,
    offerId:target.offerId, custodyId:target.custodyId, onDeckRunId:target.onDeckRunId });
}

function inspectTarget(database, target) {
  const subject = one(database, 'SELECT subject_id,status FROM libra_subjects WHERE subject_id=?', [target.subjectId]);
  const run = one(database, 'SELECT libra_run_id,subject_id,state,state_revision FROM libra_runs WHERE libra_run_id=?', [target.libraRunId]);
  const productPackage = one(database, 'SELECT on_deck_package_id,offer_id,libra_run_id,subject_id,package_digest,state FROM libra_product_packages WHERE on_deck_package_id=?', [target.packageId]);
  const custody = one(database, 'SELECT custody_id,on_deck_package_id,package_digest,state FROM arca_ondeck_custodies WHERE custody_id=?', [target.custodyId]);
  const onDeckRun = one(database, 'SELECT on_deck_run_id,custody_id,state FROM arca_ondeck_runs WHERE on_deck_run_id=?', [target.onDeckRunId]);
  const controls = all(database, "SELECT material_key,control_revision,state,owner_domain,owner_scope_type,owner_scope_id FROM fx_material_controls WHERE owner_scope_id=? ORDER BY material_key", [target.custodyId]);
  const bindings = all(database, "SELECT material_key,role,binding_revision,health_state,current FROM arca_material_bindings WHERE owner_object_type='on_deck_custody' AND owner_object_id=? ORDER BY material_key,role,binding_revision", [target.custodyId]);
  const projection = one(database, 'SELECT subject_id,classification,current_libra_run_id,current_package_id,current_offer_id,next_action_label FROM libra_formation_projections WHERE subject_id=?', [target.subjectId]);
  const works = all(database, 'SELECT work_id,state FROM fx_supporting_works WHERE owner_domain=\'arca\' AND process_type=\'arca_ondeck_run\' AND process_id=?', [target.onDeckRunId]);
  const activeAttemptCount = Number(one(database, "SELECT COUNT(*) AS count FROM fx_work_attempts a JOIN fx_supporting_works w ON w.work_id=a.work_id WHERE w.process_id=? AND a.state IN ('ready','running','blocked')", [target.onDeckRunId])?.count || 0);
  const commitCount = Number(one(database, 'SELECT COUNT(*) AS count FROM arca_ondeck_commit_receipts WHERE on_deck_run_id=?', [target.onDeckRunId])?.count || 0);
  const activeControls = controls.filter((row) => row.state === 'controlled');
  const activeBindings = bindings.filter((row) => row.health_state === 'active' && Number(row.current) === 1);
  const released = custody?.state === 'released' && activeControls.length === 0 && activeBindings.length === 0;
  const errors = [];
  if (!subject || subject.status !== 'active') errors.push('subject_not_active');
  if (!run || run.subject_id !== target.subjectId || run.state !== 'discarded') errors.push('libra_run_not_discarded');
  if (!productPackage || productPackage.offer_id !== target.offerId || productPackage.libra_run_id !== target.libraRunId ||
      productPackage.subject_id !== target.subjectId || productPackage.package_digest !== target.packageDigest || productPackage.state !== 'published') errors.push('package_mismatch');
  if (!custody || custody.on_deck_package_id !== target.packageId || custody.package_digest !== target.packageDigest || !['active','released'].includes(custody.state)) errors.push('custody_mismatch');
  if (!onDeckRun || onDeckRun.custody_id !== target.custodyId || onDeckRun.state !== 'blocked') errors.push('on_deck_run_not_blocked');
  if (commitCount !== 0) errors.push('on_deck_commit_exists');
  if (works.length !== 1 || works[0].state !== 'failed') errors.push('arca_work_not_failed');
  if (activeAttemptCount !== 0) errors.push('arca_attempt_still_active');
  if (!released && activeControls.length !== target.controlledMaterialCount) errors.push('controlled_material_count_changed');
  if (!released && activeBindings.length !== target.activeBindingCount) errors.push('active_binding_count_changed');
  if (!released && projection && (projection.classification !== 'in_progress' || projection.current_package_id !== target.packageId || projection.current_offer_id !== target.offerId)) errors.push('projection_mismatch');
  return Object.freeze({ target, subject, run, productPackage, custody, onDeckRun, controls:Object.freeze(controls),
    bindingCount:bindings.length, activeBindingCount:activeBindings.length, projection, works:Object.freeze(works),
    activeAttemptCount, commitCount, released, errors:Object.freeze(errors) });
}

function inspectPlan(database) {
  const targets = TARGETS.map((target) => inspectTarget(database, target));
  return Object.freeze({ targets:Object.freeze(targets), ready:targets.every((item) => item.errors.length === 0),
    alreadyCorrected:targets.every((item) => item.released && !item.projection),
    totals:Object.freeze({ controlledMaterials:targets.reduce((sum, item) => sum + item.controls.filter((row) => row.state === 'controlled').length, 0),
      activeBindings:targets.reduce((sum, item) => sum + item.activeBindingCount, 0),
      staleProjections:targets.filter((item) => Boolean(item.projection)).length }) });
}

function applyCorrection(database, nowMs) {
  const plan = inspectPlan(database);
  if (!plan.ready) {
    const error = new Error('PROD034_TARGET_STATE_MISMATCH');
    error.details = plan.targets.map((item) => ({ label:item.target.label, errors:item.errors }));
    throw error;
  }
  if (plan.alreadyCorrected) return Object.freeze({ replayed:true, releasedControls:0, releasedBindings:0, removedProjections:0 });
  const transaction = database.transaction(() => {
    let releasedControls = 0;
    let releasedBindings = 0;
    let removedProjections = 0;
    for (const item of plan.targets) {
      const basisDigest = canonicalDigest(correctionBasis(item.target));
      const commitMarker = `prod034-release-${canonicalDigest({ schema:CORRECTION_SCHEMA, custodyId:item.target.custodyId })}`;
      for (const control of item.controls.filter((row) => row.state === 'controlled')) {
        const nextRevision = Number(control.control_revision) + 1;
        const changed = database.prepare(`
          UPDATE fx_material_controls
             SET owner_domain=NULL,owner_scope_type=NULL,owner_scope_id=NULL,
                 control_revision=?,state='released',updated_at_ms=?
           WHERE material_key=? AND control_revision=? AND state='controlled'
             AND owner_domain='arca' AND owner_scope_type='on_deck_custody' AND owner_scope_id=?
        `).run(nextRevision, nowMs, control.material_key, control.control_revision, item.target.custodyId).changes;
        if (changed !== 1) throw new Error('PROD034_MATERIAL_CONTROL_CAS');
        database.prepare(`
          INSERT INTO fx_material_control_revisions
            (material_key,revision,operation_kind,from_owner_domain,from_scope_type,from_scope_id,
             to_owner_domain,to_scope_type,to_scope_id,basis_digest,commit_marker,committed_at_ms)
          VALUES (?,?,'release','arca','on_deck_custody',?,NULL,NULL,NULL,?,?,?)
        `).run(control.material_key, nextRevision, item.target.custodyId, basisDigest, commitMarker, nowMs);
        releasedControls += 1;
      }
      releasedBindings += database.prepare(`
        UPDATE arca_material_bindings SET health_state='released'
         WHERE owner_object_type='on_deck_custody' AND owner_object_id=?
           AND current=1 AND health_state='active'
      `).run(item.target.custodyId).changes;
      if (item.custody.state === 'active') {
        const changed = database.prepare("UPDATE arca_ondeck_custodies SET state='released' WHERE custody_id=? AND state='active'")
          .run(item.target.custodyId).changes;
        if (changed !== 1) throw new Error('PROD034_CUSTODY_CAS');
      }
      if (item.projection) {
        removedProjections += database.prepare(`
          DELETE FROM libra_formation_projections
           WHERE subject_id=? AND classification='in_progress'
             AND current_libra_run_id IS NULL AND current_package_id=? AND current_offer_id=?
        `).run(item.target.subjectId, item.target.packageId, item.target.offerId).changes;
      }
    }
    return Object.freeze({ replayed:false, releasedControls, releasedBindings, removedProjections });
  });
  const result = transaction();
  const after = inspectPlan(database);
  const bad = after.targets.filter((item) => !item.released || item.projection || item.errors.length > 0);
  if (bad.length) throw new Error('PROD034_POSTCONDITION_FAILED');
  return Object.freeze(result);
}

function main(argv = process.argv.slice(2)) {
  const dataDir = path.resolve(valueAfter(argv, '--data-dir') || process.env.MEDIA_SERVICE_DATA_DIR || path.join(__dirname, '..', 'data'));
  const databasePath = path.join(dataDir, 'shelfdeck.db');
  if (!fs.existsSync(databasePath)) throw new Error(`Database not found: ${databasePath}`);
  const database = new Database(databasePath);
  try {
    database.pragma('foreign_keys = ON');
    if (!argv.includes('--apply')) return Object.freeze({ operation:'prod034_one_time_correction', confirmationRequired:CONFIRMATION, dataDir, plan:inspectPlan(database) });
    if (valueAfter(argv, '--confirm') !== CONFIRMATION) throw new Error('PROD034_CONFIRMATION_REQUIRED');
    const result = applyCorrection(database, Date.now());
    const integrity = database.pragma('integrity_check', { simple:true });
    if (integrity !== 'ok') throw new Error(`Integrity check failed: ${integrity}`);
    return Object.freeze({ applied:true, dataDir, result, integrity, plan:inspectPlan(database) });
  } finally { database.close(); }
}

if (require.main === module) {
  try { process.stdout.write(`${JSON.stringify(main(), null, 2)}\n`); }
  catch (error) {
    process.stderr.write(`${JSON.stringify({ error:{ code:error.message, message:error.message, details:error.details || null } }, null, 2)}\n`);
    process.exitCode = 1;
  }
}

module.exports = Object.freeze({ CONFIRMATION, CORRECTION_SCHEMA, TARGETS, inspectPlan, applyCorrection });
