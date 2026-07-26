'use strict';

const crypto = require('crypto');

const OWNER_PREFIXES = Object.freeze({
  'execution-foundation': ['fx_'],
  'material-control-authority': ['fx_material_control'],
  procurement: ['proc_'],
  libra: ['libra_'],
  arca: ['arca_'],
  perception: ['perception_'],
  people: ['people_'],
  'platform-settings': ['platform_']
});
const BUSINESS_OWNERS = new Set(['procurement', 'libra', 'arca', 'perception', 'people']);
const UNIQUE_CONSTRAINT_OVERRIDES = Object.freeze({
  // SSOT 8.5.13: one source Person can have at most one terminal merge target.
  people_merge_records: [['source_person_id']]
});
const PARTIAL_UNIQUE_EXCLUDED_TABLES = new Set(['libra_workspaces', 'libra_workspace_material_refs']);
// These contracts freeze their admission/basis columns, but also declare
// explicit lifecycle CAS transitions. A prose occurrence of "immutable" must
// not turn the whole relation into an append-only table.
const MUTABLE_LIFECYCLE_TABLES = new Set([
  'fx_workspace_registry',
  'fx_workspace_materials',
  'proc_procurement_runs',
  'proc_run_materials',
  'proc_procurement_retry_intent_materials',
  'proc_candidate_deliveries',
  'libra_run_admission_heads',
  'libra_runs',
  'libra_workspaces',
  'libra_workspace_cleanup_scopes',
  'libra_workspace_cleanup_members'
]);
// SSOT 8.5.9 requires every state/status column to be closed. Values named by
// Level 6/7 lifecycles are preserved verbatim; unnamed technical projections
// use the smallest Foundation/Platform lifecycle needed by those contracts.
const ENUM_OVERRIDES = Object.freeze({
  'fx_supporting_works.state': ['admitted', 'ready', 'running', 'blocked', 'succeeded', 'failed', 'cancelled'],
  'fx_work_attempts.state': ['ready', 'running', 'blocked', 'succeeded', 'failed', 'cancelled'],
  'fx_workflow_plans.state': ['planned', 'no_effect_required', 'temporarily_unplannable', 'contract_unplannable'],
  'fx_workflow_events.state': ['pending', 'ready', 'waiting_for_resource', 'waiting_for_external', 'waiting_for_approval', 'executing', 'succeeded', 'skipped', 'failed', 'cancelled'],
  'fx_event_attempts.state': ['executing', 'completed'],
  'fx_effect_journal.state': ['intended', 'effect_observed', 'committed', 'reconcile_required', 'failed'],
  'fx_outbox.state': ['pending', 'dispatching', 'fully_acked', 'tombstoned'],
  'fx_resource_defer.state': ['waiting', 'released', 'cancelled', 'expired'],
  'fx_circuit_states.state': ['closed', 'open', 'recovering'],
  'fx_material_controls.state': ['controlled', 'released'],
  'fx_workspace_registry.state': ['active', 'reclaimed'],
  'fx_workspace_materials.state': ['active', 'reclaimed'],
  'fx_artifact_registry.state': ['active', 'gc_eligible', 'deleted'],
  'fx_artifact_references.state': ['active', 'released'],
  'proc_material_fields.status': ['active', 'disabled'],
  'proc_field_materials.eligibility_state': ['eligible', 'ineligible', 'unknown'],
  'proc_field_materials.eligibility_field_status': ['active', 'disabled'],
  'proc_field_materials.control_projection': ['unknown', 'uncontrolled', 'procurement', 'production', 'finished_goods'],
  'proc_procurement_runs.state': ['active', 'waiting', 'sealed'],
  'proc_procurement_retry_intents.retry_field_status': ['active'],
  'proc_procurement_retry_intent_materials.expected_control_state': ['uncontrolled', 'controlled'],
  'proc_run_materials.expected_control_state': ['uncontrolled', 'controlled'],
  'proc_candidate_packages.state': ['published'],
  'proc_candidate_deliveries.state': ['open', 'accepted', 'rejected', 'stale'],
  'libra_subjects.status': ['active', 'abandoned', 'completed'],
  'libra_intake_decisions.expected_target_status': ['active'],
  'libra_material_bindings.health_state': ['active', 'stale', 'released'],
  'libra_decision_basis_revisions.status': ['ready', 'unresolved', 'superseded'],
  'libra_runs.state': ['active', 'suspended', 'superseded', 'frozen', 'discarded', 'completed'],
  'libra_run_revisions.state': ['active', 'suspended', 'superseded', 'frozen', 'discarded', 'completed'],
  'libra_episode_delivery_members.state': ['pending', 'delivered', 'superseded'],
  'libra_workspaces.state': ['active', 'reclaiming', 'reclaimed'],
  'libra_workspace_revisions.state': ['active', 'reclaiming', 'reclaimed'],
  'libra_workspace_cleanup_scopes.state': ['active', 'completed', 'blocked'],
  'libra_workspace_cleanup_members.state': ['pending', 'completed', 'blocked'],
  'libra_product_packages.state': ['published'],
  'arca_shelves.status': ['active', 'deregistering', 'deregistered'],
  'arca_acceptance_attempts.state': ['active', 'waiting', 'accepted', 'rejected'],
  'arca_ondeck_custodies.state': ['active', 'committed', 'released'],
  'arca_material_bindings.health_state': ['active', 'stale', 'released'],
  'arca_ondeck_runs.state': ['ready', 'offloading', 'blocked', 'committed'],
  'arca_ondeck_settlement_approvals.state': ['active', 'consumed', 'stale'],
  'arca_shelf_entries.status': ['active', 'offdeck_in_progress', 'offdecked', 'deregistered'],
  'arca_deck_fact_revisions.state': ['active', 'offdeck_in_progress', 'offdecked', 'deregistered'],
  'arca_aftercare_findings.state': ['open', 'resolved', 'superseded'],
  'arca_aftercare_cases.state': ['active', 'resolved', 'invalidated', 'unresolved'],
  'arca_aftercare_settlement_approvals.state': ['active', 'consumed', 'stale'],
  'arca_offdeck_policy_heads.status': ['active', 'disabled'],
  'arca_offdeck_review_candidates.state': ['open', 'selected', 'dismissed', 'stale'],
  'arca_offdeck_duplicate_groups.state': ['open', 'resolved', 'whitelisted', 'stale'],
  'arca_offdeck_authorizations.state': ['active', 'consumed', 'revoked', 'stale'],
  'arca_offdeck_cases.state': ['ready', 'destroying', 'verifying', 'blocked', 'completed'],
  'arca_deregistrations.state': ['active', 'committed'],
  'perception_sources.status': ['active', 'disabled'],
  'perception_resolution_revisions.fact_kind': ['rating', 'watched'],
  'perception_resolution_revisions.result_kind': ['found', 'not_found'],
  'perception_resolution_revisions.reason_code': ['no_matching_record', 'requested_fact_absent', 'strongest_value_conflict'],
  'people_persons.status': ['active', 'merged'],
  'people_registration_candidates.current_state': ['open', 'accepted', 'dismissed', 'superseded'],
  'people_merge_candidates.current_state': ['open', 'accepted', 'dismissed', 'superseded'],
  'people_reference_assets.state': ['active', 'superseded', 'rejected'],
  'people_reference_faces.state': ['active', 'superseded', 'rejected'],
  'platform_mount_scopes.status': ['active', 'disabled'],
  'platform_integrations.state': ['active', 'disabled', 'faulted'],
  'platform_secret_refs.state': ['active', 'rotated', 'revoked'],
  'platform_workspace_roots.state': ['active', 'disabled', 'faulted'],
  'platform_resource_profiles.status': ['active', 'archived'],
  'platform_compute_devices.state': ['available', 'unavailable', 'disabled'],
  'platform_workers.status': ['active', 'offline', 'disabled']
});
const INTEGER_COLUMN_OVERRIDES = new Set([
  'fx_workflow_plans.planner_version',
  'fx_workflow_plans.work_objective_version',
  'fx_plan_nodes.contract_version',
  'fx_workflow_events.contract_version',
  'fx_event_attempts.executor_version',
  'fx_resource_defer.local_priority',
  'libra_decision_basis_inputs.query_version',
  'libra_runs.package_revision_head',
  'perception_source_cursors.has_more',
  'perception_records.rating'
]);
const INTEGER_BOOLEAN_COLUMN_OVERRIDES = new Set(['perception_records.watched_state']);
const NULLABLE_COLUMN_OVERRIDES = new Set([
  'perception_records.rating',
  'perception_records.watched_state',
  'proc_field_observations.cursor_in',
  'proc_field_observations.cursor_out',
  'libra_intake_decisions.expected_target_status'
]);
const FOREIGN_KEY_OVERRIDES = Object.freeze({
  'fx_plan_nodes.compensation_for_event_id': ['fx_workflow_events', 'event_id'],
  'proc_procurement_retry_intents.failed_run_id': ['proc_procurement_runs', 'procurement_run_id'],
  'libra_subjects.routing_anchor_intake_decision_id': ['libra_intake_decisions', 'intake_decision_id'],
  'libra_material_bindings.origin_intake_decision_id': ['libra_intake_decisions', 'intake_decision_id'],
  'libra_runs.supersedes_run_id': ['libra_runs', 'libra_run_id'],
  'libra_runs.superseded_by_run_id': ['libra_runs', 'libra_run_id'],
  'libra_run_discard_decisions.workspace_cleanup_scope_id': ['libra_workspace_cleanup_scopes', 'cleanup_scope_id'],
  'libra_run_material_members.origin_intake_decision_id': ['libra_intake_decisions', 'intake_decision_id'],
  'libra_product_package_materials.origin_intake_decision_id': ['libra_intake_decisions', 'intake_decision_id'],
  'libra_subject_decision_heads.current_routing_decision_id': ['libra_routing_decisions', 'routing_decision_id'],
  'libra_subject_decision_heads.current_decision_basis_id': ['libra_decision_basis_revisions', 'decision_basis_id'],
  'libra_subject_decision_heads.current_acceptance_spec_id': ['libra_acceptance_specs', 'acceptance_spec_id'],
  'libra_routing_decisions.assessment_id': ['libra_routing_assessments', 'routing_assessment_id'],
  'perception_record_relations.source_perception_id': ['perception_records', 'perception_id'],
  'perception_record_relations.target_perception_id': ['perception_records', 'perception_id'],
  'people_merge_candidates.left_person_id': ['people_persons', 'person_id'],
  'people_merge_candidates.right_person_id': ['people_persons', 'person_id'],
  'people_merge_records.source_person_id': ['people_persons', 'person_id'],
  'people_merge_records.target_person_id': ['people_persons', 'person_id'],
  'libra_subject_episode_scopes.first_intake_decision_id': ['libra_intake_decisions', 'intake_decision_id']
});
const EXPLICIT_FOREIGN_KEYS = Object.freeze({
  libra_run_material_episode_claims: [
    { columns: ['run_material_manifest_id', 'member_ordinal'], targetTable: 'libra_run_material_members',
      targetColumns: ['run_material_manifest_id', 'ordinal'] }
  ],
  proc_candidate_primary_material_episode_claims: [
    { columns: ['candidate_package_id', 'primary_ordinal'], targetTable: 'proc_candidate_primary_materials',
      targetColumns: ['candidate_package_id', 'ordinal'] }
  ],
  proc_candidate_related_references: [
    { columns: ['candidate_package_id', 'primary_ordinal'], targetTable: 'proc_candidate_primary_materials',
      targetColumns: ['candidate_package_id', 'ordinal'] }
  ],
  proc_field_observations: [
    { columns: ['field_id'], targetTable: 'proc_material_fields', targetColumns: ['field_id'] },
    { columns: ['field_observation_work_id'], targetTable: 'fx_supporting_works', targetColumns: ['work_id'] },
    { columns: ['field_id', 'access_revision'], targetTable: 'proc_field_access_revisions', targetColumns: ['field_id', 'revision'] },
    { columns: ['commit_marker'], targetTable: 'fx_commit_markers', targetColumns: ['commit_marker'] }
  ],
  proc_field_materials: [
    { columns: ['field_id'], targetTable: 'proc_material_fields', targetColumns: ['field_id'] },
    { columns: ['field_id', 'last_observation_id'], targetTable: 'proc_field_observations', targetColumns: ['field_id', 'observation_id'] }
  ],
  proc_procurement_runs: [
    { columns: ['field_id', 'access_revision'], targetTable: 'proc_field_access_revisions', targetColumns: ['field_id', 'revision'] },
    { columns: ['field_id', 'terminal_observation_revision'], targetTable: 'proc_field_observations', targetColumns: ['field_id', 'revision'] },
    { columns: ['extraction_policy_id', 'extraction_policy_revision'], targetTable: 'proc_extraction_policy_revisions', targetColumns: ['extraction_policy_id', 'revision'] },
    { columns: ['admission_commit_marker'], targetTable: 'fx_commit_markers', targetColumns: ['commit_marker'] },
    { columns: ['seal_commit_marker'], targetTable: 'fx_commit_markers', targetColumns: ['commit_marker'] },
    { columns: ['retry_intent_id'], targetTable: 'proc_procurement_retry_intents', targetColumns: ['retry_intent_id'] }
  ],
  proc_procurement_retry_intents: [
    { columns: ['field_id', 'retry_access_revision'], targetTable: 'proc_field_access_revisions', targetColumns: ['field_id', 'revision'] },
    { columns: ['field_id', 'retry_terminal_observation_revision'], targetTable: 'proc_field_observations', targetColumns: ['field_id', 'revision'] },
    { columns: ['retry_extraction_policy_id', 'retry_extraction_policy_revision'], targetTable: 'proc_extraction_policy_revisions', targetColumns: ['extraction_policy_id', 'revision'] },
    { columns: ['new_run_id'], targetTable: 'proc_procurement_runs', targetColumns: ['procurement_run_id'] },
    { columns: ['create_commit_marker'], targetTable: 'fx_commit_markers', targetColumns: ['commit_marker'] },
    { columns: ['consume_commit_marker'], targetTable: 'fx_commit_markers', targetColumns: ['commit_marker'] }
  ],
  people_aliases: [
    { columns: ['person_id', 'revision'], targetTable: 'people_person_revisions', targetColumns: ['person_id', 'revision'] }
  ],
  people_provider_identities: [
    { columns: ['person_id', 'revision'], targetTable: 'people_person_revisions', targetColumns: ['person_id', 'revision'] }
  ],
  people_merge_candidates: [
    { columns: ['left_person_id', 'left_person_revision'], targetTable: 'people_person_revisions', targetColumns: ['person_id', 'revision'] },
    { columns: ['right_person_id', 'right_person_revision'], targetTable: 'people_person_revisions', targetColumns: ['person_id', 'revision'] }
  ],
  people_merge_records: [
    { columns: ['merge_candidate_id', 'merge_candidate_revision'], targetTable: 'people_merge_candidate_revisions', targetColumns: ['merge_candidate_id', 'revision'] },
    { columns: ['source_person_id', 'previous_source_person_revision'], targetTable: 'people_person_revisions', targetColumns: ['person_id', 'revision'] },
    { columns: ['source_person_id', 'committed_source_person_revision'], targetTable: 'people_person_revisions', targetColumns: ['person_id', 'revision'] },
    { columns: ['target_person_id', 'previous_target_person_revision'], targetTable: 'people_person_revisions', targetColumns: ['person_id', 'revision'] },
    { columns: ['target_person_id', 'committed_target_person_revision'], targetTable: 'people_person_revisions', targetColumns: ['person_id', 'revision'] }
  ],
  people_reference_assets: [
    { columns: ['person_id', 'created_reference_revision'], targetTable: 'people_reference_revisions', targetColumns: ['person_id', 'revision'] },
    { columns: ['person_id', 'released_reference_revision'], targetTable: 'people_reference_revisions', targetColumns: ['person_id', 'revision'] }
  ],
  people_reference_faces: [
    { columns: ['person_id', 'created_reference_revision'], targetTable: 'people_reference_revisions', targetColumns: ['person_id', 'revision'] },
    { columns: ['person_id', 'released_reference_revision'], targetTable: 'people_reference_revisions', targetColumns: ['person_id', 'revision'] }
  ],
  people_reference_revisions: [
    { columns: ['reference_asset_id'], targetTable: 'people_reference_assets', targetColumns: ['reference_asset_id'] },
    { columns: ['reference_face_id'], targetTable: 'people_reference_faces', targetColumns: ['reference_face_id'] }
  ],
  perception_resolution_revisions: [
    { columns: ['winning_perception_id'], targetTable: 'perception_records', targetColumns: ['perception_id'] }
  ],
  perception_resolution_heads: [
    {
      columns: ['query_contract', 'query_input_digest', 'current_revision', 'current_resolution_id'],
      targetTable: 'perception_resolution_revisions',
      targetColumns: ['query_contract', 'query_input_digest', 'revision', 'resolution_id']
    }
  ]
});
const DEFERRED_FOREIGN_KEY_PAIRS = new Set([
  'proc_material_fields>proc_field_access_revisions',
  'proc_material_fields>proc_field_observations', 'proc_field_observations>proc_material_fields',
  'proc_field_observations>fx_commit_markers',
  'proc_procurement_runs>proc_procurement_retry_intents',
  'proc_procurement_retry_intents>proc_procurement_runs',
  'libra_subjects>libra_intake_decisions', 'libra_intake_decisions>libra_subjects',
  'libra_runs>libra_run_material_manifests', 'libra_run_material_manifests>libra_runs',
  'libra_workspaces>libra_workspace_revisions',
  'people_persons>people_person_revisions', 'people_person_revisions>people_persons',
  'people_persons>people_preference_revisions', 'people_preference_revisions>people_persons',
  'people_persons>people_reference_revisions',
  'people_reference_assets>people_reference_revisions', 'people_reference_faces>people_reference_revisions',
  'people_registration_candidates>people_registration_candidate_revisions',
  'people_registration_candidate_revisions>people_registration_candidates',
  'people_merge_candidates>people_merge_candidate_revisions',
  'people_merge_candidate_revisions>people_merge_candidates'
]);
const JSON_SCHEMA_COLUMN_OVERRIDES = Object.freeze({
  'fx_command_receipts.result_ref_json': 'result_schema_ref',
  'fx_plan_nodes.input_bindings_json': 'input_binding_schema_ref',
  'fx_plan_nodes.parameters_json': 'parameter_schema_ref',
  'fx_plan_nodes.fence_basis_json': 'fence_schema_ref',
  'libra_runs.execution_basis_record_json': 'execution_basis_schema_ref',
  'libra_product_fact_revisions.fact_json': 'schema_ref'
});
const JSON_LIMIT_OVERRIDES = Object.freeze({
  'fx_event_result_bindings.result_json': 64 * 1024,
  'fx_event_result_bindings.evidence_json': 64 * 1024,
  'people_registration_candidates.candidate_json': 16 * 1024,
  'people_merge_candidates.candidate_json': 16 * 1024,
  'libra_runs.execution_basis_record_json': 1024 * 1024,
  'libra_run_revisions.transition_evidence_json': 1024 * 1024,
  'libra_workspaces.space_admission_evidence_json': 16 * 1024,
  'libra_workspace_material_refs.episode_claims_json': 16 * 1024,
  'libra_workspace_material_refs.product_verification_json': 128 * 1024,
  'libra_product_fact_revisions.verified_artifact_manifest_json': 256 * 1024
});
const CURRENT_POINTER_TARGETS = Object.freeze({
  fx_workflow_events: [[['event_id', 'current_progress_revision'], 'fx_event_progress', ['event_id', 'revision']]],
  proc_material_fields: [
    [['field_id', 'current_access_revision'], 'proc_field_access_revisions', ['field_id', 'revision']],
    [['field_id', 'current_observation_revision'], 'proc_field_observations', ['field_id', 'revision']]
  ],
  libra_subjects: [[['subject_id', 'current_identity_revision'], 'libra_product_identity_revisions', ['subject_id', 'revision']]],
  libra_field_routing_heads: [[['current_routing_policy_id', 'current_policy_revision'], 'libra_routing_policy_revisions', ['routing_policy_id', 'revision']]],
  libra_subject_decision_heads: [
    [['current_routing_decision_id'], 'libra_routing_decisions', ['routing_decision_id']],
    [['current_decision_basis_id'], 'libra_decision_basis_revisions', ['decision_basis_id']],
    [['current_acceptance_spec_id'], 'libra_acceptance_specs', ['acceptance_spec_id']]
  ],
  libra_workspaces: [[['workspace_id', 'current_revision'], 'libra_workspace_revisions', ['workspace_id', 'workspace_revision']]],
  arca_shelves: [
    [['shelf_id', 'current_standard_revision'], 'arca_shelf_standard_revisions', ['shelf_id', 'revision']],
    [['shelf_id', 'current_placement_revision'], 'arca_placement_policy_revisions', ['shelf_id', 'revision']]
  ],
  arca_rule_templates: [[['rule_template_id', 'current_revision'], 'arca_rule_template_revisions', ['rule_template_id', 'revision']]],
  arca_input_settlement_authorization_head: [[
    ['current_authorization_id', 'current_revision'], 'arca_input_settlement_authorizations', ['authorization_id', 'revision']
  ]],
  arca_shelf_entries: [
    [['shelf_entry_id', 'canonical_identity_revision'], 'arca_canonical_identity_revisions', ['shelf_entry_id', 'revision']],
    [['shelf_entry_id', 'current_inventory_revision'], 'arca_inventory_representations', ['shelf_entry_id', 'revision']],
    [['shelf_entry_id', 'current_deck_fact_revision'], 'arca_deck_fact_revisions', ['shelf_entry_id', 'revision']]
  ],
  arca_offdeck_policy_heads: [[['policy_id', 'current_revision'], 'arca_offdeck_policy_revisions', ['policy_id', 'revision']]],
  perception_sources: [[['perception_source_id', 'current_cursor_revision'], 'perception_source_cursors', ['perception_source_id', 'revision']]],
  perception_resolution_heads: [[
    ['query_contract', 'query_input_digest', 'current_revision', 'current_resolution_id'],
    'perception_resolution_revisions', ['query_contract', 'query_input_digest', 'revision', 'resolution_id']
  ]],
  people_persons: [
    [['person_id', 'current_revision'], 'people_person_revisions', ['person_id', 'revision']],
    [['person_id', 'current_preference_revision'], 'people_preference_revisions', ['person_id', 'revision']],
    [['person_id', 'current_reference_revision'], 'people_reference_revisions', ['person_id', 'revision']]
  ],
  people_registration_candidates: [[
    ['registration_candidate_id', 'current_revision', 'current_state'],
    'people_registration_candidate_revisions', ['registration_candidate_id', 'revision', 'state']
  ]],
  people_merge_candidates: [[
    ['merge_candidate_id', 'current_revision', 'current_state'],
    'people_merge_candidate_revisions', ['merge_candidate_id', 'revision', 'state']
  ]],
  platform_mount_scopes: [[['mount_scope_id', 'current_revision'], 'platform_mount_scope_revisions', ['mount_scope_id', 'revision']]],
  platform_resource_profiles: [[['profile_id', 'current_revision'], 'platform_resource_profile_revisions', ['profile_id', 'revision']]],
  platform_resource_operating_policy: [[
    ['singleton_key', 'current_revision'], 'platform_resource_operating_revisions', ['singleton_key', 'revision']
  ]],
  platform_compute_devices: [[['device_id', 'current_probe_revision'], 'platform_compute_device_probes', ['device_id', 'revision']]],
  platform_workers: [[['worker_id', 'current_revision'], 'platform_worker_revisions', ['worker_id', 'revision']]]
});

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') return Object.keys(value).sort().reduce((result, key) => {
    result[key] = canonicalize(value[key]);
    return result;
  }, {});
  return value;
}

