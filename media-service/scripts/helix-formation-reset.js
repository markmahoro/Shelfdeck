'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { canonicalDigest } = require('../src/helix/contracts/canonical-json');
const { activeRunScopeSetDigest } = require('../src/helix/domains/libra/model/run-admission-contracts');
const CONFIRMATION = 'FORMATION_RESET_V2';
const ACTIVE_RUN_STATES = Object.freeze(['active', 'suspended', 'frozen']);
const ACTIVE_WORK_STATES = Object.freeze(['admitted', 'ready', 'running', 'blocked']);
const ACTIVE_ATTEMPT_STATES = Object.freeze(['ready', 'running', 'blocked']);
const EVENTLESS_FACT_MARKERS = Object.freeze([
  Object.freeze({ ownerDomain:'libra', scopeType:'acceptance_spec', table:'libra_acceptance_specs', key:'acceptance_spec_id' }),
  Object.freeze({ ownerDomain:'libra', scopeType:'intake_decision', table:'libra_intake_decisions', key:'intake_decision_id' }),
  Object.freeze({ ownerDomain:'libra', scopeType:'libra_product_fact', table:'libra_product_fact_revisions', key:'product_fact_id' }),
  Object.freeze({ ownerDomain:'libra', scopeType:'libra_run', table:'libra_runs', key:'libra_run_id' }),
  Object.freeze({ ownerDomain:'libra', scopeType:'libra_workspace', table:'libra_workspaces', key:'workspace_id' }),
  Object.freeze({ ownerDomain:'libra', scopeType:'libra_workspace_reference', table:'libra_workspaces', key:'workspace_id' }),
  Object.freeze({ ownerDomain:'libra', scopeType:'on_deck_package', table:'libra_product_packages', key:'on_deck_package_id' }),
  Object.freeze({ ownerDomain:'libra', scopeType:'routing_decision', table:'libra_routing_decisions', key:'routing_decision_id' }),
  Object.freeze({ ownerDomain:'libra', scopeType:'subject_decision_basis', table:'libra_decision_basis_revisions', key:'decision_basis_id' }),
  Object.freeze({ ownerDomain:'libra', scopeType:'workspace_cleanup_member', table:'libra_workspace_cleanup_members', key:'material_handle_id' }),
  Object.freeze({ ownerDomain:'libra', scopeType:'workspace_cleanup_scope', table:'libra_workspace_cleanup_scopes', key:'cleanup_scope_id' }),
  Object.freeze({ ownerDomain:'arca', scopeType:'acceptance_decision', table:'arca_acceptance_decisions', key:'acceptance_decision_id' }),
  Object.freeze({ ownerDomain:'arca', scopeType:'on_deck_run', table:'arca_ondeck_runs', key:'on_deck_run_id' }),
]);

function valueAfter(args, flag) {
  const assigned = args.find((arg) => arg.startsWith(`${flag}=`));
  if (assigned) return assigned.slice(flag.length + 1);
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
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

function typedScope(ownerDomain, scopeType, ids) {
  return ids.map((scopeId) => Object.freeze({ ownerDomain, scopeType, scopeId }));
}

function typedProcessScope(ownerDomain, processType, ids) {
  return ids.map((processId) => Object.freeze({ ownerDomain, processType, processId }));
}

function scopeKey(ownerDomain, scopeType, scopeId) {
  return `${ownerDomain}\u0000${scopeType}\u0000${scopeId}`;
}

function selectWorksByProcessScopes(database, processScopes) {
  const result = [];
  for (const scope of processScopes) {
    result.push(...database.prepare(`
      SELECT work_id,owner_domain,process_type,process_id,state
        FROM fx_supporting_works
       WHERE owner_domain=? AND process_type=? AND process_id=?
       ORDER BY work_id
    `).all(scope.ownerDomain, scope.processType, scope.processId));
  }
  return result.sort((left, right) => left.work_id.localeCompare(right.work_id));
}

function selectArtifactsByOwnerScopes(database, ownerScopes) {
  const result = [];
  for (const scope of ownerScopes) {
    result.push(...database.prepare(`
      SELECT artifact_handle_id,owner_domain,owner_scope_type,owner_scope_id
        FROM fx_artifact_registry
       WHERE owner_domain=? AND owner_scope_type=? AND owner_scope_id=?
       ORDER BY artifact_handle_id
    `).all(scope.ownerDomain, scope.scopeType, scope.scopeId));
  }
  return result.sort((left, right) => left.artifact_handle_id.localeCompare(right.artifact_handle_id));
}

function tableExists(database, tableName) {
  return Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(tableName));
}

function assertRequiredSchema(database) {
  const required = [
    'arca_acceptance_attempts', 'arca_acceptance_checks', 'arca_acceptance_decisions',
    'arca_acceptance_recovery_cases', 'arca_final_inventory_decisions', 'arca_handoff_b_receipts',
    'arca_material_bindings', 'arca_offload_completions', 'arca_ondeck_commit_receipts',
    'arca_ondeck_custodies', 'arca_ondeck_runs', 'arca_ondeck_settlement_approvals',
    'fx_artifact_references', 'fx_artifact_registry', 'fx_audit_records', 'fx_command_receipts',
    'fx_commit_markers', 'fx_effect_journal', 'fx_event_attempts', 'fx_event_progress',
    'fx_event_resource_timings', 'fx_event_result_bindings', 'fx_inbox', 'fx_material_control_revisions',
    'fx_material_controls', 'fx_outbox', 'fx_outbox_deliveries', 'fx_plan_edges', 'fx_plan_nodes',
    'fx_resource_defer', 'fx_supporting_works', 'fx_work_attempts', 'fx_workflow_events',
    'fx_workflow_plans', 'fx_workspace_materials', 'fx_workspace_registry',
    'libra_acceptance_specs', 'libra_decision_basis_inputs', 'libra_decision_basis_revisions',
    'libra_delivery_receipts', 'libra_formation_projections', 'libra_handoff_a_receipts',
    'libra_intake_decisions', 'libra_intake_rejection_reason_evidence',
    'libra_intake_resolution_episode_overlaps', 'libra_intake_resolution_match_witnesses',
    'libra_material_binding_episode_claims', 'libra_material_bindings', 'libra_offload_context_materials',
    'libra_predeck_pipeline_tokens', 'libra_product_fact_revisions', 'libra_product_fact_source_refs',
    'libra_product_identity_revisions', 'libra_product_identity_selection_intents',
    'libra_product_package_artifact_refs', 'libra_product_package_fact_refs',
    'libra_product_package_material_episode_claims', 'libra_product_package_materials',
    'libra_product_packages', 'libra_routing_assessments', 'libra_routing_decisions',
    'libra_run_admission_heads', 'libra_run_discard_decisions', 'libra_run_discard_receipts',
    'libra_run_material_episode_claims', 'libra_run_material_manifests', 'libra_run_material_members',
    'libra_run_outcomes', 'libra_run_revisions', 'libra_runs', 'libra_subject_abandon_decisions',
    'libra_subject_abandon_receipts', 'libra_subject_decision_heads', 'libra_subject_episode_scopes',
    'libra_subject_season_continuity_claims', 'libra_subjects', 'libra_workspace_cleanup_members',
    'libra_workspace_cleanup_scopes', 'libra_workspace_material_refs', 'libra_workspace_revisions',
    'libra_workspaces', 'proc_candidate_deliveries', 'proc_run_materials',
  ];
  const missing = required.filter((table) => !tableExists(database, table));
  if (missing.length) {
    const error = new Error('FORMATION_RESET_SCHEMA_UNSUPPORTED');
    error.details = { missingTables: missing };
    throw error;
  }
}

function discoverEventlessFactMarkerOrphans(database) {
  return Object.freeze(EVENTLESS_FACT_MARKERS.flatMap((source) => database.prepare(`
    SELECT marker.commit_marker,marker.owner_domain,marker.scope_type,marker.scope_id,marker.result_id
      FROM fx_commit_markers marker
      LEFT JOIN fx_event_result_bindings result ON result.result_id=marker.result_id
      LEFT JOIN ${source.table} fact ON fact.${source.key}=marker.scope_id
     WHERE marker.owner_domain=? AND marker.scope_type=?
       AND fact.${source.key} IS NULL
       AND (marker.result_id IS NULL OR result.event_id IS NULL)
     ORDER BY marker.commit_marker
  `).all(source.ownerDomain, source.scopeType).map((row) => Object.freeze({ ...row }))));
}

function discoverReverseHandoffAClosures(database, includeMatched = false) {
  return database.prepare(`
    SELECT delivery.offer_id,delivery.candidate_package_id,delivery.state,
           delivery.handoff_decision_id,delivery.handoff_receipt_id,
           delivery.offered_at_ms,
           CASE WHEN EXISTS (
             SELECT 1
               FROM proc_run_materials material
               JOIN libra_run_material_members member ON member.material_key=material.material_key
               JOIN libra_run_material_manifests manifest
                 ON manifest.run_material_manifest_id=member.run_material_manifest_id
               JOIN libra_product_packages package ON package.libra_run_id=manifest.libra_run_id
               JOIN arca_ondeck_custodies custody ON custody.on_deck_package_id=package.on_deck_package_id
               JOIN arca_ondeck_runs ondeck ON ondeck.custody_id=custody.custody_id
               JOIN arca_ondeck_commit_receipts receipt ON receipt.on_deck_run_id=ondeck.on_deck_run_id
              WHERE material.candidate_package_id=delivery.candidate_package_id
           ) THEN 1 ELSE 0 END AS committed_material_overlap
      FROM proc_candidate_deliveries delivery
     WHERE delivery.state IN ('accepted','rejected')
       AND (${includeMatched ? '1' : '0'}=1 OR NOT EXISTS (
         SELECT 1 FROM libra_handoff_a_receipts receipt
          WHERE receipt.offer_id=delivery.offer_id
            AND receipt.candidate_package_id=delivery.candidate_package_id
            AND receipt.package_revision=delivery.package_revision
            AND receipt.package_digest=delivery.package_digest
            AND receipt.intake_decision_id=delivery.handoff_decision_id
            AND receipt.receipt_id=delivery.handoff_receipt_id
            AND receipt.outcome=delivery.state
       ))
     ORDER BY delivery.offer_id
  `).all().map((row) => Object.freeze({ ...row }));
}

