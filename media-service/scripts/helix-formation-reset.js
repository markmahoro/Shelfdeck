'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { canonicalDigest, canonicalJson } = require('../src/helix/contracts/canonical-json');
const { activeRunScopeSetDigest } = require('../src/helix/domains/libra/model/run-admission-contracts');
const { runStateDigest } = require('../src/helix/domains/libra/model/run-lifecycle-contracts');
const { emptyReferenceSetDigest, workspaceStateDigest } = require('../src/helix/domains/libra/model/workspace-admission-contracts');

const MODES = Object.freeze(['normal', 'nuclear']);
const CONFIRMATIONS = Object.freeze({
  normal: 'FORMATION_RESET_NORMAL_V1',
  nuclear: 'FORMATION_RESET_NUCLEAR_V1',
});
const RESET_SCHEMA = 'helix.formation-reset@1';
const RESET_FAILURE_CODE = 'FORMATION_RESET';
const ACTIVE_RUN_STATES = Object.freeze(['active', 'suspended', 'frozen']);
const ACTIVE_WORK_STATES = Object.freeze(['admitted', 'ready', 'running', 'blocked']);
const ACTIVE_ATTEMPT_STATES = Object.freeze(['ready', 'running', 'blocked']);
const ACTIVE_EVENT_STATES = Object.freeze([
  'pending', 'ready', 'waiting_for_resource', 'waiting_for_external',
  'waiting_for_approval', 'executing',
]);

function valueAfter(args, flag) {
  const assigned = args.find((arg) => arg.startsWith(`${flag}=`));
  if (assigned) return assigned.slice(flag.length + 1);
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function parseMode(args) {
  const mode = valueAfter(args, '--mode');
  if (!MODES.includes(mode)) throw new Error('FORMATION_RESET_MODE_REQUIRED');
  return mode;
}

function oneColumn(database, sql, params = []) {
  return database.prepare(sql).all(...params).map((row) => String(Object.values(row)[0]));
}

function unique(values) {
  return [...new Set(values.filter((value) => value !== null && value !== undefined).map(String))].sort();
}

function chunks(values, maximum = 400) {
  const result = [];
  for (let index = 0; index < values.length; index += maximum) result.push(values.slice(index, index + maximum));
  return result;
}

function placeholders(values) {
  return values.map(() => '?').join(',');
}

function rowsByIds(database, sqlPrefix, ids, sqlSuffix = '', extra = []) {
  if (!ids.length) return [];
  return chunks(ids).flatMap((part) => database.prepare(
    `${sqlPrefix} (${placeholders(part)}) ${sqlSuffix}`,
  ).all(...part, ...extra));
}

function executeByIds(database, sqlPrefix, ids, sqlSuffix = '', extra = []) {
  let changes = 0;
  for (const part of chunks(ids)) {
    changes += database.prepare(`${sqlPrefix} (${placeholders(part)}) ${sqlSuffix}`).run(...extra, ...part).changes;
  }
  return changes;
}

function tableExists(database, tableName) {
  return Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(tableName));
}

function assertRequiredSchema(database) {
  const required = [
    'libra_subjects', 'libra_intake_decisions', 'libra_predeck_pipeline_tokens', 'libra_runs', 'libra_workspaces',
    'libra_product_packages', 'libra_formation_projections', 'arca_acceptance_attempts',
    'arca_acceptance_decisions', 'arca_ondeck_custodies', 'arca_ondeck_runs',
    'arca_ondeck_commit_receipts', 'fx_supporting_works', 'fx_work_attempts',
    'fx_workflow_events', 'fx_material_controls', 'fx_material_control_revisions',
  ];
  const missing = required.filter((table) => !tableExists(database, table));
  if (missing.length) {
    const error = new Error('FORMATION_RESET_SCHEMA_UNSUPPORTED');
    error.details = { missingTables: missing };
    throw error;
  }
}

