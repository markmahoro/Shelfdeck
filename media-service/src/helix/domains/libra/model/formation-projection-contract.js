'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');

const FORMATION_PROJECTION_COLUMNS = Object.freeze([
  'subject_id', 'projection_revision', 'classification', 'attention_state', 'attention_priority', 'display_identity',
  'content_profile', 'structure_kind', 'subject_status', 'my_rating', 'my_rating_source', 'my_rating_revision',
  'target_shelf_id', 'target_shelf_name', 'routing_state', 'unresolved_reason_code', 'routing_policy_mode',
  'routing_policy_revision', 'routing_decision_revision', 'routing_decision_digest', 'routing_decision_head_revision',
  'routing_decision_head_digest', 'primary_material_count',
  'organizing_requirement', 'organizing_action', 'added_at_ms', 'next_action_label', 'next_action_state',
  'progress_mode', 'progress_current_value', 'progress_total_value', 'progress_unit', 'progress_rate', 'progress_eta_ms',
  'progress_bucket', 'identity_issue_schema_ref', 'identity_issue_json', 'identity_issue_digest',
  'current_acceptance_spec_id', 'current_acceptance_spec_revision', 'current_acceptance_spec_digest',
  'current_libra_run_id', 'current_libra_run_state', 'current_libra_run_state_revision', 'current_libra_run_state_digest',
  'current_priority_class', 'current_identity_revision', 'current_package_id', 'current_package_revision',
  'current_package_digest', 'current_offer_id', 'completed_at_ms', 'basis_digest', 'projection_digest', 'updated_at_ms'
]);

function normalizedProjectionValue(value) {
  if (typeof value === 'bigint') return Number(value);
  return value ?? null;
}

function formationProjectionDigest(row) {
  if (!row || typeof row !== 'object') throw new TypeError('Formation projection digest requires a row.');
  return canonicalDigest(Object.fromEntries(FORMATION_PROJECTION_COLUMNS
    .filter((column) => !['projection_revision', 'projection_digest'].includes(column))
    .map((column) => [column, normalizedProjectionValue(row[column])])));
}

module.exports = Object.freeze({ FORMATION_PROJECTION_COLUMNS, formationProjectionDigest });