function partitionReverseHandoffAClosures(database, closures, reservedCandidatePackageIds = []) {
  const candidatePackageIds = unique(closures.map((row) => row.candidate_package_id).filter(Boolean));
  const materialRows = rowsByIds(database,
    'SELECT candidate_package_id,material_key FROM proc_run_materials WHERE candidate_package_id IN',
    unique([...candidatePackageIds, ...reservedCandidatePackageIds]));
  const materialsByCandidate = new Map();
  for (const row of materialRows) {
    const values = materialsByCandidate.get(row.candidate_package_id) || [];
    values.push(row.material_key);
    materialsByCandidate.set(row.candidate_package_id, values);
  }
  const activeCandidatesByMaterial = new Map();
  for (const row of database.prepare(`SELECT candidate_package_id,material_key FROM proc_run_materials
    WHERE selection_state IN ('run_selection','candidate_delivery')`).all()) {
    const values = activeCandidatesByMaterial.get(row.material_key) || new Set();
    values.add(row.candidate_package_id);
    activeCandidatesByMaterial.set(row.material_key, values);
  }
  const selectedCandidateIds = new Set(reservedCandidatePackageIds);
  const selectedMaterialOwners = new Map();
  for (const candidatePackageId of reservedCandidatePackageIds) {
    for (const materialKey of materialsByCandidate.get(candidatePackageId) || []) {
      selectedMaterialOwners.set(materialKey, candidatePackageId);
    }
  }
  const actionable = [], superseded = [];
  const candidates = closures.filter((row) => row.committed_material_overlap === 0)
    .sort((left, right) => Number(right.offered_at_ms || 0) - Number(left.offered_at_ms || 0)
      || right.offer_id.localeCompare(left.offer_id));
  for (const closure of candidates) {
    if (selectedCandidateIds.has(closure.candidate_package_id)) continue;
    const materialKeys = materialsByCandidate.get(closure.candidate_package_id) || [];
    const conflicts = materialKeys.some((materialKey) => {
      const activeCandidates = activeCandidatesByMaterial.get(materialKey) || new Set();
      if ([...activeCandidates].some((candidatePackageId) => candidatePackageId !== closure.candidate_package_id)) return true;
      const selectedOwner = selectedMaterialOwners.get(materialKey);
      return Boolean(selectedOwner && selectedOwner !== closure.candidate_package_id);
    });
    if (conflicts) {
      superseded.push(closure);
      continue;
    }
    actionable.push(closure);
    selectedCandidateIds.add(closure.candidate_package_id);
    for (const materialKey of materialKeys) selectedMaterialOwners.set(materialKey, closure.candidate_package_id);
  }
  return Object.freeze({ actionable:Object.freeze(actionable), superseded:Object.freeze(superseded) });
}