function discoverScope(database) {
  assertRequiredSchema(database);
  const orphanPipelineTokens = database.prepare(`
    SELECT token.subject_id,token.source_field_id,token.source_process_id,token.acquired_at_ms
      FROM libra_predeck_pipeline_tokens token
      LEFT JOIN libra_subjects subject ON subject.subject_id=token.subject_id
     WHERE subject.subject_id IS NULL
     ORDER BY token.subject_id
  `).all();
  const orphanPipelineTokenSubjectIds = unique(orphanPipelineTokens.map((row) => row.subject_id));
  const orphanPipelineSourceProcessIds = unique(orphanPipelineTokens.map((row) => row.source_process_id));
  const orphanPipelineAdmissionReceipts = database.prepare(`
    SELECT receipt.command_receipt_id,receipt.target_id,token.source_process_id
      FROM libra_predeck_pipeline_tokens token
      LEFT JOIN libra_subjects subject ON subject.subject_id=token.subject_id
      JOIN fx_command_receipts receipt
        ON receipt.owner_domain='libra'
       AND receipt.command_contract='helix.foundation.work.submit@1'
       AND receipt.caller_scope='libra:' || token.source_process_id || '/evidence'
      LEFT JOIN fx_supporting_works target_work ON target_work.work_id=receipt.target_id
     WHERE subject.subject_id IS NULL AND target_work.work_id IS NULL
     ORDER BY receipt.command_receipt_id
  `).all();
  const orphanPipelineAdmissionReceiptIds = unique(orphanPipelineAdmissionReceipts.map((row) => row.command_receipt_id));
  const orphanPipelineAdmissionTargetIds = unique(orphanPipelineAdmissionReceipts.map((row) => row.target_id));
  const phantomLibraAdmissionReceipts = database.prepare(`
    SELECT receipt.command_receipt_id,receipt.caller_scope,receipt.target_id,receipt.committed_at_ms
      FROM fx_command_receipts receipt
      LEFT JOIN fx_supporting_works target_work ON target_work.work_id=receipt.target_id
     WHERE receipt.owner_domain='libra'
       AND receipt.command_contract='helix.foundation.work.submit@1'
       AND target_work.work_id IS NULL
     ORDER BY receipt.command_receipt_id
  `).all();
  const phantomLibraAdmissionReceiptIds = unique(phantomLibraAdmissionReceipts.map((row) => row.command_receipt_id));
  const committedOnDeckRunIds = oneColumn(database, `
    SELECT DISTINCT on_deck_run_id FROM arca_ondeck_commit_receipts ORDER BY on_deck_run_id
  `);
  const committedPackageIds = oneColumn(database, `
    SELECT DISTINCT c.on_deck_package_id
      FROM arca_ondeck_commit_receipts cr
      JOIN arca_ondeck_runs r ON r.on_deck_run_id=cr.on_deck_run_id
      JOIN arca_ondeck_custodies c ON c.custody_id=r.custody_id
     ORDER BY c.on_deck_package_id
  `);
  const committedRunIds = oneColumn(database, `
    SELECT DISTINCT p.libra_run_id
      FROM libra_product_packages p
      JOIN arca_ondeck_custodies c ON c.on_deck_package_id=p.on_deck_package_id
      JOIN arca_ondeck_runs r ON r.custody_id=c.custody_id
      JOIN arca_ondeck_commit_receipts cr ON cr.on_deck_run_id=r.on_deck_run_id
     ORDER BY p.libra_run_id
  `);
  const committedSubjectIds = oneColumn(database, `
    SELECT DISTINCT p.subject_id
      FROM libra_product_packages p
      JOIN arca_ondeck_custodies c ON c.on_deck_package_id=p.on_deck_package_id
      JOIN arca_ondeck_runs r ON r.custody_id=c.custody_id
      JOIN arca_ondeck_commit_receipts cr ON cr.on_deck_run_id=r.on_deck_run_id
     ORDER BY p.subject_id
  `);
  const packageIds = oneColumn(database, `
    SELECT p.on_deck_package_id
      FROM libra_product_packages p
     WHERE NOT EXISTS (
       SELECT 1 FROM arca_ondeck_custodies c
       JOIN arca_ondeck_runs r ON r.custody_id=c.custody_id
       JOIN arca_ondeck_commit_receipts cr ON cr.on_deck_run_id=r.on_deck_run_id
       WHERE c.on_deck_package_id=p.on_deck_package_id
     ) ORDER BY p.on_deck_package_id
  `);
  const runIds = oneColumn(database, `
    SELECT r.libra_run_id
      FROM libra_runs r
     WHERE NOT EXISTS (
       SELECT 1 FROM libra_product_packages p
       JOIN arca_ondeck_custodies c ON c.on_deck_package_id=p.on_deck_package_id
       JOIN arca_ondeck_runs ar ON ar.custody_id=c.custody_id
       JOIN arca_ondeck_commit_receipts cr ON cr.on_deck_run_id=ar.on_deck_run_id
       WHERE p.libra_run_id=r.libra_run_id
     ) ORDER BY r.libra_run_id
  `);
  const disposableSubjectIds = oneColumn(database, `
    SELECT s.subject_id
      FROM libra_subjects s
     WHERE NOT EXISTS (
       SELECT 1 FROM libra_product_packages p
       JOIN arca_ondeck_custodies c ON c.on_deck_package_id=p.on_deck_package_id
       JOIN arca_ondeck_runs r ON r.custody_id=c.custody_id
       JOIN arca_ondeck_commit_receipts cr ON cr.on_deck_run_id=r.on_deck_run_id
       WHERE p.subject_id=s.subject_id
     ) ORDER BY s.subject_id
  `);
  const runSubjectIds = runIds.length
    ? rowsByIds(database, 'SELECT DISTINCT subject_id FROM libra_runs WHERE libra_run_id IN', runIds, 'ORDER BY subject_id')
      .map((row) => row.subject_id).filter(Boolean)
    : [];
  const resetSubjectIds = unique([...disposableSubjectIds, ...runSubjectIds]);
  const pipelineTokenSubjectIds = unique([...resetSubjectIds, ...orphanPipelineTokenSubjectIds]);
  const workspaceIds = runIds.length
    ? rowsByIds(database, 'SELECT workspace_id FROM libra_workspaces WHERE libra_run_id IN', runIds, 'ORDER BY workspace_id')
      .map((row) => row.workspace_id)
    : [];
  const cleanupScopeIds = runIds.length
    ? rowsByIds(database, 'SELECT cleanup_scope_id FROM libra_workspace_cleanup_scopes WHERE libra_run_id IN', runIds, 'ORDER BY cleanup_scope_id')
      .map((row) => row.cleanup_scope_id)
    : [];
  const onDeckRunIds = oneColumn(database, `
    SELECT r.on_deck_run_id FROM arca_ondeck_runs r
     WHERE NOT EXISTS (SELECT 1 FROM arca_ondeck_commit_receipts cr WHERE cr.on_deck_run_id=r.on_deck_run_id)
     ORDER BY r.on_deck_run_id
  `);
  const custodyIds = unique([
    ...rowsByIds(database, 'SELECT DISTINCT custody_id FROM arca_ondeck_runs WHERE on_deck_run_id IN', onDeckRunIds)
      .map((row) => row.custody_id).filter(Boolean),
    ...rowsByIds(database, 'SELECT custody_id FROM arca_ondeck_custodies WHERE on_deck_package_id IN', packageIds)
      .map((row) => row.custody_id).filter(Boolean),
  ]);
  const acceptanceDecisionIds = unique([
    ...rowsByIds(database, 'SELECT acceptance_decision_id FROM arca_ondeck_custodies WHERE custody_id IN', custodyIds)
      .map((row) => row.acceptance_decision_id).filter(Boolean),
    ...rowsByIds(database, 'SELECT acceptance_decision_id FROM arca_acceptance_decisions WHERE on_deck_package_id IN', packageIds)
      .map((row) => row.acceptance_decision_id).filter(Boolean),
    ...oneColumn(database, "SELECT acceptance_decision_id FROM arca_acceptance_decisions WHERE result='rejected' ORDER BY acceptance_decision_id"),
  ]);
  const acceptanceAttemptIds = unique([
    ...rowsByIds(database, 'SELECT acceptance_attempt_id FROM arca_acceptance_decisions WHERE acceptance_decision_id IN', acceptanceDecisionIds)
      .map((row) => row.acceptance_attempt_id).filter(Boolean),
    ...rowsByIds(database, 'SELECT acceptance_attempt_id FROM arca_acceptance_attempts WHERE on_deck_package_id IN', packageIds)
      .map((row) => row.acceptance_attempt_id).filter(Boolean),
  ]);
  const offerIds = unique([
    ...rowsByIds(database, 'SELECT offer_id FROM libra_product_packages WHERE on_deck_package_id IN', packageIds)
      .map((row) => row.offer_id).filter(Boolean),
    ...rowsByIds(database, 'SELECT offer_id FROM arca_acceptance_attempts WHERE acceptance_attempt_id IN', acceptanceAttemptIds)
      .map((row) => row.offer_id).filter(Boolean),
  ]);
  const intakeDecisionIds = unique([
    ...rowsByIds(database, 'SELECT intake_decision_id FROM libra_intake_decisions WHERE target_subject_id IN', disposableSubjectIds)
      .map((row) => row.intake_decision_id),
    ...oneColumn(database, "SELECT intake_decision_id FROM libra_intake_decisions WHERE decision_kind='rejected_acceptance' ORDER BY intake_decision_id"),
  ]);
  const artifactIds = unique([
    ...rowsByIds(database, 'SELECT artifact_handle_id FROM libra_product_package_artifact_refs WHERE on_deck_package_id IN', packageIds)
      .map((row) => row.artifact_handle_id),
    ...rowsByIds(database, "SELECT artifact_handle_id FROM fx_artifact_registry WHERE owner_scope_id IN", unique([...packageIds, ...workspaceIds]), "AND owner_domain='libra'")
      .map((row) => row.artifact_handle_id),
  ]);
  const materialKeys = unique([
    ...rowsByIds(database, 'SELECT material_key FROM libra_material_bindings WHERE subject_id IN', resetSubjectIds)
      .map((row) => row.material_key),
    ...rowsByIds(database, "SELECT material_key FROM arca_material_bindings WHERE owner_object_id IN", custodyIds, "AND owner_object_type='on_deck_custody'")
      .map((row) => row.material_key),
    ...rowsByIds(database, 'SELECT material_key FROM libra_product_package_materials WHERE on_deck_package_id IN', packageIds)
      .map((row) => row.material_key),
    ...rowsByIds(database, 'SELECT material_key FROM fx_workspace_materials WHERE workspace_id IN', workspaceIds)
      .map((row) => row.material_key),
  ]);
  const allScopeIds = unique([
    ...resetSubjectIds, ...runIds, ...workspaceIds, ...cleanupScopeIds, ...packageIds,
    ...offerIds, ...intakeDecisionIds, ...acceptanceAttemptIds, ...acceptanceDecisionIds,
    ...custodyIds, ...onDeckRunIds, ...orphanPipelineTokenSubjectIds, ...orphanPipelineSourceProcessIds,
    ...orphanPipelineAdmissionTargetIds,
  ]);
  const works = [];
  if (allScopeIds.length) {
    for (const part of chunks(allScopeIds)) {
      works.push(...database.prepare(`
        SELECT work_id,owner_domain,process_type,process_id,state
          FROM fx_supporting_works
         WHERE owner_domain IN ('libra','arca') AND process_id IN (${placeholders(part)})
         ORDER BY work_id
      `).all(...part));
    }
  }
  return Object.freeze({
    committed: Object.freeze({ onDeckRunIds:committedOnDeckRunIds, packageIds:committedPackageIds,
      runIds:committedRunIds, subjectIds:committedSubjectIds }),
    disposableSubjectIds:Object.freeze(disposableSubjectIds), resetSubjectIds:Object.freeze(resetSubjectIds),
    pipelineTokenSubjectIds:Object.freeze(pipelineTokenSubjectIds),
    orphanPipelineTokens:Object.freeze(orphanPipelineTokens.map((row) => Object.freeze({ ...row }))),
    orphanPipelineSourceProcessIds:Object.freeze(orphanPipelineSourceProcessIds),
    orphanPipelineAdmissionReceipts:Object.freeze(orphanPipelineAdmissionReceipts.map((row) => Object.freeze({ ...row }))),
    orphanPipelineAdmissionReceiptIds:Object.freeze(orphanPipelineAdmissionReceiptIds),
    orphanPipelineAdmissionTargetIds:Object.freeze(orphanPipelineAdmissionTargetIds),
    phantomLibraAdmissionReceipts:Object.freeze(phantomLibraAdmissionReceipts.map((row) => Object.freeze({ ...row }))),
    phantomLibraAdmissionReceiptIds:Object.freeze(phantomLibraAdmissionReceiptIds),
    runIds:Object.freeze(runIds), workspaceIds:Object.freeze(workspaceIds), cleanupScopeIds:Object.freeze(cleanupScopeIds),
    packageIds:Object.freeze(packageIds), offerIds:Object.freeze(offerIds), intakeDecisionIds:Object.freeze(intakeDecisionIds),
    acceptanceAttemptIds:Object.freeze(acceptanceAttemptIds), acceptanceDecisionIds:Object.freeze(acceptanceDecisionIds),
    custodyIds:Object.freeze(custodyIds), onDeckRunIds:Object.freeze(onDeckRunIds), artifactIds:Object.freeze(artifactIds),
    materialKeys:Object.freeze(materialKeys), allScopeIds:Object.freeze(allScopeIds), works:Object.freeze(works),
  });
}