function digestValue(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

function splitBalanced(value, delimiter = ',') {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '(') depth += 1;
    else if (value[index] === ')') depth -= 1;
    else if (value[index] === delimiter && depth === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts.filter(Boolean);
}

function parseFunctionCalls(value, keyword) {
  const calls = [];
  const marker = `${keyword}(`;
  let cursor = 0;
  while ((cursor = value.indexOf(marker, cursor)) >= 0) {
    const start = cursor + marker.length;
    let depth = 1;
    let end = start;
    while (end < value.length && depth > 0) {
      if (value[end] === '(') depth += 1;
      else if (value[end] === ')') depth -= 1;
      end += 1;
    }
    if (depth !== 0) throw new Error(`Unclosed ${keyword} expression: ${value}`);
    calls.push(splitBalanced(value.slice(start, end - 1)));
    cursor = end;
  }
  return calls;
}

function stripCode(value) {
  const trimmed = value.trim();
  return trimmed.startsWith('`') && trimmed.endsWith('`') ? trimmed.slice(1, -1) : trimmed;
}

function logicalType(name, tableId = null) {
  if (name.endsWith('_json')) return 'TEXT_JSON';
  if (INTEGER_BOOLEAN_COLUMN_OVERRIDES.has(tableId + '.' + name)) return 'INTEGER_BOOLEAN';
  if (INTEGER_COLUMN_OVERRIDES.has(tableId + '.' + name)) return 'INTEGER';
  if (/(?:_at_ms|_ms|_ns|_revision|_count|_bytes|_ordinal|_slots)$/.test(name) || ['revision', 'ordinal', 'rank'].includes(name)) return 'INTEGER';
  if (['enabled', 'current', 'completed', 'high_volume'].includes(name)) return 'INTEGER_BOOLEAN';
  if (['rate', 'deck_coverage_ratio', 'rating'].includes(name)) return 'REAL';
  if (['current_value', 'total_value', 'preference_level'].includes(name)) return 'INTEGER_OR_REAL';
  return 'TEXT';
}

function parseColumns(columnsContract, tableId = null) {
  const raw = stripCode(columnsContract);
  return splitBalanced(raw).map((token, ordinal) => {
    const match = token.match(/^([a-z][a-z0-9_]*)(?:\(([^)]*)\))?(?:\s+(.+))?$/);
    if (!match) throw new Error(`Unsupported column token: ${token}`);
    const qualifiers = match[3] ? match[3].split(/\s+/) : [];
    const declaredLogicalType = qualifiers.find((value) => value === 'INTEGER') || null;
    const fixedPrimaryKey = qualifiers.find((value) => /^PK\([a-z][a-z0-9_]*\)$/.test(value)) || null;
    const marker = fixedPrimaryKey ? 'PK' : (qualifiers.find((value) => ['PK/FK', 'PK', 'FK'].includes(value)) || null);
    const inlineUnique = qualifiers.includes('UNIQUE');
    const nullableSpec = qualifiers.find((value) => /^NULL(?:\|[a-z][a-z0-9_]*)*$/.test(value)) || null;
    if (qualifiers.some((value) => value !== marker && value !== fixedPrimaryKey && value !== nullableSpec
      && value !== declaredLogicalType && value !== 'UNIQUE')) {
      throw new Error(`Unsupported column token: ${token}`);
    }
    const nullableEnum = nullableSpec && nullableSpec.includes('|') ? nullableSpec.split('|').slice(1) : [];
    return {
      ordinal: ordinal + 1,
      name: match[1],
      logicalType: declaredLogicalType || logicalType(match[1], tableId),
      enumValues: fixedPrimaryKey ? [fixedPrimaryKey.slice(3, -1)] : (match[2] ? match[2].split('|') : (nullableEnum.length > 0 ? nullableEnum : (ENUM_OVERRIDES[tableId + '.' + match[1]] || []))),
      primaryKeyPart: marker === 'PK' || marker === 'PK/FK',
      foreignKeyMarker: marker === 'FK' || marker === 'PK/FK',
      inlineUnique,
      nullable: nullableSpec !== null || NULLABLE_COLUMN_OVERRIDES.has(tableId + '.' + match[1])
    };
  });
}