function discoverScope(database, options = {}) {
  const supersededOfferIds=options.supersededOfferIds;
  if(supersededOfferIds!==undefined&&(!Array.isArray(supersededOfferIds)||!supersededOfferIds.length||supersededOfferIds.length>32||
    supersededOfferIds.some(id=>typeof id!=='string'||!/^[a-zA-Z0-9_-]+$/.test(id))))throw new Error('FORMATION_RESET_SUPERSEDED_SCOPE_INVALID');
  if (options.subjectIds !== undefined && !Array.isArray(options.subjectIds)) throw new Error('FORMATION_RESET_SUBJECT_SCOPE_INVALID');
  const requestedOrphans = options.orphanCustodyIds;
  if (requestedOrphans !== undefined && (!Array.isArray(requestedOrphans) || !requestedOrphans.length || requestedOrphans.length > 16 ||
      requestedOrphans.some(id => typeof id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(id)))) throw new Error('FORMATION_RESET_ORPHAN_CUSTODY_SCOPE_INVALID');
  const orphanCustodyIds = requestedOrphans === undefined ? null : unique(requestedOrphans);
  const selected = options.subjectIds === undefined ? (orphanCustodyIds || supersededOfferIds ? [] : null) : unique(options.subjectIds);
  if (options.subjectIds !== undefined && (!selected.length || selected.some(id => !/^[a-zA-Z0-9_-]+$/.test(id)))) {
    throw new Error('FORMATION_RESET_SUBJECT_SCOPE_INVALID');
  }
  const scoped = selected !== null;
  const globalOnly = rows => scoped ? [] : rows;
  assertRequiredSchema(database);
  for (const id of orphanCustodyIds || []) {
    if (database.prepare('SELECT 1 FROM arca_ondeck_custodies WHERE custody_id=?').get(id) ||
        database.prepare('SELECT 1 FROM arca_ondeck_runs WHERE custody_id=?').get(id))
      throw new Error('FORMATION_RESET_CUSTODY_NOT_ORPHAN');
    const inventory = database.prepare("SELECT 1 FROM fx_material_controls c JOIN arca_inventory_materials i USING(material_key) WHERE c.owner_domain='arca' AND c.owner_scope_type='on_deck_custody' AND c.owner_scope_id=? LIMIT 1").get(id);
    if (inventory) throw new Error('FORMATION_RESET_ORPHAN_CUSTODY_INVENTORY_PROTECTED');
  }
  const orphanPipelineTokens = database.prepare(`
    SELECT token.subject_id,token.source_field_id,token.source_process_id,token.acquired_at_ms
      FROM libra_predeck_pipeline_tokens token
      LEFT JOIN libra_subjects subject ON subject.subject_id=token.subject_id
     WHERE subject.subject_id IS NULL
     ORDER BY token.subject_id
  `).all().filter(row => !scoped || selected.includes(row.subject_id));
  const orphanPipelineTokenSubjectIds = unique(orphanPipelineTokens.map((row) => row.subject_id));
  const orphanPipelineSourceProcessIds = unique(orphanPipelineTokens.map((row) => row.source_process_id));
  const orphanPipelineAdmissionReceipts = database.prepare(`
    SELECT receipt.command_receipt_id,receipt.target_id,token.source_process_id,token.subject_id
      FROM libra_predeck_pipeline_tokens token
      LEFT JOIN libra_subjects subject ON subject.subject_id=token.subject_id
      JOIN fx_command_receipts receipt
        ON receipt.owner_domain='libra'
       AND receipt.command_contract='helix.foundation.work.submit@1'
       AND receipt.caller_scope='libra:' || token.source_process_id || '/evidence'
      LEFT JOIN fx_supporting_works target_work ON target_work.work_id=receipt.target_id
     WHERE subject.subject_id IS NULL AND target_work.work_id IS NULL
     ORDER BY receipt.command_receipt_id
  `).all().filter(row => !scoped || selected.includes(row.subject_id));
  const orphanPipelineAdmissionReceiptIds = unique(orphanPipelineAdmissionReceipts.map((row) => row.command_receipt_id));
  const orphanPipelineAdmissionTargetIds = unique(orphanPipelineAdmissionReceipts.map((row) => row.target_id));
  const phantomLibraAdmissionReceipts = globalOnly(database.prepare(`
    SELECT receipt.command_receipt_id,receipt.caller_scope,receipt.target_id,receipt.committed_at_ms
      FROM fx_command_receipts receipt
      LEFT JOIN fx_supporting_works target_work ON target_work.work_id=receipt.target_id
     WHERE receipt.owner_domain='libra'
       AND receipt.command_contract='helix.foundation.work.submit@1'
       AND target_work.work_id IS NULL
     ORDER BY receipt.command_receipt_id
  `).all());
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
  `).filter(id => !scoped || selected.includes(database.prepare('SELECT subject_id FROM libra_product_packages WHERE on_deck_package_id=?').get(id).subject_id));
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
  `).filter(id => !scoped || selected.includes(database.prepare('SELECT subject_id FROM libra_runs WHERE libra_run_id=?').get(id).subject_id));
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
  `).filter(id => !scoped || selected.includes(id));
  if (scoped && selected.some(id => committedSubjectIds.includes(id))) throw new Error('FORMATION_RESET_COMMITTED_SUBJECT_REFUSED');
  const runSubjectIds = runIds.length
    ? rowsByIds(database, 'SELECT DISTINCT subject_id FROM libra_runs WHERE libra_run_id IN', runIds, 'ORDER BY subject_id')
      .map((row) => row.subject_id).filter(Boolean)
    : [];
  const resetSubjectIds = unique([...disposableSubjectIds, ...runSubjectIds]);
  const pipelineTokenSubjectIds = unique([...resetSubjectIds, ...orphanPipelineTokenSubjectIds]);
  const pipelineSourceProcessIds = unique([
    ...orphanPipelineSourceProcessIds,
    ...rowsByIds(database, 'SELECT source_process_id FROM libra_predeck_pipeline_tokens WHERE subject_id IN',
      pipelineTokenSubjectIds).map((row) => row.source_process_id).filter(Boolean),
  ]);
  const runWorkspaceIds = runIds.length
    ? rowsByIds(database, 'SELECT workspace_id FROM libra_workspaces WHERE libra_run_id IN', runIds, 'ORDER BY workspace_id')
      .map((row) => row.workspace_id)
    : [];
  const orphanWorkspaceIds = unique(globalOnly([
    ...oneColumn(database, `SELECT registry.workspace_id FROM fx_workspace_registry registry
      LEFT JOIN libra_workspaces workspace ON workspace.workspace_id=registry.workspace_id
      WHERE registry.owner_domain='libra' AND registry.process_type='libra_run' AND workspace.workspace_id IS NULL
      ORDER BY registry.workspace_id`),
    ...oneColumn(database, `SELECT material.workspace_id FROM fx_workspace_materials material
      LEFT JOIN libra_workspaces workspace ON workspace.workspace_id=material.workspace_id
      WHERE material.owner_domain='libra' AND workspace.workspace_id IS NULL ORDER BY material.workspace_id`),
  ]));
  const workspaceIds = unique([...runWorkspaceIds, ...orphanWorkspaceIds]);
  const cleanupScopeIds = unique([
    ...rowsByIds(database, 'SELECT cleanup_scope_id FROM libra_workspace_cleanup_scopes WHERE libra_run_id IN', runIds,
      'ORDER BY cleanup_scope_id').map((row) => row.cleanup_scope_id),
    ...globalOnly(oneColumn(database, `SELECT cleanup.cleanup_scope_id FROM libra_workspace_cleanup_scopes cleanup
      LEFT JOIN libra_runs run ON run.libra_run_id=cleanup.libra_run_id
      WHERE run.libra_run_id IS NULL ORDER BY cleanup.cleanup_scope_id`)),
  ]);
  const workspaceMaterialHandleIds = cleanupScopeIds.length
    ? rowsByIds(database, 'SELECT DISTINCT material_handle_id FROM libra_workspace_cleanup_members WHERE cleanup_scope_id IN', cleanupScopeIds)
      .map((row) => row.material_handle_id).filter(Boolean)
    : [];
  const onDeckRunIds = oneColumn(database, `
    SELECT r.on_deck_run_id FROM arca_ondeck_runs r
     WHERE NOT EXISTS (SELECT 1 FROM arca_ondeck_commit_receipts cr WHERE cr.on_deck_run_id=r.on_deck_run_id)
     ORDER BY r.on_deck_run_id
  `).filter(id => !scoped || packageIds.includes(database.prepare(`SELECT custody.on_deck_package_id FROM arca_ondeck_runs run JOIN arca_ondeck_custodies custody ON custody.custody_id=run.custody_id WHERE run.on_deck_run_id=?`).get(id)?.on_deck_package_id));
  const custodyIds = unique([
    ...(orphanCustodyIds || []),
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
    ...globalOnly(oneColumn(database, "SELECT acceptance_decision_id FROM arca_acceptance_decisions WHERE result='rejected' ORDER BY acceptance_decision_id")),
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
    ...globalOnly(oneColumn(database, "SELECT intake_decision_id FROM libra_intake_decisions WHERE decision_kind='rejected_acceptance' ORDER BY intake_decision_id")),
  ]);
  const decisionBasisIds = disposableSubjectIds.length
    ? rowsByIds(database, 'SELECT decision_basis_id FROM libra_decision_basis_revisions WHERE subject_id IN', disposableSubjectIds)
      .map((row) => row.decision_basis_id)
    : [];
  const routingAssessmentIds = disposableSubjectIds.length
    ? rowsByIds(database, 'SELECT routing_assessment_id FROM libra_routing_assessments WHERE subject_id IN', disposableSubjectIds)
      .map((row) => row.routing_assessment_id)
    : [];
  const routingDecisionIds = disposableSubjectIds.length
    ? rowsByIds(database, 'SELECT routing_decision_id FROM libra_routing_decisions WHERE subject_id IN', disposableSubjectIds)
      .map((row) => row.routing_decision_id)
    : [];
  const acceptanceSpecIds = disposableSubjectIds.length
    ? rowsByIds(database, 'SELECT acceptance_spec_id FROM libra_acceptance_specs WHERE subject_id IN', disposableSubjectIds)
      .map((row) => row.acceptance_spec_id)
    : [];
  const productFactIds = runIds.length
    ? rowsByIds(database, 'SELECT product_fact_id FROM libra_product_fact_revisions WHERE libra_run_id IN', runIds)
      .map((row) => row.product_fact_id)
    : [];
  const identitySelectionIntentIds = runIds.length
    ? rowsByIds(database, 'SELECT selection_intent_id FROM libra_product_identity_selection_intents WHERE libra_run_id IN', runIds)
      .map((row) => row.selection_intent_id)
    : [];
  const eventlessFactMarkerOrphans = globalOnly(discoverEventlessFactMarkerOrphans(database));
  const runManifestIds = runIds.length
    ? rowsByIds(database, 'SELECT run_material_manifest_id FROM libra_run_material_manifests WHERE libra_run_id IN', runIds)
      .map((row) => row.run_material_manifest_id)
    : [];
  const runOriginIntakeDecisionIds = runManifestIds.length
    ? rowsByIds(database, 'SELECT DISTINCT origin_intake_decision_id FROM libra_run_material_members WHERE run_material_manifest_id IN', runManifestIds)
      .map((row) => row.origin_intake_decision_id).filter(Boolean)
    : [];
  intakeDecisionIds.push(...runOriginIntakeDecisionIds, ...pipelineSourceProcessIds);
  const finalIntakeDecisionIds = unique(intakeDecisionIds);
  const scopedHandoffAOfferIds = unique([
    ...rowsByIds(database, 'SELECT offer_id FROM libra_intake_decisions WHERE intake_decision_id IN', finalIntakeDecisionIds)
      .map((row) => row.offer_id).filter(Boolean),
    ...rowsByIds(database, `SELECT offer_id FROM proc_candidate_deliveries WHERE handoff_decision_id IN`,
      pipelineSourceProcessIds, "AND state IN ('accepted','rejected')")
      .map((row) => row.offer_id).filter(Boolean),
  ]);
  const discoveredReverseClosures=discoverReverseHandoffAClosures(database);
  const reverseHandoffAClosures = supersededOfferIds
    ? discoveredReverseClosures.filter(row=>supersededOfferIds.includes(row.offer_id)) : globalOnly(discoveredReverseClosures);
  const scopedClosedDeliveries = discoverReverseHandoffAClosures(database, true)
    .filter(row => scopedHandoffAOfferIds.includes(row.offer_id));
  const closureByOffer = new Map([...reverseHandoffAClosures, ...scopedClosedDeliveries]
    .map(row => [row.offer_id,row]));
  const reversePartition = partitionReverseHandoffAClosures(database, [...closureByOffer.values()]);
  const reverseOfferIds = new Set(reverseHandoffAClosures.map(row => row.offer_id));
  const orphanProcurementHandoffAClosures = reversePartition.actionable.filter(row => reverseOfferIds.has(row.offer_id));
  const preservedCommittedHandoffAClosures = [...closureByOffer.values()]
    .filter((row) => row.committed_material_overlap === 1);
  const preservedSupersededHandoffAClosures = reversePartition.superseded;
  if(supersededOfferIds?.some(id=>!preservedSupersededHandoffAClosures.some(row=>row.offer_id===id)))
    throw new Error('FORMATION_RESET_OFFER_NOT_SUPERSEDED');
  const handoffAOfferIds = unique([
    ...scopedHandoffAOfferIds.filter(id => !scopedClosedDeliveries.some(row => row.offer_id===id)),
    ...reversePartition.actionable.map((row) => row.offer_id),
  ]);
  const handoffACandidatePackageIds = handoffAOfferIds.length
    ? rowsByIds(database, 'SELECT candidate_package_id FROM proc_candidate_deliveries WHERE offer_id IN', handoffAOfferIds)
      .map((row) => row.candidate_package_id).filter(Boolean)
    : [];
  const orphanFormationWorks = globalOnly(database.prepare(`
    SELECT work.work_id,work.owner_domain,work.process_type,work.process_id,work.state
      FROM fx_supporting_works work
     WHERE (work.owner_domain='libra' AND work.process_type='libra_run'
            AND NOT EXISTS (SELECT 1 FROM libra_runs run WHERE run.libra_run_id=work.process_id))
        OR (work.owner_domain='libra' AND work.process_type='libra_intake'
            AND NOT EXISTS (SELECT 1 FROM libra_intake_decisions decision WHERE decision.intake_decision_id=work.process_id))
        OR (work.owner_domain='libra' AND work.process_type IN ('libra_routing','libra_acceptance_spec')
            AND NOT EXISTS (SELECT 1 FROM libra_subjects subject WHERE subject.subject_id=work.process_id))
        OR (work.owner_domain='arca' AND work.process_type IN ('arca_ondeck_run','arca_on_deck_run')
            AND NOT EXISTS (SELECT 1 FROM arca_ondeck_runs ondeck WHERE ondeck.on_deck_run_id=work.process_id))
        OR (work.owner_domain='arca' AND work.process_type='arca_acceptance'
            AND NOT EXISTS (SELECT 1 FROM libra_product_packages package WHERE package.offer_id=work.process_id))
     ORDER BY work.work_id
  `).all());
  const processScopes = Object.freeze([
    ...typedProcessScope('libra', 'libra_intake', finalIntakeDecisionIds),
    ...typedProcessScope('libra', 'libra_routing', disposableSubjectIds),
    ...typedProcessScope('libra', 'libra_acceptance_spec', disposableSubjectIds),
    ...typedProcessScope('libra', 'libra_run', runIds),
    ...typedProcessScope('arca', 'arca_acceptance', offerIds),
    ...typedProcessScope('arca', 'arca_ondeck_run', onDeckRunIds),
    ...typedProcessScope('arca', 'arca_on_deck_run', onDeckRunIds),
    ...orphanFormationWorks.map((row) => Object.freeze({ ownerDomain:row.owner_domain,
      processType:row.process_type, processId:row.process_id })),
  ]);
  const orphanOwnedArtifacts = globalOnly(database.prepare(`
    SELECT artifact.artifact_handle_id,artifact.owner_domain,artifact.owner_scope_type,artifact.owner_scope_id
      FROM fx_artifact_registry artifact
     WHERE artifact.owner_domain='libra' AND (
       (artifact.owner_scope_type='libra_run' AND NOT EXISTS (
         SELECT 1 FROM libra_runs run WHERE run.libra_run_id=artifact.owner_scope_id)) OR
       (artifact.owner_scope_type IN ('libra_workspace','workspace') AND NOT EXISTS (
         SELECT 1 FROM libra_workspaces workspace WHERE workspace.workspace_id=artifact.owner_scope_id)) OR
       (artifact.owner_scope_type='on_deck_package' AND NOT EXISTS (
         SELECT 1 FROM libra_product_packages package WHERE package.on_deck_package_id=artifact.owner_scope_id)))
     ORDER BY artifact.artifact_handle_id
  `).all());
  const ownerScopes = Object.freeze([
    ...typedScope('libra', 'libra_run', runIds),
    ...typedScope('libra', 'libra_workspace', workspaceIds),
    ...typedScope('libra', 'workspace', workspaceIds),
    ...typedScope('libra', 'on_deck_package', packageIds),
    ...orphanOwnedArtifacts.map((row) => Object.freeze({ ownerDomain:row.owner_domain,
      scopeType:row.owner_scope_type, scopeId:row.owner_scope_id })),
  ]);
  const ownedArtifacts = selectArtifactsByOwnerScopes(database, ownerScopes);
  const artifactIds = unique([
    ...rowsByIds(database, 'SELECT artifact_handle_id FROM libra_product_package_artifact_refs WHERE on_deck_package_id IN', packageIds)
      .map((row) => row.artifact_handle_id),
    ...ownedArtifacts.map((row) => row.artifact_handle_id),
    ...orphanOwnedArtifacts.map((row) => row.artifact_handle_id),
  ]);
  const retainedSubjectIds = resetSubjectIds.filter((id) => !disposableSubjectIds.includes(id));
  const runMaterialKeys = rowsByIds(database,
    'SELECT material_key FROM libra_run_material_members WHERE run_material_manifest_id IN', runManifestIds)
    .map((row) => row.material_key);
  const handoffAMaterialKeys = unique(rowsByIds(database,
    'SELECT material_key FROM proc_run_materials WHERE candidate_package_id IN', handoffACandidatePackageIds)
    .map((row) => row.material_key));
  const subjectControlMaterialKeys = unique([
    ...rowsByIds(database, 'SELECT material_key FROM libra_material_bindings WHERE subject_id IN', disposableSubjectIds)
      .map((row) => row.material_key),
    ...rowsByIds(database, 'SELECT material_key FROM libra_material_bindings WHERE origin_intake_decision_id IN',
      retainedSubjectIds.length ? finalIntakeDecisionIds : []).map((row) => row.material_key),
    ...runMaterialKeys,
    ...handoffAMaterialKeys,
  ]);
  const materialKeys = unique([
    ...rowsByIds(database, "SELECT material_key FROM fx_material_controls WHERE owner_scope_id IN", custodyIds,
      "AND owner_domain='arca' AND owner_scope_type='on_deck_custody'").map(row => row.material_key),
    ...subjectControlMaterialKeys,
    ...runMaterialKeys,
    ...rowsByIds(database, "SELECT material_key FROM arca_material_bindings WHERE owner_object_id IN", custodyIds, "AND owner_object_type='on_deck_custody'")
      .map((row) => row.material_key),
    ...rowsByIds(database, 'SELECT material_key FROM libra_product_package_materials WHERE on_deck_package_id IN', packageIds)
      .map((row) => row.material_key),
    ...rowsByIds(database, 'SELECT material_key FROM fx_workspace_materials WHERE workspace_id IN', workspaceIds)
      .map((row) => row.material_key),
    ...handoffAMaterialKeys,
  ]);
  const factScopes = Object.freeze([
    ...typedScope('libra', 'subject', resetSubjectIds),
    ...typedScope('libra', 'intake_decision', finalIntakeDecisionIds),
    ...typedScope('libra', 'routing_decision', unique(routingDecisionIds)),
    ...typedScope('libra', 'acceptance_spec', unique(acceptanceSpecIds)),
    ...typedScope('libra', 'libra_product_fact', unique(productFactIds)),
    ...typedScope('libra', 'libra_run', runIds),
    ...typedScope('libra', 'libra_workspace', workspaceIds),
    ...typedScope('libra', 'libra_workspace_reference', workspaceIds),
    ...typedScope('libra', 'on_deck_package', packageIds),
    ...typedScope('libra', 'subject_decision_basis', unique(decisionBasisIds)),
    ...typedScope('libra', 'workspace_cleanup_member', unique(workspaceMaterialHandleIds)),
    ...typedScope('libra', 'workspace_cleanup_scope', cleanupScopeIds),
    ...typedScope('arca', 'acceptance_decision', acceptanceDecisionIds),
    ...typedScope('arca', 'on_deck_run', onDeckRunIds),
  ]);
  const worksById = new Map([...selectWorksByProcessScopes(database, processScopes), ...orphanFormationWorks]
    .map((row) => [row.work_id, row]));
  const works = [...worksById.values()].sort((left, right) => left.work_id.localeCompare(right.work_id));
  const commandTargetScopes = Object.freeze([
    ...works.map((row) => Object.freeze({ ownerDomain:row.owner_domain,
      targetType:'supporting_work', targetId:row.work_id })),
    ...unique(decisionBasisIds).map((targetId) => Object.freeze({ ownerDomain:'libra', targetType:'decision_basis', targetId })),
    ...unique(identitySelectionIntentIds).map((targetId) => Object.freeze({ ownerDomain:'libra',
      targetType:'product_identity_selection_intent', targetId })),
  ]);
  return Object.freeze({
    committed: Object.freeze({ onDeckRunIds:committedOnDeckRunIds, packageIds:committedPackageIds,
      runIds:committedRunIds, subjectIds:committedSubjectIds }),
    selectedSubjectIds:selected,
    disposableSubjectIds:Object.freeze(disposableSubjectIds), resetSubjectIds:Object.freeze(resetSubjectIds),
    pipelineTokenSubjectIds:Object.freeze(pipelineTokenSubjectIds),
    orphanPipelineTokens:Object.freeze(orphanPipelineTokens.map((row) => Object.freeze({ ...row }))),
    orphanPipelineSourceProcessIds:Object.freeze(orphanPipelineSourceProcessIds),
    pipelineSourceProcessIds:Object.freeze(pipelineSourceProcessIds),
    orphanPipelineAdmissionReceipts:Object.freeze(orphanPipelineAdmissionReceipts.map((row) => Object.freeze({ ...row }))),
    orphanPipelineAdmissionReceiptIds:Object.freeze(orphanPipelineAdmissionReceiptIds),
    orphanPipelineAdmissionTargetIds:Object.freeze(orphanPipelineAdmissionTargetIds),
    phantomLibraAdmissionReceipts:Object.freeze(phantomLibraAdmissionReceipts.map((row) => Object.freeze({ ...row }))),
    phantomLibraAdmissionReceiptIds:Object.freeze(phantomLibraAdmissionReceiptIds),
    runIds:Object.freeze(runIds), workspaceIds:Object.freeze(workspaceIds), cleanupScopeIds:Object.freeze(cleanupScopeIds),
    packageIds:Object.freeze(packageIds), offerIds:Object.freeze(offerIds), intakeDecisionIds:Object.freeze(finalIntakeDecisionIds),
    handoffAOfferIds:Object.freeze(handoffAOfferIds),
    handoffACandidatePackageIds:Object.freeze(unique(handoffACandidatePackageIds)),
    handoffAMaterialKeys:Object.freeze(handoffAMaterialKeys),
    orphanProcurementHandoffAClosures:Object.freeze(orphanProcurementHandoffAClosures),
    preservedCommittedHandoffAClosures:Object.freeze(preservedCommittedHandoffAClosures),
    preservedSupersededHandoffAClosures:Object.freeze(preservedSupersededHandoffAClosures),
    acceptanceAttemptIds:Object.freeze(acceptanceAttemptIds), acceptanceDecisionIds:Object.freeze(acceptanceDecisionIds),
    custodyIds:Object.freeze(custodyIds), onDeckRunIds:Object.freeze(onDeckRunIds), artifactIds:Object.freeze(artifactIds),
    decisionBasisIds:Object.freeze(unique(decisionBasisIds)), routingAssessmentIds:Object.freeze(unique(routingAssessmentIds)),
    routingDecisionIds:Object.freeze(unique(routingDecisionIds)), acceptanceSpecIds:Object.freeze(unique(acceptanceSpecIds)),
    productFactIds:Object.freeze(unique(productFactIds)),
    identitySelectionIntentIds:Object.freeze(unique(identitySelectionIntentIds)),
    runManifestIds:Object.freeze(unique(runManifestIds)),
    workspaceMaterialHandleIds:Object.freeze(unique(workspaceMaterialHandleIds)),
    eventlessFactMarkerOrphans,
    materialKeys:Object.freeze(materialKeys), subjectControlMaterialKeys:Object.freeze(subjectControlMaterialKeys),
    processScopes, ownerScopes, factScopes, commandTargetScopes,
    ownedArtifacts:Object.freeze(ownedArtifacts.map((row) => Object.freeze({ ...row }))), works:Object.freeze(works),
    orphanWorkspaceIds:Object.freeze(orphanWorkspaceIds),
  });
}

function controlBelongsToScope(row, scope) {
  if (!row || row.state !== 'controlled') return false;
  if (row.owner_domain === 'libra') {
    if (row.owner_scope_type === 'subject') return (scope.pipelineTokenSubjectIds.includes(row.owner_scope_id) &&
      scope.subjectControlMaterialKeys.includes(row.material_key)) || scope.handoffAMaterialKeys.includes(row.material_key);
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
    acceptedSubjectIds:Object.freeze(acceptedSubjectIds.filter(id => !scope.selectedSubjectIds || scope.selectedSubjectIds.includes(id))),
    activeRunsWithoutHead:Object.freeze(activeRunsWithoutHead),
    pipelineTokens:scope.orphanPipelineTokens,
  });
}

function inspectBlockers(database, scope) {
  const blockers = [];
  if (scope.selectedSubjectIds) {
    const outsideIntakes = rowsByIds(database,
      'SELECT intake_decision_id,target_subject_id FROM libra_intake_decisions WHERE intake_decision_id IN', scope.intakeDecisionIds)
      .filter(row => row.target_subject_id && !scope.selectedSubjectIds.includes(row.target_subject_id));
    if (outsideIntakes.length) blockers.push({code:'INTAKE_SHARED_OUTSIDE_SELECTED_SUBJECTS',rows:outsideIntakes});
    const outsideBindings = rowsByIds(database,
      'SELECT subject_id,origin_intake_decision_id FROM libra_material_bindings WHERE origin_intake_decision_id IN', scope.intakeDecisionIds)
      .filter(row => !scope.selectedSubjectIds.includes(row.subject_id));
    if (outsideBindings.length) blockers.push({code:'INTAKE_BINDING_OUTSIDE_SELECTED_SUBJECTS',rows:outsideBindings});
    const linkedRuns = rowsByIds(database,
      'SELECT libra_run_id,subject_id FROM libra_runs WHERE supersedes_run_id IN', scope.runIds)
      .concat(rowsByIds(database,'SELECT libra_run_id,subject_id FROM libra_runs WHERE superseded_by_run_id IN',scope.runIds))
      .filter(row => !scope.runIds.includes(row.libra_run_id));
    if (linkedRuns.length) blockers.push({code:'RUN_CONTINUITY_OUTSIDE_SELECTED_SUBJECTS',rows:linkedRuns});
  }
  const protectedOverlap = {
    onDeckRunIds: scope.onDeckRunIds.filter((id) => scope.committed.onDeckRunIds.includes(id)),
    packageIds: scope.packageIds.filter((id) => scope.committed.packageIds.includes(id)),
    runIds: scope.runIds.filter((id) => scope.committed.runIds.includes(id)),
  };
  if (Object.values(protectedOverlap).some((items) => items.length)) blockers.push({ code:'COMMITTED_SCOPE_OVERLAP', ...protectedOverlap });
  const retainedSubjectIds = scope.resetSubjectIds.filter((id) => !scope.disposableSubjectIds.includes(id));
  const unsafeRetainedAnchors = rowsByIds(database,
    'SELECT subject_id,routing_anchor_intake_decision_id FROM libra_subjects WHERE subject_id IN', retainedSubjectIds)
    .filter((row) => scope.intakeDecisionIds.includes(row.routing_anchor_intake_decision_id));
  if (unsafeRetainedAnchors.length) blockers.push({ code:'RETAINED_SUBJECT_ROUTING_ANCHOR_IN_RESET', rows:unsafeRetainedAnchors });
  const controls = rowsByIds(database, 'SELECT * FROM fx_material_controls WHERE material_key IN', scope.materialKeys);
  const foreignControls = controls.filter((row) => row.state === 'controlled' &&
    !controlBelongsToScope(row, scope) && !controlIsPreservedProcurement(row));
  if (foreignControls.length) blockers.push({ code:'MATERIAL_CONTROL_OWNED_BY_NON_TARGET', rows:foreignControls });
  if (scope.artifactIds.length) {
    const allowedConsumers = new Set(scope.factScopes.map((item) => scopeKey(item.ownerDomain, item.scopeType, item.scopeId)));
    const external = rowsByIds(database, 'SELECT * FROM fx_artifact_references WHERE artifact_handle_id IN', scope.artifactIds)
      .filter((row) => !allowedConsumers.has(scopeKey(row.consumer_domain, row.consumer_scope_type, row.consumer_scope_id)));
    if (external.length) blockers.push({ code:'ARTIFACT_REFERENCED_OUTSIDE_RESET', rows:external });
    const packageReferences = rowsByIds(database,
      'SELECT on_deck_package_id,artifact_handle_id FROM libra_product_package_artifact_refs WHERE artifact_handle_id IN',
      scope.artifactIds).filter((row) => !scope.packageIds.includes(row.on_deck_package_id));
    if (packageReferences.length) blockers.push({ code:'ARTIFACT_USED_BY_PROTECTED_PACKAGE', rows:packageReferences });
  }
  return Object.freeze(blockers);
}

function inspectPlan(database, options = {}) {
  const scope = discoverScope(database, options);
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
    procurementHandoffAClosures:scope.handoffAOfferIds.length,
    orphanProcurementHandoffAClosures:scope.orphanProcurementHandoffAClosures.length,
    preservedCommittedHandoffAClosures:scope.preservedCommittedHandoffAClosures.length,
    preservedSupersededHandoffAClosures:scope.preservedSupersededHandoffAClosures.length,
    eventlessFactMarkerOrphans:scope.eventlessFactMarkerOrphans.length,
    orphanRoutingDecisionMarkers:scope.eventlessFactMarkerOrphans.filter((row) => row.scope_type === 'routing_decision').length,
    orphanAcceptanceSpecMarkers:scope.eventlessFactMarkerOrphans.filter((row) => row.scope_type === 'acceptance_spec').length,
  });
  return Object.freeze({ confirmationRequired:CONFIRMATION, ready:blockers.length === 0,
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

function stageWorkspaceDirectories(transcodeDir, dataDir, workspaceIds, manifestDigest) {
  if (!transcodeDir) return { configured:false, staged:[], absent:[...workspaceIds] };
  assertSafeTranscodeRoot(transcodeDir, dataDir);
  const root = path.resolve(transcodeDir);
  if (fs.existsSync(root) && fs.lstatSync(root).isSymbolicLink()) {
    throw new Error('FORMATION_RESET_TRANSCODE_ROOT_SYMLINK_REFUSED');
  }
  const staged = [], absent = [];
  try {
    for (const workspaceId of workspaceIds) {
      if (!/^[a-f0-9]{64}$/i.test(workspaceId)) throw new Error('FORMATION_RESET_WORKSPACE_ID_UNSAFE');
      const target = path.resolve(root, workspaceId);
      if (path.dirname(target) !== root) throw new Error('FORMATION_RESET_WORKSPACE_PATH_ESCAPE');
      if (!fs.existsSync(target)) { absent.push(workspaceId); continue; }
      const stat = fs.lstatSync(target);
      if (stat.isSymbolicLink()) throw new Error('FORMATION_RESET_WORKSPACE_SYMLINK_REFUSED');
      const stagedPath = path.resolve(root, `.formation-reset-${manifestDigest.slice(0, 16)}-${workspaceId}`);
      if (path.dirname(stagedPath) !== root || fs.existsSync(stagedPath)) {
        throw new Error('FORMATION_RESET_WORKSPACE_STAGE_CONFLICT');
      }
      fs.renameSync(target, stagedPath);
      staged.push(Object.freeze({ workspaceId, target, stagedPath }));
    }
  } catch (error) {
    restoreWorkspaceDirectories({ staged });
    throw error;
  }
  return { configured:true, staged, absent };
}

function restoreWorkspaceDirectories(stage) {
  for (const entry of [...stage.staged].reverse()) {
    if (!fs.existsSync(entry.stagedPath)) continue;
    if (fs.existsSync(entry.target)) throw new Error('FORMATION_RESET_WORKSPACE_RESTORE_CONFLICT');
    fs.renameSync(entry.stagedPath, entry.target);
  }
}

function finalizeWorkspaceDirectories(stage) {
  const removed = [];
  for (const entry of stage.staged) {
    if (!fs.existsSync(entry.stagedPath)) continue;
    fs.rmSync(entry.stagedPath, { recursive:true, force:false });
    removed.push(entry.workspaceId);
  }
  return Object.freeze({ configured:stage.configured, removed:Object.freeze(removed),
    absent:Object.freeze([...stage.absent]) });
}

function captureExecutionGraph(database, workIds, processScopes, factScopes, commandTargetScopes, orphanMarkers) {
  const attemptIds = rowsByIds(database, 'SELECT attempt_id FROM fx_work_attempts WHERE work_id IN', workIds).map((row) => row.attempt_id);
  const planIds = rowsByIds(database, 'SELECT plan_id FROM fx_workflow_plans WHERE attempt_id IN', attemptIds).map((row) => row.plan_id);
  const eventIds = unique([
    ...rowsByIds(database, 'SELECT event_id FROM fx_workflow_events WHERE work_id IN', workIds).map((row) => row.event_id),
    ...rowsByIds(database, 'SELECT event_id FROM fx_workflow_events WHERE plan_id IN', planIds).map((row) => row.event_id),
  ]);
  const eventAttemptIds = rowsByIds(database, 'SELECT event_attempt_id FROM fx_event_attempts WHERE event_id IN', eventIds).map((row) => row.event_attempt_id);
  const resultIdsFromEvents = rowsByIds(database, 'SELECT result_id FROM fx_event_result_bindings WHERE event_id IN', eventIds)
    .map((row) => row.result_id);
  const scopedMarkers = [];
  for (const scope of factScopes) {
    scopedMarkers.push(...database.prepare(`SELECT commit_marker,result_id FROM fx_commit_markers
      WHERE owner_domain=? AND scope_type=? AND scope_id=?`).all(scope.ownerDomain, scope.scopeType, scope.scopeId));
  }
  const markerIds = unique([
    ...rowsByIds(database, 'SELECT commit_marker FROM fx_commit_markers WHERE result_id IN', resultIdsFromEvents)
      .map((row) => row.commit_marker),
    ...scopedMarkers.map((row) => row.commit_marker),
    ...orphanMarkers.map((row) => row.commit_marker),
  ]);
  const resultIds = unique([
    ...resultIdsFromEvents,
    ...scopedMarkers.map((row) => row.result_id).filter(Boolean),
    ...orphanMarkers.map((row) => row.result_id).filter(Boolean),
  ]);
  const outboxScopes = [...processScopes, ...factScopes.map((item) => ({ ownerDomain:item.ownerDomain,
    processType:item.scopeType, processId:item.scopeId }))];
  const messageIds = unique(outboxScopes.flatMap((scope) => database.prepare(`SELECT message_id FROM fx_outbox
    WHERE producer_domain=? AND aggregate_type=? AND aggregate_id=?`).all(
    scope.ownerDomain, scope.processType, scope.processId).map((row) => row.message_id)));
  const auditIds = unique([
    ...rowsByIds(database, 'SELECT audit_id FROM fx_audit_records WHERE work_id IN', workIds).map((row) => row.audit_id),
    ...rowsByIds(database, 'SELECT audit_id FROM fx_audit_records WHERE event_id IN', eventIds).map((row) => row.audit_id),
    ...factScopes.flatMap((scope) => database.prepare(`SELECT audit_id FROM fx_audit_records
      WHERE owner_domain=? AND scope_type=? AND scope_id=?`).all(scope.ownerDomain, scope.scopeType, scope.scopeId)
      .map((row) => row.audit_id)),
  ]);
  const commandReceiptIds = unique(commandTargetScopes.flatMap((scope) => database.prepare(`
    SELECT command_receipt_id FROM fx_command_receipts
     WHERE owner_domain=? AND target_type=? AND target_id=?
  `).all(scope.ownerDomain, scope.targetType, scope.targetId).map((row) => row.command_receipt_id)));
  return Object.freeze({ workIds:unique(workIds), attemptIds:unique(attemptIds), planIds:unique(planIds), eventIds,
    eventAttemptIds:unique(eventAttemptIds), resultIds, markerIds, messageIds, auditIds,
    commandReceiptIds });
}

function deleteExecutionGraph(database, graph) {
  if(tableExists(database,'arca_inventory_verification_records'))
    executeByIds(database,'DELETE FROM arca_inventory_verification_records WHERE event_id IN',graph.eventIds);
  if(tableExists(database,'arca_staged_manifest_records'))
    executeByIds(database,'DELETE FROM arca_staged_manifest_records WHERE event_id IN',graph.eventIds);
  executeByIds(database, 'DELETE FROM fx_inbox WHERE message_id IN', graph.messageIds);
  executeByIds(database, 'DELETE FROM fx_outbox_deliveries WHERE message_id IN', graph.messageIds);
  executeByIds(database, 'DELETE FROM fx_outbox WHERE message_id IN', graph.messageIds);
  executeByIds(database, 'DELETE FROM fx_audit_records WHERE audit_id IN', graph.auditIds);
  executeByIds(database, 'DELETE FROM fx_command_receipts WHERE command_receipt_id IN', graph.commandReceiptIds);
  executeByIds(database, 'DELETE FROM fx_effect_journal WHERE event_attempt_id IN', graph.eventAttemptIds);
  executeByIds(database, 'DELETE FROM fx_event_resource_timings WHERE event_attempt_id IN', graph.eventAttemptIds);
  executeByIds(database, 'DELETE FROM fx_event_progress WHERE event_id IN', graph.eventIds);
  executeByIds(database, 'DELETE FROM fx_resource_defer WHERE event_id IN', graph.eventIds);
  executeByIds(database, 'DELETE FROM fx_commit_markers WHERE commit_marker IN', graph.markerIds);
  executeByIds(database, 'DELETE FROM fx_event_result_bindings WHERE result_id IN', graph.resultIds);
  executeByIds(database, 'DELETE FROM fx_event_attempts WHERE event_attempt_id IN', graph.eventAttemptIds);
  executeByIds(database, 'DELETE FROM fx_workflow_events WHERE event_id IN', graph.eventIds);
  executeByIds(database, 'DELETE FROM fx_plan_edges WHERE plan_id IN', graph.planIds);
  executeByIds(database, 'DELETE FROM fx_plan_nodes WHERE plan_id IN', graph.planIds);
  executeByIds(database, 'DELETE FROM fx_workflow_plans WHERE plan_id IN', graph.planIds);
  executeByIds(database, 'DELETE FROM fx_work_attempts WHERE attempt_id IN', graph.attemptIds);
  return executeByIds(database, 'DELETE FROM fx_supporting_works WHERE work_id IN', graph.workIds);
}

function rollbackRetainedSubjectIntakes(database, scope, nowMs) {
  const retainedSubjectIds = scope.resetSubjectIds.filter((id) => !scope.disposableSubjectIds.includes(id));
  if (!retainedSubjectIds.length || !scope.intakeDecisionIds.length) return 0;
  const retained = new Set(retainedSubjectIds);
  const decisions = rowsByIds(database, 'SELECT * FROM libra_intake_decisions WHERE intake_decision_id IN',
    scope.intakeDecisionIds).filter((row) => retained.has(row.target_subject_id));
  for (const decision of decisions) {
    if (decision.decision_kind !== 'accepted_resolution' || decision.accepted_result !== 'season_extension') continue;
    database.prepare(`DELETE FROM libra_material_binding_episode_claims
      WHERE subject_id=? AND EXISTS (SELECT 1 FROM libra_material_bindings binding
        WHERE binding.subject_id=libra_material_binding_episode_claims.subject_id
          AND binding.material_key=libra_material_binding_episode_claims.material_key
          AND binding.binding_revision=libra_material_binding_episode_claims.binding_revision
          AND binding.origin_intake_decision_id=?)`).run(decision.target_subject_id, decision.intake_decision_id);
    database.prepare('DELETE FROM libra_material_bindings WHERE subject_id=? AND origin_intake_decision_id=?')
      .run(decision.target_subject_id, decision.intake_decision_id);
    database.prepare('DELETE FROM libra_subject_episode_scopes WHERE subject_id=? AND first_intake_decision_id=?')
      .run(decision.target_subject_id, decision.intake_decision_id);
    database.prepare(`DELETE FROM libra_subject_season_continuity_claims
      WHERE subject_id=? AND provenance_kind='candidate' AND provenance_ref=?`)
      .run(decision.target_subject_id, decision.candidate_package_id);
    const updated = database.prepare(`UPDATE libra_subjects
      SET intake_revision=?,current_continuity_set_digest=?,current_episode_scope_digest=?,updated_at_ms=?
      WHERE subject_id=? AND intake_revision=?`)
      .run(decision.expected_target_intake_revision, decision.expected_target_continuity_set_digest,
        decision.expected_target_episode_scope_digest, nowMs, decision.target_subject_id,
        decision.committed_target_intake_revision).changes;
    if (updated !== 1) throw new Error('FORMATION_RESET_RETAINED_SUBJECT_ROLLBACK_FAILED');
  }
  return decisions.length;
}

function deleteFormationBusinessGraph(database, scope, nowMs) {
  rollbackRetainedSubjectIntakes(database, scope, nowMs);
  executeByIds(database, 'DELETE FROM arca_ondeck_settlement_approvals WHERE on_deck_run_id IN', scope.onDeckRunIds);
  executeByIds(database, 'DELETE FROM arca_final_inventory_decisions WHERE on_deck_run_id IN', scope.onDeckRunIds);
  executeByIds(database, 'DELETE FROM arca_offload_completions WHERE on_deck_run_id IN', scope.onDeckRunIds);
  executeByIds(database, 'DELETE FROM arca_material_bindings WHERE owner_object_id IN', scope.custodyIds,
    "AND owner_object_type='on_deck_custody'");
  executeByIds(database, 'DELETE FROM arca_ondeck_runs WHERE on_deck_run_id IN', scope.onDeckRunIds);
  executeByIds(database, 'DELETE FROM arca_ondeck_custodies WHERE custody_id IN', scope.custodyIds);
  executeByIds(database, 'DELETE FROM arca_handoff_b_receipts WHERE acceptance_decision_id IN', scope.acceptanceDecisionIds);
  if(tableExists(database,'arca_acceptance_check_evidence'))
    executeByIds(database, 'DELETE FROM arca_acceptance_check_evidence WHERE offer_id IN', scope.offerIds);
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
  executeByIds(database, 'DELETE FROM libra_run_outcomes WHERE libra_run_id IN', scope.runIds);
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

function rollbackControls(database, scope) {
  const controls = rowsByIds(database, 'SELECT * FROM fx_material_controls WHERE material_key IN', scope.materialKeys);
  let restoredProcurementControls = 0;
  let deletedMaterialControls = 0;
  let deletedControlRevisions = 0;
  for (const control of controls) {
    const revisions = database.prepare(`SELECT * FROM fx_material_control_revisions
      WHERE material_key=? ORDER BY revision`).all(control.material_key);
    const boundaryIndex = revisions.findIndex((revision) => controlBelongsToScope({
      material_key:control.material_key, state:'controlled', owner_domain:revision.to_owner_domain,
      owner_scope_type:revision.to_scope_type, owner_scope_id:revision.to_scope_id,
    }, scope));
    if (boundaryIndex < 0) continue;
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

function retireSupersededOfferMessages(database, closures) {
  // Keep historical terminal Delivery/Reservation facts, but remove the
  // publication that would recreate an Intake whose history Reset retired.
  // Only the already-partitioned superseded scope is eligible here.
  const keys = closures.map(row => `procurement_candidate_offer_available:${row.offer_id}`);
  for(const row of closures) {
    if(database.prepare('SELECT intake_decision_id FROM libra_intake_decisions WHERE offer_id=? LIMIT 1').get(row.offer_id))
      throw new Error('FORMATION_RESET_SUPERSEDED_INTAKE_OUTSIDE_SCOPE');
  }
  const messages = rowsByIds(database,
    'SELECT message_id FROM fx_outbox WHERE dedup_key IN', keys,
    "AND producer_domain='procurement' AND message_kind='procurement_candidate_offer_available'")
    .map(row => row.message_id);
  executeByIds(database, 'DELETE FROM fx_inbox WHERE message_id IN', messages);
  executeByIds(database, 'DELETE FROM fx_outbox_deliveries WHERE message_id IN', messages);
  return executeByIds(database, 'DELETE FROM fx_outbox WHERE message_id IN', messages);
}

function reopenProcurementHandoffA(database, scope, nowMs) {
  const offerIds = scope.handoffAOfferIds;
  const candidatePackageIds = scope.handoffACandidatePackageIds;
  if (!offerIds.length) return Object.freeze({ reopenedDeliveries:0, reopenedReservations:0,
    deletedInboxClosures:0, deletedOutboxMessages:0 });
  const dedupKeys = offerIds.flatMap((offerId) => [
    `libra_candidate_accepted:${offerId}`,
    `libra_candidate_rejected:${offerId}`,
  ]);
  const messageIds = rowsByIds(database,
    "SELECT message_id FROM fx_outbox WHERE dedup_key IN", dedupKeys, "AND producer_domain='libra'")
    .map((row) => row.message_id);
  executeByIds(database, 'DELETE FROM fx_outbox_deliveries WHERE message_id IN', messageIds);
  const deletedOutboxMessages = executeByIds(database, 'DELETE FROM fx_outbox WHERE message_id IN', messageIds);
  const deletedInboxClosures = executeByIds(database, 'DELETE FROM fx_inbox WHERE dedup_key IN', dedupKeys,
    "AND consumer_domain='procurement'");
  const reopenedReservations = executeByIds(database, `UPDATE proc_run_materials
    SET selection_state='candidate_delivery',terminal_disposition=NULL,terminal_evidence_digest=NULL,reservation_updated_at_ms=?
    WHERE candidate_package_id IN`, candidatePackageIds, "AND selection_state IN ('transferred','released')", [nowMs]);
  const reopenedDeliveries = executeByIds(database, `UPDATE proc_candidate_deliveries
    SET state='open',handoff_decision_id=NULL,handoff_decision_digest=NULL,handoff_receipt_id=NULL,
        handoff_receipt_digest=NULL,terminal_evidence_digest=NULL,closed_at_ms=NULL
    WHERE offer_id IN`, offerIds, "AND state IN ('accepted','rejected')");
  const residualDeliveries = rowsByIds(database,
    "SELECT offer_id,state FROM proc_candidate_deliveries WHERE offer_id IN", offerIds,
    "AND (state!='open' OR handoff_decision_id IS NOT NULL OR handoff_receipt_id IS NOT NULL OR terminal_evidence_digest IS NOT NULL)");
  const residualReservations = rowsByIds(database,
    'SELECT procurement_run_id,ordinal,selection_state FROM proc_run_materials WHERE candidate_package_id IN',
    candidatePackageIds, "AND (selection_state!='candidate_delivery' OR terminal_disposition IS NOT NULL OR terminal_evidence_digest IS NOT NULL)");
  const residualInbox = rowsByIds(database,
    "SELECT message_id FROM fx_inbox WHERE dedup_key IN", dedupKeys, "AND consumer_domain='procurement'");
  const residualOutbox = rowsByIds(database,
    "SELECT message_id FROM fx_outbox WHERE dedup_key IN", dedupKeys, "AND producer_domain='libra'");
  if (residualDeliveries.length || residualReservations.length || residualInbox.length || residualOutbox.length) {
    throw Object.assign(new Error('FORMATION_RESET_HANDOFF_A_REOPEN_FAILED'), {
      details:{ residualDeliveries, residualReservations, residualInbox, residualOutbox },
    });
  }
  return Object.freeze({ reopenedDeliveries, reopenedReservations, deletedInboxClosures, deletedOutboxMessages });
}

function assertIdsAbsent(database, table, column, ids, residual) {
  if (!ids.length) return;
  const rows = rowsByIds(database, `SELECT ${column} FROM ${table} WHERE ${column} IN`, ids);
  if (rows.length) residual[table] = rows;
}

function verifyFrozenManifest(database, manifest) {
  const { scope, graph } = manifest;
  const residual = {};
  assertIdsAbsent(database, 'libra_subjects', 'subject_id', scope.disposableSubjectIds, residual);
  assertIdsAbsent(database, 'libra_intake_decisions', 'intake_decision_id', scope.intakeDecisionIds, residual);
  assertIdsAbsent(database, 'libra_run_outcomes', 'libra_run_id', scope.runIds, residual);
  assertIdsAbsent(database, 'libra_runs', 'libra_run_id', scope.runIds, residual);
  assertIdsAbsent(database, 'libra_workspaces', 'workspace_id', scope.workspaceIds, residual);
  assertIdsAbsent(database, 'libra_product_packages', 'on_deck_package_id', scope.packageIds, residual);
  assertIdsAbsent(database, 'arca_acceptance_attempts', 'acceptance_attempt_id', scope.acceptanceAttemptIds, residual);
  assertIdsAbsent(database, 'arca_acceptance_decisions', 'acceptance_decision_id', scope.acceptanceDecisionIds, residual);
  assertIdsAbsent(database, 'arca_ondeck_custodies', 'custody_id', scope.custodyIds, residual);
  assertIdsAbsent(database, 'arca_ondeck_runs', 'on_deck_run_id', scope.onDeckRunIds, residual);
  assertIdsAbsent(database, 'fx_supporting_works', 'work_id', graph.workIds, residual);
  assertIdsAbsent(database, 'fx_work_attempts', 'attempt_id', graph.attemptIds, residual);
  assertIdsAbsent(database, 'fx_workflow_plans', 'plan_id', graph.planIds, residual);
  assertIdsAbsent(database, 'fx_workflow_events', 'event_id', graph.eventIds, residual);
  assertIdsAbsent(database, 'fx_event_attempts', 'event_attempt_id', graph.eventAttemptIds, residual);
  assertIdsAbsent(database, 'fx_event_result_bindings', 'result_id', graph.resultIds, residual);
  assertIdsAbsent(database, 'fx_commit_markers', 'commit_marker', graph.markerIds, residual);
  assertIdsAbsent(database, 'fx_artifact_registry', 'artifact_handle_id', scope.artifactIds, residual);
  assertIdsAbsent(database, 'fx_command_receipts', 'command_receipt_id',
    unique([...graph.commandReceiptIds, ...scope.phantomLibraAdmissionReceiptIds,
      ...scope.orphanPipelineAdmissionReceiptIds]), residual);

  const residualWorks = selectWorksByProcessScopes(database, scope.processScopes);
  if (residualWorks.length) residual.typedProcessWorks = residualWorks;
  const residualArtifacts = selectArtifactsByOwnerScopes(database, scope.ownerScopes);
  if (residualArtifacts.length) residual.typedOwnerArtifacts = residualArtifacts;
  const residualMarkers = scope.factScopes.flatMap((item) => database.prepare(`SELECT commit_marker FROM fx_commit_markers
    WHERE owner_domain=? AND scope_type=? AND scope_id=?`).all(item.ownerDomain, item.scopeType, item.scopeId));
  if (residualMarkers.length) residual.typedFactMarkers = residualMarkers;
  const residualControls = rowsByIds(database, 'SELECT * FROM fx_material_controls WHERE material_key IN', scope.materialKeys)
    .filter((row) => controlBelongsToScope(row, scope));
  if (residualControls.length) residual.materialControls = residualControls;
  const closedDeliveries = rowsByIds(database, 'SELECT offer_id,state,handoff_decision_id,handoff_receipt_id FROM proc_candidate_deliveries WHERE offer_id IN',
    scope.handoffAOfferIds).filter((row) => row.state !== 'open' || row.handoff_decision_id !== null || row.handoff_receipt_id !== null);
  if (closedDeliveries.length) residual.handoffADeliveries = closedDeliveries;
  const globalResiduals = {
    orphanProcurementHandoffAClosures:partitionReverseHandoffAClosures(database,
      discoverReverseHandoffAClosures(database)).actionable,
    uncommittedRuns:database.prepare(`SELECT run.libra_run_id FROM libra_runs run WHERE NOT EXISTS (
      SELECT 1 FROM libra_product_packages package
      JOIN arca_ondeck_custodies custody ON custody.on_deck_package_id=package.on_deck_package_id
      JOIN arca_ondeck_runs ondeck ON ondeck.custody_id=custody.custody_id
      JOIN arca_ondeck_commit_receipts receipt ON receipt.on_deck_run_id=ondeck.on_deck_run_id
      WHERE package.libra_run_id=run.libra_run_id)`).all(),
    uncommittedPackages:database.prepare(`SELECT package.on_deck_package_id FROM libra_product_packages package WHERE NOT EXISTS (
      SELECT 1 FROM arca_ondeck_custodies custody
      JOIN arca_ondeck_runs ondeck ON ondeck.custody_id=custody.custody_id
      JOIN arca_ondeck_commit_receipts receipt ON receipt.on_deck_run_id=ondeck.on_deck_run_id
      WHERE custody.on_deck_package_id=package.on_deck_package_id)`).all(),
    uncommittedOnDeckRuns:database.prepare(`SELECT ondeck.on_deck_run_id FROM arca_ondeck_runs ondeck
      WHERE NOT EXISTS (SELECT 1 FROM arca_ondeck_commit_receipts receipt
        WHERE receipt.on_deck_run_id=ondeck.on_deck_run_id)`).all(),
    orphanPipelineTokens:database.prepare(`SELECT token.subject_id FROM libra_predeck_pipeline_tokens token
      LEFT JOIN libra_subjects subject ON subject.subject_id=token.subject_id WHERE subject.subject_id IS NULL`).all(),
    phantomLibraAdmissionReceipts:database.prepare(`SELECT receipt.command_receipt_id FROM fx_command_receipts receipt
      LEFT JOIN fx_supporting_works work ON work.work_id=receipt.target_id
      WHERE receipt.owner_domain='libra' AND receipt.command_contract='helix.foundation.work.submit@1'
        AND work.work_id IS NULL`).all(),
    orphanRunWorks:database.prepare(`SELECT work.work_id FROM fx_supporting_works work
      LEFT JOIN libra_runs run ON run.libra_run_id=work.process_id
      WHERE work.owner_domain='libra' AND work.process_type='libra_run' AND run.libra_run_id IS NULL`).all(),
    orphanIntakeWorks:database.prepare(`SELECT work.work_id FROM fx_supporting_works work
      LEFT JOIN libra_intake_decisions decision ON decision.intake_decision_id=work.process_id
      WHERE work.owner_domain='libra' AND work.process_type='libra_intake' AND decision.intake_decision_id IS NULL`).all(),
    orphanOnDeckWorks:database.prepare(`SELECT work.work_id FROM fx_supporting_works work
      LEFT JOIN arca_ondeck_runs ondeck ON ondeck.on_deck_run_id=work.process_id
      WHERE work.owner_domain='arca' AND work.process_type IN ('arca_ondeck_run','arca_on_deck_run')
        AND ondeck.on_deck_run_id IS NULL`).all(),
    orphanSubjectWorks:database.prepare(`SELECT work.work_id FROM fx_supporting_works work
      LEFT JOIN libra_subjects subject ON subject.subject_id=work.process_id
      WHERE work.owner_domain='libra' AND work.process_type IN ('libra_routing','libra_acceptance_spec')
        AND subject.subject_id IS NULL`).all(),
    orphanAcceptanceWorks:database.prepare(`SELECT work.work_id FROM fx_supporting_works work
      LEFT JOIN libra_product_packages package ON package.offer_id=work.process_id
      WHERE work.owner_domain='arca' AND work.process_type='arca_acceptance'
        AND package.on_deck_package_id IS NULL`).all(),
    orphanRunArtifacts:database.prepare(`SELECT artifact.artifact_handle_id FROM fx_artifact_registry artifact
      LEFT JOIN libra_runs run ON run.libra_run_id=artifact.owner_scope_id
      WHERE artifact.owner_domain='libra' AND artifact.owner_scope_type='libra_run' AND run.libra_run_id IS NULL`).all(),
    orphanWorkspaceArtifacts:database.prepare(`SELECT artifact.artifact_handle_id FROM fx_artifact_registry artifact
      LEFT JOIN libra_workspaces workspace ON workspace.workspace_id=artifact.owner_scope_id
      WHERE artifact.owner_domain='libra' AND artifact.owner_scope_type IN ('libra_workspace','workspace')
        AND workspace.workspace_id IS NULL`).all(),
    orphanPackageArtifacts:database.prepare(`SELECT artifact.artifact_handle_id FROM fx_artifact_registry artifact
      LEFT JOIN libra_product_packages package ON package.on_deck_package_id=artifact.owner_scope_id
      WHERE artifact.owner_domain='libra' AND artifact.owner_scope_type='on_deck_package'
        AND package.on_deck_package_id IS NULL`).all(),
    orphanWorkspaceRegistry:database.prepare(`SELECT registry.workspace_id FROM fx_workspace_registry registry
      LEFT JOIN libra_workspaces workspace ON workspace.workspace_id=registry.workspace_id
      WHERE registry.owner_domain='libra' AND registry.process_type='libra_run' AND workspace.workspace_id IS NULL`).all(),
    orphanWorkspaceMaterials:database.prepare(`SELECT material.workspace_id,material.material_key FROM fx_workspace_materials material
      LEFT JOIN libra_workspaces workspace ON workspace.workspace_id=material.workspace_id
      WHERE material.owner_domain='libra' AND workspace.workspace_id IS NULL`).all(),
  };
  for (const [name, rows] of Object.entries(globalResiduals)) if (!scope.selectedSubjectIds && rows.length) residual[name] = rows;
  if (Object.keys(residual).length) {
    throw Object.assign(new Error('FORMATION_RESET_RESIDUAL'), { details:residual });
  }
  const foreignKeys = database.pragma('foreign_key_check');
  if (foreignKeys.length) throw Object.assign(new Error('FORMATION_RESET_FOREIGN_KEY_CHECK_FAILED'), { details:foreignKeys });
  const integrity = database.pragma('integrity_check', { simple:true });
  if (integrity !== 'ok') throw new Error(`Integrity check failed: ${integrity}`);
  return Object.freeze({ integrity, foreignKeyViolations:0 });
}

function applyFormationReset(database, plan, nowMs) {
  const scope = plan.scope;
  const graph = captureExecutionGraph(database, scope.works.map((row) => row.work_id), scope.processScopes,
    scope.factScopes, scope.commandTargetScopes, scope.eventlessFactMarkerOrphans);
  const manifest = Object.freeze({ scope, graph, digest:canonicalDigest({
    schema:'helix.formation-reset-manifest@2',
    business:{ subjects:scope.disposableSubjectIds, intakes:scope.intakeDecisionIds, runs:scope.runIds,
      workspaces:scope.workspaceIds, packages:scope.packageIds, onDeckRuns:scope.onDeckRunIds,
      artifacts:scope.artifactIds, handoffAOffers:scope.handoffAOfferIds,
      retiredSupersededOffers:scope.preservedSupersededHandoffAClosures.map(row=>row.offer_id) },
    execution:graph,
  }) });
  database.pragma('foreign_keys = OFF');
  const transaction = database.transaction(() => {
    const procurementHandoffA = reopenProcurementHandoffA(database, scope, nowMs);
    deleteFormationBusinessGraph(database, scope, nowMs);
    const deletedWorks = deleteExecutionGraph(database, graph);
    const retiredSupersededOfferMessages = retireSupersededOfferMessages(database, scope.preservedSupersededHandoffAClosures);
    executeByIds(database, 'DELETE FROM fx_command_receipts WHERE command_receipt_id IN', scope.phantomLibraAdmissionReceiptIds);
    executeByIds(database, 'DELETE FROM fx_command_receipts WHERE command_receipt_id IN', scope.orphanPipelineAdmissionReceiptIds);
    executeByIds(database, 'DELETE FROM fx_artifact_references WHERE artifact_handle_id IN', scope.artifactIds);
    executeByIds(database, 'DELETE FROM fx_artifact_registry WHERE artifact_handle_id IN', scope.artifactIds);
    const controlRollback = rollbackControls(database, scope);
    const verification = verifyFrozenManifest(database, manifest);
    return Object.freeze({ deletedWorks, retiredSupersededOfferMessages, deletedSubjects:scope.disposableSubjectIds.length,
      deletedRuns:scope.runIds.length, deletedPackages:scope.packageIds.length,
      deletedOnDeckRuns:scope.onDeckRunIds.length, manifestDigest:manifest.digest,
      verification, ...procurementHandoffA, ...controlRollback });
  });
  try { return Object.freeze({ result:transaction(), manifest }); }
  finally { database.pragma('foreign_keys = ON'); }
}

function applyReset({ database, dataDir, transcodeDir = null, nowMs = Date.now(), subjectIds, orphanCustodyIds, supersededOfferIds }) {
  const plan = inspectPlan(database, {subjectIds, orphanCustodyIds, supersededOfferIds});
  if (!plan.ready) throw Object.assign(new Error('FORMATION_RESET_BLOCKED'), { details:plan.blockers });
  const manifestDigest = canonicalDigest({ schema:'helix.formation-reset-file-manifest@2',
    workspaceIds:plan.scope.workspaceIds });
  const staged = stageWorkspaceDirectories(transcodeDir, dataDir, plan.scope.workspaceIds, manifestDigest);
  let applied;
  try {
    applied = applyFormationReset(database, plan, nowMs);
  } catch (error) {
    restoreWorkspaceDirectories(staged);
    throw error;
  }
  const workspaceCleanup = finalizeWorkspaceDirectories(staged);
  return Object.freeze({ workspaceCleanup, result:applied.result,
    verification:applied.result.verification });
}

function main(argv = process.argv.slice(2)) {
  if (valueAfter(argv, '--mode') !== undefined) throw new Error('FORMATION_RESET_LEGACY_MODE_REFUSED');
  const dataDir = path.resolve(valueAfter(argv, '--data-dir') || process.env.MEDIA_SERVICE_DATA_DIR || path.join(__dirname, '..', 'data'));
  const transcodeDirValue = valueAfter(argv, '--transcode-dir');
  const transcodeDir = transcodeDirValue ? path.resolve(transcodeDirValue) : null;
  const databasePath = path.join(dataDir, 'shelfdeck.db');
  if (!fs.existsSync(databasePath)) throw new Error(`Database not found: ${databasePath}`);
  const orphanScope = valueAfter(argv, '--orphan-custody-ids');
  const orphanCustodyIds = orphanScope === undefined ? undefined : orphanScope.split(',');
  const subjectScope = valueAfter(argv, '--subject-ids');
  const subjectIds = subjectScope === undefined ? undefined : subjectScope.split(',');
  const supersededScope=valueAfter(argv,'--superseded-offer-ids');
  const supersededOfferIds=supersededScope===undefined?undefined:supersededScope.split(',');
  const database = new Database(databasePath, { readonly:!argv.includes('--apply') });
  try {
    database.pragma('foreign_keys = ON');
    assertSafeTranscodeRoot(transcodeDir, dataDir);
    if (!argv.includes('--apply')) return Object.freeze({ operation:'formation_reset',
      dataDir, transcodeDir, plan:inspectPlan(database, {subjectIds, orphanCustodyIds, supersededOfferIds}) });
    if (!argv.includes('--offline-confirmed')) throw new Error('FORMATION_RESET_OFFLINE_CONFIRMATION_REQUIRED');
    if (valueAfter(argv, '--confirm') !== CONFIRMATION) throw new Error('FORMATION_RESET_CONFIRMATION_REQUIRED');
    const applied = applyReset({ database, dataDir, transcodeDir, nowMs:Date.now(), subjectIds, orphanCustodyIds, supersededOfferIds });
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

module.exports = Object.freeze({ CONFIRMATION, applyReset, assertSafeTranscodeRoot,
  discoverScope, inspectPlan, main, verifyFrozenManifest, captureExecutionGraph, deleteExecutionGraph });