function controlBelongsToScope(row, scope) {
  if (!row || row.state !== 'controlled') return false;
  if (row.owner_domain === 'libra') {
    if (row.owner_scope_type === 'subject') return scope.resetSubjectIds.includes(row.owner_scope_id);
    if (row.owner_scope_type === 'on_deck_package') return scope.packageIds.includes(row.owner_scope_id);
    if (row.owner_scope_type === 'libra_run') return scope.runIds.includes(row.owner_scope_id);
    if (row.owner_scope_type === 'workspace') return scope.workspaceIds.includes(row.owner_scope_id);
    return false;
  }
  if (row.owner_domain === 'arca') {
    return row.owner_scope_type === 'on_deck_custody' && scope.custodyIds.includes(row.owner_scope_id);
  }
  return false;
}

function controlIsPreservedProcurement(row) {
  return Boolean(row && row.state === 'controlled' && row.owner_domain === 'procurement');
}

function discoverOrphans(database, scope) {
  const acceptedSubjectIds = oneColumn(database, `
    SELECT DISTINCT s.subject_id
      FROM libra_subjects s
      JOIN libra_handoff_a_receipts receipt
        ON receipt.subject_id=s.subject_id AND receipt.outcome='accepted'
      LEFT JOIN libra_predeck_pipeline_tokens token ON token.subject_id=s.subject_id
     WHERE s.status='active' AND token.subject_id IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM libra_product_packages package
         JOIN arca_ondeck_custodies custody ON custody.on_deck_package_id=package.on_deck_package_id
         JOIN arca_ondeck_runs ondeck ON ondeck.custody_id=custody.custody_id
         JOIN arca_ondeck_commit_receipts commit_receipt ON commit_receipt.on_deck_run_id=ondeck.on_deck_run_id
         WHERE package.subject_id=s.subject_id
       )
     ORDER BY s.subject_id
  `);
  const activeRunsWithoutHead = scope.runIds.length
    ? rowsByIds(database, `SELECT r.libra_run_id,r.subject_id FROM libra_runs r
        LEFT JOIN libra_run_admission_heads h ON h.subject_id=r.subject_id
        WHERE r.libra_run_id IN`, scope.runIds, `AND r.state IN ('active','suspended','frozen') AND h.subject_id IS NULL`)
    : [];
  return Object.freeze({
    acceptedSubjectIds:Object.freeze(acceptedSubjectIds),
    activeRunsWithoutHead:Object.freeze(activeRunsWithoutHead),
    pipelineTokens:scope.orphanPipelineTokens,
  });
}

function inspectBlockers(database, scope) {
  const blockers = [];
  const protectedOverlap = {
    onDeckRunIds: scope.onDeckRunIds.filter((id) => scope.committed.onDeckRunIds.includes(id)),
    packageIds: scope.packageIds.filter((id) => scope.committed.packageIds.includes(id)),
    runIds: scope.runIds.filter((id) => scope.committed.runIds.includes(id)),
  };
  if (Object.values(protectedOverlap).some((items) => items.length)) blockers.push({ code:'COMMITTED_SCOPE_OVERLAP', ...protectedOverlap });
  const controls = rowsByIds(database, 'SELECT * FROM fx_material_controls WHERE material_key IN', scope.materialKeys);
  const foreignControls = controls.filter((row) => row.state === 'controlled' &&
    !controlBelongsToScope(row, scope) && !controlIsPreservedProcurement(row));
  if (foreignControls.length) blockers.push({ code:'MATERIAL_CONTROL_OWNED_BY_NON_TARGET', rows:foreignControls });
  if (scope.artifactIds.length) {
    const allowedConsumers = new Set(scope.allScopeIds);
    const external = rowsByIds(database, 'SELECT * FROM fx_artifact_references WHERE artifact_handle_id IN', scope.artifactIds)
      .filter((row) => !allowedConsumers.has(row.consumer_scope_id));
    if (external.length) blockers.push({ code:'ARTIFACT_REFERENCED_OUTSIDE_RESET', rows:external });
    const packageReferences = rowsByIds(database,
      'SELECT on_deck_package_id,artifact_handle_id FROM libra_product_package_artifact_refs WHERE artifact_handle_id IN',
      scope.artifactIds).filter((row) => !scope.packageIds.includes(row.on_deck_package_id));
    if (packageReferences.length) blockers.push({ code:'ARTIFACT_USED_BY_PROTECTED_PACKAGE', rows:packageReferences });
  }
  return Object.freeze(blockers);
}

function inspectPlan(database, mode) {
  if (!MODES.includes(mode)) throw new Error('FORMATION_RESET_MODE_REQUIRED');
  const scope = discoverScope(database);
  const blockers = inspectBlockers(database, scope);
  const orphans = discoverOrphans(database, scope);
  const activeWorks = scope.works.filter((row) => ACTIVE_WORK_STATES.includes(row.state));
  const activeAttempts = scope.works.length
    ? rowsByIds(database, 'SELECT attempt_id,work_id,state FROM fx_work_attempts WHERE work_id IN', scope.works.map((row) => row.work_id),
      `AND state IN ('ready','running','blocked') ORDER BY attempt_id`)
    : [];
  const controlledMaterials = rowsByIds(database, 'SELECT material_key,owner_domain,owner_scope_type,owner_scope_id,state FROM fx_material_controls WHERE material_key IN', scope.materialKeys)
    .filter((row) => controlBelongsToScope(row, scope));
  const preservedProcurementControls = rowsByIds(database, 'SELECT material_key,owner_domain,owner_scope_type,owner_scope_id,state FROM fx_material_controls WHERE material_key IN', scope.materialKeys)
    .filter(controlIsPreservedProcurement);
  const actionableRuns = rowsByIds(database, 'SELECT libra_run_id,state FROM libra_runs WHERE libra_run_id IN', scope.runIds)
    .filter((row) => ACTIVE_RUN_STATES.includes(row.state));
  const activeCustodies = rowsByIds(database, 'SELECT custody_id,state FROM arca_ondeck_custodies WHERE custody_id IN', scope.custodyIds)
    .filter((row) => row.state === 'active');
  const counts = Object.freeze({
    disposableSubjects:scope.disposableSubjectIds.length, resetSubjects:scope.resetSubjectIds.length,
    runs:scope.runIds.length, actionableRuns:actionableRuns.length, workspaces:scope.workspaceIds.length,
    packages:scope.packageIds.length, acceptanceAttempts:scope.acceptanceAttemptIds.length,
    custodies:scope.custodyIds.length, activeCustodies:activeCustodies.length, onDeckRuns:scope.onDeckRunIds.length,
    works:scope.works.length, activeWorks:activeWorks.length, activeAttempts:activeAttempts.length,
    controlledMaterials:controlledMaterials.length, artifacts:scope.artifactIds.length,
    orphanAcceptedSubjects:orphans.acceptedSubjectIds.length,
    orphanActiveRuns:orphans.activeRunsWithoutHead.length,
    orphanPipelineTokens:orphans.pipelineTokens.length,
    orphanPipelineAdmissionReceipts:scope.orphanPipelineAdmissionReceiptIds.length,
    phantomLibraAdmissionReceipts:scope.phantomLibraAdmissionReceiptIds.length,
    preservedProcurementControls:preservedProcurementControls.length,
  });
  return Object.freeze({ mode, confirmationRequired:CONFIRMATIONS[mode], ready:blockers.length === 0,
    blockers, counts, scope, orphans, activeWorks:Object.freeze(activeWorks), activeAttempts:Object.freeze(activeAttempts) });
}