function semanticClauses(constraintsContract) {
  return constraintsContract.split('；').map((value) => value.trim()).filter(Boolean);
}

function jsonLimitFor(tableId, column, constraintsContract) {
  if (JSON_LIMIT_OVERRIDES[`${tableId}.${column}`]) {
    return { maxBytes: JSON_LIMIT_OVERRIDES[`${tableId}.${column}`], source: '8.6.19-typed-payload' };
  }
  const limits = [...constraintsContract.matchAll(/`?(4|16|64) KiB`?/g)].map((match) => Number(match[1]) * 1024);
  if (limits.length > 0) return { maxBytes: limits[0], source: 'table-row' };
  if (tableId === 'libra_routing_policy_targets' && column === 'match_rule_json') return { maxBytes: 16 * 1024, source: '8.5.9-hot-json' };
  if (tableId === 'arca_rule_template_drafts' && column === 'rules_json') return { maxBytes: 64 * 1024, source: '8.5.9-non-hot-json' };
  return null;
}

function primaryKey(columns, constraintsContract) {
  const declared = columns.filter((column) => column.primaryKeyPart).map((column) => column.name);
  const calls = parseFunctionCalls(constraintsContract, 'PK');
  if (declared.length > 0 && calls.length > 0) throw new Error('Primary key declared both inline and in constraints.');
  if (calls.length > 1) throw new Error('Multiple primary keys declared.');
  return declared.length > 0 ? declared : calls[0] || [];
}