function assertSafeTranscodeRoot(transcodeDir, dataDir) {
  if (!transcodeDir) return;
  const resolved = path.resolve(transcodeDir);
  const resolvedData = path.resolve(dataDir);
  const root = path.parse(resolved).root;
  if (resolved === root || resolved === resolvedData || resolvedData.startsWith(resolved + path.sep)) {
    throw new Error('FORMATION_RESET_UNSAFE_TRANSCODE_ROOT');
  }
  if (process.platform === 'linux' && resolved !== '/transcode') {
    throw new Error('FORMATION_RESET_TRANSCODE_MOUNT_REQUIRED');
  }
}

function clearWorkspaceDirectories(transcodeDir, dataDir, workspaceIds) {
  if (!transcodeDir) return Object.freeze({ configured:false, removed:[], absent:[...workspaceIds] });
  assertSafeTranscodeRoot(transcodeDir, dataDir);
  const root = path.resolve(transcodeDir);
  if (fs.existsSync(root) && fs.lstatSync(root).isSymbolicLink()) {
    throw new Error('FORMATION_RESET_TRANSCODE_ROOT_SYMLINK_REFUSED');
  }
  const removed = [], absent = [];
  for (const workspaceId of workspaceIds) {
    if (!/^[a-f0-9]{64}$/i.test(workspaceId)) throw new Error('FORMATION_RESET_WORKSPACE_ID_UNSAFE');
    const target = path.resolve(root, workspaceId);
    if (path.dirname(target) !== root) throw new Error('FORMATION_RESET_WORKSPACE_PATH_ESCAPE');
    if (!fs.existsSync(target)) { absent.push(workspaceId); continue; }
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) throw new Error('FORMATION_RESET_WORKSPACE_SYMLINK_REFUSED');
    fs.rmSync(target, { recursive:true, force:false });
    removed.push(workspaceId);
  }
  return Object.freeze({ configured:true, removed:Object.freeze(removed), absent:Object.freeze(absent) });
}

function releaseControlsNormal(database, scope, nowMs, evidenceDigest) {
  let released = 0;
  const controls = rowsByIds(database, 'SELECT * FROM fx_material_controls WHERE material_key IN', scope.materialKeys)
    .filter((row) => controlBelongsToScope(row, scope));
  for (const row of controls) {
    const nextRevision = Number(row.control_revision) + 1;
    const changed = database.prepare(`
      UPDATE fx_material_controls
         SET owner_domain=NULL,owner_scope_type=NULL,owner_scope_id=NULL,
             control_revision=?,state='released',updated_at_ms=?
       WHERE material_key=? AND control_revision=? AND state='controlled'
    `).run(nextRevision, nowMs, row.material_key, row.control_revision).changes;
    if (changed !== 1) throw new Error('FORMATION_RESET_MATERIAL_CONTROL_CAS');
    database.prepare(`
      INSERT INTO fx_material_control_revisions
        (material_key,revision,operation_kind,from_owner_domain,from_scope_type,from_scope_id,
         to_owner_domain,to_scope_type,to_scope_id,basis_digest,commit_marker,committed_at_ms)
      VALUES (?,?,'release',?,?,?,NULL,NULL,NULL,?,?,?)
    `).run(row.material_key, nextRevision, row.owner_domain, row.owner_scope_type, row.owner_scope_id,
      evidenceDigest, `formation-reset-normal-${evidenceDigest.slice(0, 24)}-${nextRevision}`, nowMs);
    released += 1;
  }
  return released;
}

function retireWorksNormal(database, works, nowMs) {
  const workIds = works.map((row) => row.work_id);
  if (!workIds.length) return 0;
  const eventIds = rowsByIds(database, 'SELECT event_id FROM fx_workflow_events WHERE work_id IN', workIds).map((row) => row.event_id);
  const eventAttemptIds = rowsByIds(database, 'SELECT event_attempt_id FROM fx_event_attempts WHERE event_id IN', eventIds).map((row) => row.event_attempt_id);
  executeByIds(database, "UPDATE fx_effect_journal SET state='failed',updated_at_ms=? WHERE event_attempt_id IN", eventAttemptIds,
    "AND state IN ('intended','effect_observed','reconcile_required')", [nowMs]);
  executeByIds(database, "UPDATE fx_event_attempts SET state='completed',outcome_kind=COALESCE(outcome_kind,'cancelled'),failure_class=COALESCE(failure_class,'operator_reset'),failure_code=COALESCE(failure_code,'FORMATION_RESET'),finished_at_ms=COALESCE(finished_at_ms,?) WHERE event_id IN", eventIds,
    "AND state='executing'", [nowMs]);
  executeByIds(database, "UPDATE fx_resource_defer SET state='cancelled' WHERE event_id IN", eventIds, "AND state='waiting'");
  executeByIds(database, "UPDATE fx_workflow_events SET state='cancelled' WHERE event_id IN", eventIds,
    `AND state IN ('${ACTIVE_EVENT_STATES.join("','")}')`);
  executeByIds(database, "UPDATE fx_work_attempts SET state='cancelled',finished_at_ms=COALESCE(finished_at_ms,?),failure_code=COALESCE(failure_code,?) WHERE work_id IN",
    workIds, `AND state IN ('${ACTIVE_ATTEMPT_STATES.join("','")}')`, [nowMs, RESET_FAILURE_CODE]);
  return executeByIds(database, "UPDATE fx_supporting_works SET state='cancelled',updated_at_ms=? WHERE work_id IN", workIds,
    `AND state IN ('${ACTIVE_WORK_STATES.join("','")}')`, [nowMs]);
}

function ensureRunAdmissionHeadsNormal(database, scope, nowMs) {
  const subjectIds = unique(rowsByIds(database, `
    SELECT subject_id FROM libra_runs WHERE libra_run_id IN`, scope.runIds,
    `AND state IN ('active','suspended','frozen') ORDER BY subject_id`).map((row) => row.subject_id));
  let created = 0;
  for (const subjectId of subjectIds) {
    if (database.prepare('SELECT 1 FROM libra_run_admission_heads WHERE subject_id=?').get(subjectId)) continue;
    const active = database.prepare(`
      SELECT libra_run_id,run_scope_digest,state_revision,state_digest FROM libra_runs
       WHERE subject_id=? AND state IN ('active','suspended','frozen') ORDER BY libra_run_id
    `).all(subjectId).map((row) => ({ libraRunId:row.libra_run_id,runScopeDigest:row.run_scope_digest,
      stateRevision:Number(row.state_revision),stateDigest:row.state_digest }));
    database.prepare(`INSERT INTO libra_run_admission_heads
      (subject_id,head_revision,active_scope_set_digest,updated_at_ms) VALUES (?,1,?,?)`)
      .run(subjectId, activeRunScopeSetDigest(subjectId, active), nowMs);
    created += 1;
  }
  return created;
}