function parseTableRows(entries) {
  return entries.map((entry) => {
    const columns = parseColumns(entry.columnsContract, entry.id);
    const clauses = semanticClauses(entry.constraintsContract);
    const key = primaryKey(columns, entry.constraintsContract);
    const jsonContracts = columns.filter((column) => column.name.endsWith('_json')).map((column) => {
      const schemaColumn = JSON_SCHEMA_COLUMN_OVERRIDES[`${entry.id}.${column.name}`] || `${column.name.slice(0, -5)}_schema_ref`;
      return {
        column: column.name,
        schemaRefColumn: columns.some((candidate) => candidate.name === schemaColumn) ? schemaColumn : null,
        ...jsonLimitFor(entry.id, column.name, entry.constraintsContract),
        requiresJsonValidCheck: true
      };
    });
    const partialUniqueClauses = PARTIAL_UNIQUE_EXCLUDED_TABLES.has(entry.id) ? [] : clauses.filter((clause) =>
      /UNIQUE\([^)]*\)\s+WHERE\b/i.test(clause) || /partial unique|至多一个|最多一份|unique while open|active unique|全局exclusive/.test(clause));
    const partialUniqueKeys = new Set(partialUniqueClauses.flatMap((clause) => parseFunctionCalls(clause, 'UNIQUE')).map((columns) => JSON.stringify(columns)));
    const currentPointerColumns = columns.filter((column) =>
      (/^current_(?:.*_)?(?:id|revision)$/.test(column.name) || column.name === 'canonical_identity_revision') &&
      column.name !== 'current_reference_projection_revision' &&
      !(entry.id === 'libra_subject_continuity_heads' && column.name === 'current_revision'))
      .map((column) => column.name);
    const immutableRules = clauses.filter((clause) => /immutable|append-only|禁止更新|不能更新|不可更新/.test(clause));
    return {
      tableId: entry.id,
      owner: entry.owner,
      prefix: Object.values(OWNER_PREFIXES).flat().sort((left, right) => right.length - left.length)
        .find((prefix) => entry.id.startsWith(prefix)) || null,
      columns,
      primaryKey: key,
      declaredForeignKeyColumns: columns.filter((column) => column.foreignKeyMarker).map((column) => column.name),
      uniqueConstraints: [...new Map([
        ...columns.filter((column) => column.inlineUnique).map((column) => [column.name]),
        ...parseFunctionCalls(entry.constraintsContract, 'UNIQUE').filter((item) => !partialUniqueKeys.has(JSON.stringify(item))),
        ...(UNIQUE_CONSTRAINT_OVERRIDES[entry.id] || [])
      ].map((item) => [JSON.stringify(item), item])).values()],
      hotIndexes: parseFunctionCalls(entry.constraintsContract, 'INDEX'),
      partialUniqueRules: partialUniqueClauses,
      checkRules: [
        ...columns.filter((column) => column.enumValues.length > 0).map((column) => ({ column: column.name, enumValues: column.enumValues })),
        ...clauses.filter((clause) => /CHECK|check|non-negative|finite|枚举|范围/.test(clause)).map((clause) => ({ rule: clause }))
      ],
      revisionContract: {
        revisionColumns: columns.filter((column) => column.name === 'revision' || column.name.endsWith('_revision')).map((column) => column.name),
        currentPointerColumns,
        pointerTargets: (CURRENT_POINTER_TARGETS[entry.id] || []).map(([sourceColumns, targetTable, targetColumns, consistencyColumns = []]) => ({
          sourceColumns, targetTable, targetColumns, consistencyColumns, deletePolicy: 'RESTRICT',
          deferrable: DEFERRED_FOREIGN_KEY_PAIRS.has(`${entry.id}>${targetTable}`)
        })),
        pointerRules: clauses.filter((clause) => /(?:current|identity pointer|三个current).*(?:FK|指向|引用|pointer|revision)/i.test(clause))
      },
      jsonContracts,
      immutability: {
        immutable: !MUTABLE_LIFECYCLE_TABLES.has(entry.id) && currentPointerColumns.length === 0 && immutableRules.length > 0,
        rules: immutableRules
      },
      deletion: {
        foreignKeyPolicy: 'ON DELETE RESTRICT',
        rules: clauses.filter((clause) => /不能.*删除|不可.*删除|不物理删除|禁止.*删除|GC只处理/.test(clause))
      },
      semanticRules: clauses,
      rawContract: { columns: entry.columnsContract, constraints: entry.constraintsContract },
      source: entry.source
    };
  });
}

function resolveForeignKeys(rows) {
  const simplePrimaryKeys = new Map();
  for (const row of rows) {
    if (row.primaryKey.length !== 1) continue;
    const column = row.primaryKey[0];
    if (!simplePrimaryKeys.has(column)) simplePrimaryKeys.set(column, []);
    simplePrimaryKeys.get(column).push(row);
  }
  return rows.map((row) => {
    const explicit = (EXPLICIT_FOREIGN_KEYS[row.tableId] || []).map((foreignKey) => ({
      ...foreignKey,
      deletePolicy: 'RESTRICT',
      deferrable: DEFERRED_FOREIGN_KEY_PAIRS.has(`${row.tableId}>${foreignKey.targetTable}`)
    }));
    const explicitlyCovered = new Set(explicit.flatMap((foreignKey) => foreignKey.columns));
    const inferred = row.declaredForeignKeyColumns.filter((column) => !explicitlyCovered.has(column)).map((column) => {
      const override = FOREIGN_KEY_OVERRIDES[`${row.tableId}.${column}`];
      if (override) return {
        columns: [column], targetTable: override[0], targetColumns: [override[1]], deletePolicy: 'RESTRICT',
        deferrable: DEFERRED_FOREIGN_KEY_PAIRS.has(`${row.tableId}>${override[0]}`)
      };
      let candidates = (simplePrimaryKeys.get(column) || []).filter((candidate) => candidate.tableId !== row.tableId);
      const sameOwner = candidates.filter((candidate) => candidate.owner === row.owner);
      if (sameOwner.length > 0) candidates = sameOwner;
      if (column === 'subject_id') candidates = candidates.filter((candidate) => candidate.tableId === 'libra_subjects');
      if (column === 'rule_template_id') candidates = candidates.filter((candidate) => candidate.tableId === 'arca_rule_templates');
      if (candidates.length !== 1) return {
        columns: [column], targetTable: null, targetColumns: [column], resolutionCandidates: candidates.map((item) => item.tableId)
      };
      return {
        columns: [column], targetTable: candidates[0].tableId, targetColumns: [column], deletePolicy: 'RESTRICT',
        deferrable: DEFERRED_FOREIGN_KEY_PAIRS.has(`${row.tableId}>${candidates[0].tableId}`)
      };
    });
    return { ...row, foreignKeys: [...inferred, ...explicit] };
  });
}

function buildTableContracts(entries) {
  return resolveForeignKeys(parseTableRows(entries));
}

function allowedForeignKey(sourceOwner, targetOwner) {
  if (sourceOwner === 'execution-foundation') return targetOwner === 'execution-foundation';
  if (sourceOwner === 'material-control-authority') return targetOwner === 'material-control-authority';
  if (sourceOwner === 'platform-settings') return targetOwner === 'platform-settings';
  if (BUSINESS_OWNERS.has(sourceOwner)) return targetOwner === sourceOwner || ['execution-foundation', 'material-control-authority'].includes(targetOwner);
  return false;
}

module.exports = Object.freeze({
  BUSINESS_OWNERS, ENUM_OVERRIDES, INTEGER_COLUMN_OVERRIDES, OWNER_PREFIXES, allowedForeignKey, buildTableContracts, digestValue, parseColumns, parseFunctionCalls, splitBalanced
});