function discardRunsNormal(database, scope, nowMs, evidence) {
  const runs = rowsByIds(database, 'SELECT * FROM libra_runs WHERE libra_run_id IN', scope.runIds)
    .filter((row) => ACTIVE_RUN_STATES.includes(row.state));
  const bySubject = new Map();
  for (const run of runs) {
    if (!bySubject.has(run.subject_id)) bySubject.set(run.subject_id, []);
    bySubject.get(run.subject_id).push(run);
  }
  let changed = 0;
  for (const [subjectId, subjectRuns] of bySubject) {
    const head = database.prepare('SELECT * FROM libra_run_admission_heads WHERE subject_id=?').get(subjectId);
    if (!head) throw new Error('FORMATION_RESET_RUN_ADMISSION_HEAD_MISSING');
    const target = new Set(subjectRuns.map((row) => row.libra_run_id));
    const remaining = database.prepare(`
      SELECT libra_run_id,run_scope_digest,state_revision,state_digest FROM libra_runs
       WHERE subject_id=? AND state IN ('active','suspended','frozen') ORDER BY libra_run_id
    `).all(subjectId).filter((row) => !target.has(row.libra_run_id)).map((row) => ({
      libraRunId:row.libra_run_id, runScopeDigest:row.run_scope_digest,
      stateRevision:Number(row.state_revision), stateDigest:row.state_digest,
    }));
    const nextHeadRevision = Number(head.head_revision) + 1;
    const nextScopeDigest = activeRunScopeSetDigest(subjectId, remaining);
    for (const run of subjectRuns) {
      const nextStateRevision = Number(run.state_revision) + 1;
      const nextState = { libraRunId:run.libra_run_id, stateRevision:nextStateRevision, state:'discarded',
        acceptanceSpecId:run.acceptance_spec_id, executionBasisDigest:run.execution_basis_digest,
        runScopeDigest:run.run_scope_digest, priorityClass:run.priority_class,
        priorityIntentDigest:run.priority_intent_digest, transitionKind:'discarded',
        transitionEvidenceDigest:evidence.digest };
      nextState.stateDigest = runStateDigest(nextState);
      const revision = { libraRunId:run.libra_run_id, stateRevision:nextStateRevision, state:'discarded',
        acceptanceSpecId:run.acceptance_spec_id, executionBasisDigest:run.execution_basis_digest,
        runScopeDigest:run.run_scope_digest, priorityClass:run.priority_class,
        priorityIntentDigest:run.priority_intent_digest, transitionKind:'discarded',
        transitionDecisionId:evidence.id, transitionDecisionDigest:evidence.digest,
        transitionEvidenceSchemaRef:RESET_SCHEMA, transitionEvidenceId:evidence.id,
        transitionEvidenceDigest:evidence.digest, recoveryPolicyRef:run.recovery_policy_ref,
        recoveryPolicyDigest:run.recovery_policy_digest, suspensionStartedAtMs:run.suspension_started_at_ms,
        recoveryAttemptOrdinal:Number(run.recovery_attempt_ordinal || 0), recoveryNextDueAtMs:null,
        expectedAdmissionHeadRevision:Number(head.head_revision), expectedActiveScopeSetDigest:head.active_scope_set_digest,
        committedAdmissionHeadRevision:nextHeadRevision, committedActiveScopeSetDigest:nextScopeDigest,
        previousStateRevision:Number(run.state_revision) };
      revision.revisionDigest = canonicalDigest(revision);
      const updated = database.prepare(`
        UPDATE libra_runs SET state='discarded',state_revision=?,state_digest=?,recovery_next_due_at_ms=NULL,terminal_at_ms=?
         WHERE libra_run_id=? AND state_revision=? AND state=?
      `).run(nextStateRevision, nextState.stateDigest, nowMs, run.libra_run_id, run.state_revision, run.state).changes;
      if (updated !== 1) throw new Error('FORMATION_RESET_RUN_CAS');
      database.prepare(`
        INSERT INTO libra_run_revisions
          (libra_run_id,state_revision,state,acceptance_spec_id,execution_basis_digest,run_scope_digest,
           priority_class,priority_intent_digest,transition_kind,transition_decision_id,transition_decision_digest,
           transition_evidence_schema_ref,transition_evidence_id,transition_evidence_json,transition_evidence_digest,
           recovery_policy_ref,recovery_policy_digest,suspension_started_at_ms,recovery_attempt_ordinal,recovery_next_due_at_ms,
           expected_admission_head_revision,expected_active_scope_set_digest,committed_admission_head_revision,
           committed_active_scope_set_digest,previous_state_revision,revision_digest,committed_at_ms)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(revision.libraRunId,revision.stateRevision,revision.state,revision.acceptanceSpecId,
        revision.executionBasisDigest,revision.runScopeDigest,revision.priorityClass,revision.priorityIntentDigest,
        revision.transitionKind,revision.transitionDecisionId,revision.transitionDecisionDigest,
        revision.transitionEvidenceSchemaRef,revision.transitionEvidenceId,canonicalJson(evidence.record),
        revision.transitionEvidenceDigest,revision.recoveryPolicyRef,revision.recoveryPolicyDigest,
        revision.suspensionStartedAtMs,revision.recoveryAttemptOrdinal,revision.recoveryNextDueAtMs,
        revision.expectedAdmissionHeadRevision,revision.expectedActiveScopeSetDigest,
        revision.committedAdmissionHeadRevision,revision.committedActiveScopeSetDigest,
        revision.previousStateRevision,revision.revisionDigest,nowMs);
      changed += 1;
    }
    const headChanged = database.prepare(`
      UPDATE libra_run_admission_heads SET head_revision=?,active_scope_set_digest=?,updated_at_ms=?
       WHERE subject_id=? AND head_revision=? AND active_scope_set_digest=?
    `).run(nextHeadRevision,nextScopeDigest,nowMs,subjectId,head.head_revision,head.active_scope_set_digest).changes;
    if (headChanged !== 1) throw new Error('FORMATION_RESET_RUN_HEAD_CAS');
  }
  return changed;
}

function reclaimWorkspacesNormal(database, scope, nowMs, evidenceDigest) {
  const workspaces = rowsByIds(database, 'SELECT * FROM libra_workspaces WHERE workspace_id IN', scope.workspaceIds)
    .filter((row) => row.state !== 'reclaimed');
  let changed = 0;
  for (const workspace of workspaces) {
    const nextRevision = Number(workspace.current_revision) + 1;
    const referenceDigest = emptyReferenceSetDigest(workspace.workspace_id);
    const state = { workspaceId:workspace.workspace_id, workspaceRevision:nextRevision, state:'reclaimed',
      workspaceMaterialReferenceSetDigest:referenceDigest, transitionKind:'reclaimed',
      transitionEvidenceDigest:evidenceDigest };
    const stateDigest = workspaceStateDigest(state);
    const revision = { workspaceId:workspace.workspace_id,workspaceRevision:nextRevision,state:'reclaimed',
      materialReferenceSetDigest:referenceDigest,transitionKind:'reclaimed',transitionEvidenceDigest:evidenceDigest,
      previousRevision:Number(workspace.current_revision) };
    revision.revisionDigest = canonicalDigest(revision);
    executeByIds(database, "UPDATE libra_workspace_material_refs SET reference_state='released' WHERE workspace_id IN", [workspace.workspace_id],
      "AND reference_state!='released'");
    database.prepare(`
      INSERT INTO libra_workspace_revisions
        (workspace_id,workspace_revision,state,material_reference_set_digest,transition_kind,
         transition_evidence_digest,previous_revision,revision_digest,committed_at_ms)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run(workspace.workspace_id,nextRevision,'reclaimed',referenceDigest,'reclaimed',evidenceDigest,
      workspace.current_revision,revision.revisionDigest,nowMs);
    database.prepare(`UPDATE libra_workspaces SET current_revision=?,state='reclaimed',state_digest=?,completed_at_ms=? WHERE workspace_id=?`)
      .run(nextRevision,stateDigest,nowMs,workspace.workspace_id);
    changed += 1;
  }
  executeByIds(database, "UPDATE fx_workspace_materials SET state='reclaimed',reclaimed_at_ms=COALESCE(reclaimed_at_ms,?) WHERE workspace_id IN",
    scope.workspaceIds, "AND state='active'", [nowMs]);
  executeByIds(database, "UPDATE fx_workspace_registry SET state='reclaimed',reclaimed_at_ms=COALESCE(reclaimed_at_ms,?) WHERE workspace_id IN",
    scope.workspaceIds, "AND state='active'", [nowMs]);
  executeByIds(database, "UPDATE libra_workspace_cleanup_members SET state='completed',updated_at_ms=? WHERE cleanup_scope_id IN",
    scope.cleanupScopeIds, "AND state!='completed'", [nowMs]);
  executeByIds(database, "UPDATE libra_workspace_cleanup_scopes SET state='completed',completed_at_ms=COALESCE(completed_at_ms,?) WHERE cleanup_scope_id IN",
    scope.cleanupScopeIds, "AND state!='completed'", [nowMs]);
  return changed;
}

function applyNormal(database, plan, nowMs) {
  const scope = plan.scope;
  const record = { schema:RESET_SCHEMA, mode:'normal', atMs:nowMs, subjectIds:scope.resetSubjectIds,
    pipelineTokenSubjectIds:scope.pipelineTokenSubjectIds, runIds:scope.runIds,
    packageIds:scope.packageIds, onDeckRunIds:scope.onDeckRunIds };
  const evidence = { id:`formation-reset-normal-${nowMs}`, record, digest:canonicalDigest(record) };
  const transaction = database.transaction(() => {
    const retiredWorks = retireWorksNormal(database, scope.works, nowMs);
    const createdAdmissionHeads = ensureRunAdmissionHeadsNormal(database, scope, nowMs);
    const discardedRuns = discardRunsNormal(database, scope, nowMs, evidence);
    const reclaimedWorkspaces = reclaimWorkspacesNormal(database, scope, nowMs, evidence.digest);
    const releasedControls = releaseControlsNormal(database, scope, nowMs, evidence.digest);
    executeByIds(database, "DELETE FROM libra_predeck_pipeline_tokens WHERE subject_id IN", scope.pipelineTokenSubjectIds);
    executeByIds(database, 'DELETE FROM fx_command_receipts WHERE command_receipt_id IN', scope.phantomLibraAdmissionReceiptIds);
    executeByIds(database, "DELETE FROM libra_formation_projections WHERE subject_id IN", scope.resetSubjectIds);
    executeByIds(database, "UPDATE libra_subjects SET status='abandoned',updated_at_ms=?,terminal_at_ms=COALESCE(terminal_at_ms,?) WHERE subject_id IN",
      scope.disposableSubjectIds, "AND status='active'", [nowMs,nowMs]);
    executeByIds(database, "UPDATE libra_material_bindings SET health_state='released',current=0 WHERE subject_id IN",
      scope.resetSubjectIds, "AND health_state='active'");
    executeByIds(database, "UPDATE arca_material_bindings SET health_state='released',current=0 WHERE owner_object_id IN",
      scope.custodyIds, "AND owner_object_type='on_deck_custody' AND health_state='active'");
    executeByIds(database, "UPDATE arca_ondeck_custodies SET state='released' WHERE custody_id IN", scope.custodyIds, "AND state='active'");
    executeByIds(database, "UPDATE arca_ondeck_runs SET state='blocked',terminal_at_ms=COALESCE(terminal_at_ms,?) WHERE on_deck_run_id IN",
      scope.onDeckRunIds, "AND state IN ('ready','offloading')", [nowMs]);
    executeByIds(database, "UPDATE arca_acceptance_recovery_cases SET recovery_state='resolved',resolved_at_ms=COALESCE(resolved_at_ms,?),updated_at_ms=? WHERE offer_id IN",
      scope.offerIds, "AND recovery_state!='resolved'", [nowMs,nowMs]);
    executeByIds(database, "UPDATE fx_artifact_references SET state='released',released_at_ms=COALESCE(released_at_ms,?) WHERE artifact_handle_id IN",
      scope.artifactIds, "AND state='active'", [nowMs]);
    executeByIds(database, "UPDATE fx_artifact_registry SET state='deleted' WHERE artifact_handle_id IN", scope.artifactIds,
      "AND state!='deleted'");
    const foreignKeys = database.pragma('foreign_key_check');
    if (foreignKeys.length) {
      const error = new Error('FORMATION_RESET_FOREIGN_KEY_CHECK_FAILED');
      error.details = foreignKeys;
      throw error;
    }
    return { retiredWorks, createdAdmissionHeads, discardedRuns, reclaimedWorkspaces, releasedControls };
  });
  return Object.freeze({ ...transaction(), evidenceDigest:evidence.digest });
}

function captureExecutionGraph(database, workIds, scopeIds) {
  const attemptIds = rowsByIds(database, 'SELECT attempt_id FROM fx_work_attempts WHERE work_id IN', workIds).map((row) => row.attempt_id);
  const planIds = rowsByIds(database, 'SELECT plan_id FROM fx_workflow_plans WHERE attempt_id IN', attemptIds).map((row) => row.plan_id);
  const eventIds = unique([
    ...rowsByIds(database, 'SELECT event_id FROM fx_workflow_events WHERE work_id IN', workIds).map((row) => row.event_id),
    ...rowsByIds(database, 'SELECT event_id FROM fx_workflow_events WHERE plan_id IN', planIds).map((row) => row.event_id),
  ]);
  const eventAttemptIds = rowsByIds(database, 'SELECT event_attempt_id FROM fx_event_attempts WHERE event_id IN', eventIds).map((row) => row.event_attempt_id);
  const resultIds = unique([
    ...rowsByIds(database, 'SELECT result_id FROM fx_event_result_bindings WHERE event_id IN', eventIds).map((row) => row.result_id),
    ...rowsByIds(database, 'SELECT result_id FROM fx_commit_markers WHERE scope_id IN', scopeIds).map((row) => row.result_id).filter(Boolean),
  ]);
  const messageIds = rowsByIds(database, "SELECT message_id FROM fx_outbox WHERE aggregate_id IN", scopeIds,
    "AND producer_domain IN ('libra','arca')").map((row) => row.message_id);
  return Object.freeze({ workIds:unique(workIds), attemptIds:unique(attemptIds), planIds:unique(planIds), eventIds,
    eventAttemptIds:unique(eventAttemptIds), resultIds, messageIds:unique(messageIds) });
}

function deleteExecutionGraph(database, graph, scopeIds) {
  executeByIds(database, 'DELETE FROM fx_inbox WHERE message_id IN', graph.messageIds);
  executeByIds(database, 'DELETE FROM fx_outbox_deliveries WHERE message_id IN', graph.messageIds);
  executeByIds(database, 'DELETE FROM fx_outbox WHERE message_id IN', graph.messageIds);
  executeByIds(database, 'DELETE FROM fx_audit_records WHERE work_id IN', graph.workIds);
  executeByIds(database, 'DELETE FROM fx_audit_records WHERE event_id IN', graph.eventIds);
  executeByIds(database, 'DELETE FROM fx_audit_records WHERE scope_id IN', scopeIds);
  executeByIds(database, 'DELETE FROM fx_command_receipts WHERE target_id IN', unique([...scopeIds, ...graph.workIds]));
  executeByIds(database, 'DELETE FROM fx_effect_journal WHERE event_attempt_id IN', graph.eventAttemptIds);
  executeByIds(database, 'DELETE FROM fx_event_resource_timings WHERE event_attempt_id IN', graph.eventAttemptIds);
  executeByIds(database, 'DELETE FROM fx_event_progress WHERE event_id IN', graph.eventIds);
  executeByIds(database, 'DELETE FROM fx_resource_defer WHERE event_id IN', graph.eventIds);
  executeByIds(database, 'DELETE FROM fx_commit_markers WHERE result_id IN', graph.resultIds);
  executeByIds(database, 'DELETE FROM fx_commit_markers WHERE scope_id IN', scopeIds);
  executeByIds(database, 'DELETE FROM fx_event_result_bindings WHERE result_id IN', graph.resultIds);
  executeByIds(database, 'DELETE FROM fx_event_attempts WHERE event_attempt_id IN', graph.eventAttemptIds);
  executeByIds(database, 'DELETE FROM fx_workflow_events WHERE event_id IN', graph.eventIds);
  executeByIds(database, 'DELETE FROM fx_plan_edges WHERE plan_id IN', graph.planIds);
  executeByIds(database, 'DELETE FROM fx_plan_nodes WHERE plan_id IN', graph.planIds);
  executeByIds(database, 'DELETE FROM fx_workflow_plans WHERE plan_id IN', graph.planIds);
  executeByIds(database, 'DELETE FROM fx_work_attempts WHERE attempt_id IN', graph.attemptIds);
  return executeByIds(database, 'DELETE FROM fx_supporting_works WHERE work_id IN', graph.workIds);
}

function deleteNuclearBusinessGraph(database, scope, nowMs) {
  executeByIds(database, 'DELETE FROM arca_ondeck_settlement_approvals WHERE on_deck_run_id IN', scope.onDeckRunIds);
  executeByIds(database, 'DELETE FROM arca_final_inventory_decisions WHERE on_deck_run_id IN', scope.onDeckRunIds);
  executeByIds(database, 'DELETE FROM arca_offload_completions WHERE on_deck_run_id IN', scope.onDeckRunIds);
  executeByIds(database, 'DELETE FROM arca_material_bindings WHERE owner_object_id IN', scope.custodyIds,
    "AND owner_object_type='on_deck_custody'");
  executeByIds(database, 'DELETE FROM arca_ondeck_runs WHERE on_deck_run_id IN', scope.onDeckRunIds);
  executeByIds(database, 'DELETE FROM arca_ondeck_custodies WHERE custody_id IN', scope.custodyIds);
  executeByIds(database, 'DELETE FROM arca_handoff_b_receipts WHERE acceptance_decision_id IN', scope.acceptanceDecisionIds);
  executeByIds(database, 'DELETE FROM arca_acceptance_recovery_cases WHERE offer_id IN', scope.offerIds);
  executeByIds(database, 'DELETE FROM arca_acceptance_checks WHERE acceptance_attempt_id IN', scope.acceptanceAttemptIds);
  executeByIds(database, 'DELETE FROM arca_acceptance_decisions WHERE acceptance_decision_id IN', scope.acceptanceDecisionIds);
  executeByIds(database, 'DELETE FROM arca_acceptance_attempts WHERE acceptance_attempt_id IN', scope.acceptanceAttemptIds);

  executeByIds(database, 'DELETE FROM libra_delivery_receipts WHERE on_deck_package_id IN', scope.packageIds);
  executeByIds(database, 'DELETE FROM libra_offload_context_materials WHERE on_deck_package_id IN', scope.packageIds);
  executeByIds(database, 'DELETE FROM libra_product_package_artifact_refs WHERE on_deck_package_id IN', scope.packageIds);
  executeByIds(database, 'DELETE FROM libra_product_package_fact_refs WHERE on_deck_package_id IN', scope.packageIds);
  executeByIds(database, 'DELETE FROM libra_product_package_material_episode_claims WHERE on_deck_package_id IN', scope.packageIds);
  executeByIds(database, 'DELETE FROM libra_product_package_materials WHERE on_deck_package_id IN', scope.packageIds);
  executeByIds(database, 'DELETE FROM libra_product_packages WHERE on_deck_package_id IN', scope.packageIds);

  const factIds = rowsByIds(database, 'SELECT product_fact_id FROM libra_product_fact_revisions WHERE libra_run_id IN', scope.runIds)
    .map((row) => row.product_fact_id);
  executeByIds(database, 'DELETE FROM libra_product_fact_source_refs WHERE product_fact_id IN', factIds);
  executeByIds(database, 'DELETE FROM libra_product_fact_revisions WHERE product_fact_id IN', factIds);
  executeByIds(database, 'DELETE FROM libra_product_identity_selection_intents WHERE libra_run_id IN', scope.runIds);
  executeByIds(database, 'DELETE FROM libra_run_discard_receipts WHERE libra_run_id IN', scope.runIds);
  executeByIds(database, 'DELETE FROM libra_run_discard_decisions WHERE libra_run_id IN', scope.runIds);
  executeByIds(database, 'DELETE FROM libra_workspace_cleanup_members WHERE cleanup_scope_id IN', scope.cleanupScopeIds);
  executeByIds(database, 'DELETE FROM libra_workspace_cleanup_scopes WHERE cleanup_scope_id IN', scope.cleanupScopeIds);
  executeByIds(database, 'DELETE FROM libra_workspace_material_refs WHERE workspace_id IN', scope.workspaceIds);
  executeByIds(database, 'DELETE FROM libra_workspace_revisions WHERE workspace_id IN', scope.workspaceIds);
  executeByIds(database, 'DELETE FROM fx_workspace_materials WHERE workspace_id IN', scope.workspaceIds);
  executeByIds(database, 'DELETE FROM fx_workspace_registry WHERE workspace_id IN', scope.workspaceIds);
  executeByIds(database, 'DELETE FROM libra_workspaces WHERE workspace_id IN', scope.workspaceIds);
  const manifestIds = rowsByIds(database, 'SELECT run_material_manifest_id FROM libra_run_material_manifests WHERE libra_run_id IN', scope.runIds)
    .map((row) => row.run_material_manifest_id);
  executeByIds(database, 'DELETE FROM libra_run_material_episode_claims WHERE run_material_manifest_id IN', manifestIds);
  executeByIds(database, 'DELETE FROM libra_run_material_members WHERE run_material_manifest_id IN', manifestIds);
  executeByIds(database, 'UPDATE libra_runs SET supersedes_run_id=NULL WHERE supersedes_run_id IN', scope.runIds);
  executeByIds(database, 'UPDATE libra_runs SET superseded_by_run_id=NULL WHERE superseded_by_run_id IN', scope.runIds);
  executeByIds(database, 'UPDATE libra_runs SET run_material_manifest_id=NULL,supersedes_run_id=NULL,superseded_by_run_id=NULL WHERE libra_run_id IN', scope.runIds);
  executeByIds(database, 'DELETE FROM libra_run_material_manifests WHERE run_material_manifest_id IN', manifestIds);
  executeByIds(database, 'DELETE FROM libra_run_revisions WHERE libra_run_id IN', scope.runIds);
  executeByIds(database, 'DELETE FROM libra_runs WHERE libra_run_id IN', scope.runIds);

  const retainedSubjectIds = scope.resetSubjectIds.filter((id) => !scope.disposableSubjectIds.includes(id));
  for (const subjectId of retainedSubjectIds) {
    const head = database.prepare('SELECT * FROM libra_run_admission_heads WHERE subject_id=?').get(subjectId);
    if (!head) continue;
    const remaining = database.prepare(`
      SELECT libra_run_id,run_scope_digest,state_revision,state_digest FROM libra_runs
       WHERE subject_id=? AND state IN ('active','suspended','frozen') ORDER BY libra_run_id
    `).all(subjectId).map((row) => ({ libraRunId:row.libra_run_id,runScopeDigest:row.run_scope_digest,
      stateRevision:Number(row.state_revision),stateDigest:row.state_digest }));
    database.prepare(`UPDATE libra_run_admission_heads
      SET head_revision=?,active_scope_set_digest=?,updated_at_ms=? WHERE subject_id=?`)
      .run(Number(head.head_revision) + 1, activeRunScopeSetDigest(subjectId, remaining), nowMs, subjectId);
  }

  executeByIds(database, 'DELETE FROM libra_predeck_pipeline_tokens WHERE subject_id IN', scope.pipelineTokenSubjectIds);
  executeByIds(database, 'DELETE FROM libra_formation_projections WHERE subject_id IN', scope.resetSubjectIds);
  executeByIds(database, 'DELETE FROM libra_run_admission_heads WHERE subject_id IN', scope.disposableSubjectIds);
  executeByIds(database, 'DELETE FROM libra_subject_decision_heads WHERE subject_id IN', scope.disposableSubjectIds);
  executeByIds(database, 'DELETE FROM libra_material_binding_episode_claims WHERE subject_id IN', scope.disposableSubjectIds);
  executeByIds(database, 'DELETE FROM libra_material_bindings WHERE subject_id IN', scope.disposableSubjectIds);
  executeByIds(database, 'DELETE FROM libra_subject_episode_scopes WHERE subject_id IN', scope.disposableSubjectIds);
  executeByIds(database, 'DELETE FROM libra_subject_season_continuity_claims WHERE subject_id IN', scope.disposableSubjectIds);
  executeByIds(database, 'DELETE FROM libra_subject_abandon_receipts WHERE subject_id IN', scope.disposableSubjectIds);
  executeByIds(database, 'DELETE FROM libra_subject_abandon_decisions WHERE subject_id IN', scope.disposableSubjectIds);
  executeByIds(database, 'DELETE FROM libra_acceptance_specs WHERE subject_id IN', scope.disposableSubjectIds);
  const basisIds = rowsByIds(database, 'SELECT decision_basis_id FROM libra_decision_basis_revisions WHERE subject_id IN', scope.disposableSubjectIds)
    .map((row) => row.decision_basis_id);
  executeByIds(database, 'DELETE FROM libra_decision_basis_inputs WHERE decision_basis_id IN', basisIds);
  executeByIds(database, 'DELETE FROM libra_routing_decisions WHERE subject_id IN', scope.disposableSubjectIds);
  executeByIds(database, 'DELETE FROM libra_routing_assessments WHERE subject_id IN', scope.disposableSubjectIds);
  executeByIds(database, 'DELETE FROM libra_decision_basis_revisions WHERE decision_basis_id IN', basisIds);
  executeByIds(database, 'DELETE FROM libra_product_identity_revisions WHERE subject_id IN', scope.disposableSubjectIds);
  executeByIds(database, 'DELETE FROM libra_intake_rejection_reason_evidence WHERE intake_decision_id IN', scope.intakeDecisionIds);
  executeByIds(database, 'DELETE FROM libra_intake_resolution_episode_overlaps WHERE intake_decision_id IN', scope.intakeDecisionIds);
  executeByIds(database, 'DELETE FROM libra_intake_resolution_match_witnesses WHERE intake_decision_id IN', scope.intakeDecisionIds);
  executeByIds(database, 'DELETE FROM libra_handoff_a_receipts WHERE intake_decision_id IN', scope.intakeDecisionIds);
  executeByIds(database, 'UPDATE libra_subjects SET routing_anchor_intake_decision_id=NULL,current_identity_revision=NULL WHERE subject_id IN', scope.disposableSubjectIds);
  executeByIds(database, 'DELETE FROM libra_subjects WHERE subject_id IN', scope.disposableSubjectIds);
  executeByIds(database, 'DELETE FROM libra_intake_decisions WHERE intake_decision_id IN', scope.intakeDecisionIds);
}

function rollbackControlsNuclear(database, scope) {
  const controls = rowsByIds(database, 'SELECT * FROM fx_material_controls WHERE material_key IN', scope.materialKeys)
    .filter((row) => controlBelongsToScope(row, scope));
  let restoredProcurementControls = 0;
  let deletedMaterialControls = 0;
  let deletedControlRevisions = 0;
  for (const control of controls) {
    const revisions = database.prepare(`SELECT * FROM fx_material_control_revisions
      WHERE material_key=? ORDER BY revision`).all(control.material_key);
    const boundaryIndex = revisions.findIndex((revision) => controlBelongsToScope({
      state:'controlled', owner_domain:revision.to_owner_domain,
      owner_scope_type:revision.to_scope_type, owner_scope_id:revision.to_scope_id,
    }, scope));
    if (boundaryIndex < 0) throw new Error('FORMATION_RESET_CONTROL_BOUNDARY_MISSING');
    const previous = boundaryIndex > 0 ? revisions[boundaryIndex - 1] : null;
    if (previous && previous.to_owner_domain && previous.to_owner_domain !== 'procurement') {
      throw Object.assign(new Error('FORMATION_RESET_CONTROL_BOUNDARY_UNSAFE'), {
        details:{ materialKey:control.material_key, previousOwnerDomain:previous.to_owner_domain },
      });
    }
    deletedControlRevisions += database.prepare(`DELETE FROM fx_material_control_revisions
      WHERE material_key=? AND revision>=?`).run(control.material_key, revisions[boundaryIndex].revision).changes;
    if (!previous) {
      deletedMaterialControls += database.prepare('DELETE FROM fx_material_controls WHERE material_key=?')
        .run(control.material_key).changes;
      continue;
    }
    database.prepare(`UPDATE fx_material_controls
      SET owner_domain=?,owner_scope_type=?,owner_scope_id=?,control_revision=?,state=?,updated_at_ms=?
      WHERE material_key=?`).run(previous.to_owner_domain, previous.to_scope_type, previous.to_scope_id,
      previous.revision, previous.to_owner_domain ? 'controlled' : 'released', previous.committed_at_ms,
      control.material_key);
    if (previous.to_owner_domain === 'procurement') restoredProcurementControls += 1;
  }
  return Object.freeze({ restoredProcurementControls, deletedMaterialControls, deletedControlRevisions });
}

function applyNuclear(database, plan, nowMs) {
  const scope = plan.scope;
  const graph = captureExecutionGraph(database, scope.works.map((row) => row.work_id), scope.allScopeIds);
  database.pragma('foreign_keys = OFF');
  const transaction = database.transaction(() => {
    deleteNuclearBusinessGraph(database, scope, nowMs);
    const deletedWorks = deleteExecutionGraph(database, graph, scope.allScopeIds);
    executeByIds(database, 'DELETE FROM fx_command_receipts WHERE command_receipt_id IN', scope.phantomLibraAdmissionReceiptIds);
    executeByIds(database, 'DELETE FROM fx_artifact_references WHERE artifact_handle_id IN', scope.artifactIds);
    executeByIds(database, 'DELETE FROM fx_artifact_registry WHERE artifact_handle_id IN', scope.artifactIds);
    const controlRollback = rollbackControlsNuclear(database, scope);
    const foreignKeys = database.pragma('foreign_key_check');
    if (foreignKeys.length) throw Object.assign(new Error('FORMATION_RESET_FOREIGN_KEY_CHECK_FAILED'), { details:foreignKeys });
    return Object.freeze({ deletedWorks, deletedSubjects:scope.disposableSubjectIds.length,
      deletedRuns:scope.runIds.length, deletedPackages:scope.packageIds.length,
      deletedOnDeckRuns:scope.onDeckRunIds.length, ...controlRollback });
  });
  try { return transaction(); }
  finally { database.pragma('foreign_keys = ON'); }
}

function verifyPostconditions(database, mode) {
  const plan = inspectPlan(database, mode);
  if (mode === 'normal') {
    const residual = { actionableRuns:plan.counts.actionableRuns, activeWorks:plan.counts.activeWorks,
      activeAttempts:plan.counts.activeAttempts, activeCustodies:plan.counts.activeCustodies,
      controlledMaterials:plan.counts.controlledMaterials,
      orphanAcceptedSubjects:plan.counts.orphanAcceptedSubjects,
      orphanActiveRuns:plan.counts.orphanActiveRuns,
      orphanPipelineTokens:plan.counts.orphanPipelineTokens,
      phantomLibraAdmissionReceipts:plan.counts.phantomLibraAdmissionReceipts };
    if (Object.values(residual).some((value) => value !== 0)) {
      throw Object.assign(new Error('FORMATION_RESET_NORMAL_RESIDUAL'), { details:residual });
    }
  } else {
    const residual = { subjects:plan.counts.disposableSubjects, runs:plan.counts.runs,
      packages:plan.counts.packages, onDeckRuns:plan.counts.onDeckRuns, works:plan.counts.works,
      orphanAcceptedSubjects:plan.counts.orphanAcceptedSubjects,
      orphanActiveRuns:plan.counts.orphanActiveRuns,
      orphanPipelineTokens:plan.counts.orphanPipelineTokens,
      phantomLibraAdmissionReceipts:plan.counts.phantomLibraAdmissionReceipts };
    if (Object.values(residual).some((value) => value !== 0)) {
      throw Object.assign(new Error('FORMATION_RESET_NUCLEAR_RESIDUAL'), { details:residual });
    }
  }
  const foreignKeys = database.pragma('foreign_key_check');
  if (foreignKeys.length) throw Object.assign(new Error('FORMATION_RESET_FOREIGN_KEY_CHECK_FAILED'), { details:foreignKeys });
  const integrity = database.pragma('integrity_check', { simple:true });
  if (integrity !== 'ok') throw new Error(`Integrity check failed: ${integrity}`);
  return Object.freeze({ integrity, foreignKeyViolations:0, plan });
}

function applyReset({ database, mode, dataDir, transcodeDir = null, nowMs = Date.now() }) {
  const plan = inspectPlan(database, mode);
  if (!plan.ready) throw Object.assign(new Error('FORMATION_RESET_BLOCKED'), { details:plan.blockers });
  const workspaceCleanup = clearWorkspaceDirectories(transcodeDir, dataDir, plan.scope.workspaceIds);
  const result = mode === 'normal' ? applyNormal(database, plan, nowMs) : applyNuclear(database, plan, nowMs);
  const verification = verifyPostconditions(database, mode);
  return Object.freeze({ mode, workspaceCleanup, result, verification });
}

function main(argv = process.argv.slice(2)) {
  const mode = parseMode(argv);
  const dataDir = path.resolve(valueAfter(argv, '--data-dir') || process.env.MEDIA_SERVICE_DATA_DIR || path.join(__dirname, '..', 'data'));
  const transcodeDirValue = valueAfter(argv, '--transcode-dir');
  const transcodeDir = transcodeDirValue ? path.resolve(transcodeDirValue) : null;
  const databasePath = path.join(dataDir, 'shelfdeck.db');
  if (!fs.existsSync(databasePath)) throw new Error(`Database not found: ${databasePath}`);
  const database = new Database(databasePath, { readonly:!argv.includes('--apply') });
  try {
    database.pragma('foreign_keys = ON');
    assertSafeTranscodeRoot(transcodeDir, dataDir);
    if (!argv.includes('--apply')) return Object.freeze({ operation:'formation_reset', mode,
      dataDir, transcodeDir, plan:inspectPlan(database, mode) });
    if (!argv.includes('--offline-confirmed')) throw new Error('FORMATION_RESET_OFFLINE_CONFIRMATION_REQUIRED');
    if (valueAfter(argv, '--confirm') !== CONFIRMATIONS[mode]) throw new Error('FORMATION_RESET_CONFIRMATION_REQUIRED');
    const applied = applyReset({ database, mode, dataDir, transcodeDir, nowMs:Date.now() });
    return Object.freeze({ operation:'formation_reset', applied:true, dataDir, transcodeDir, ...applied });
  } finally { database.close(); }
}

if (require.main === module) {
  try { process.stdout.write(`${JSON.stringify(main(), null, 2)}\n`); }
  catch (error) {
    process.stderr.write(`${JSON.stringify({ error:{ code:error.message, message:error.message,
      details:error.details || null } }, null, 2)}\n`);
    process.exitCode = 1;
  }
}

module.exports = Object.freeze({ CONFIRMATIONS, MODES, applyReset, assertSafeTranscodeRoot,
  clearWorkspaceDirectories, discoverScope, inspectPlan, main, verifyPostconditions });
