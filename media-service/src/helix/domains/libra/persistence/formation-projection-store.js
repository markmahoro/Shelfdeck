'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');

const TABLE_ID = 'libra_formation_projections';
const COLUMNS = Object.freeze([
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
const SET_COLUMNS = Object.freeze(COLUMNS.filter((column) => column !== 'subject_id'));

function projectionDigest(row) {
  return canonicalDigest(Object.fromEntries(COLUMNS
    .filter((column) => !['projection_revision', 'projection_digest'].includes(column))
    .map((column) => [column, typeof row[column] === 'bigint' ? Number(row[column]) : row[column] ?? null])));
}

function createFormationProjectionStore(options) {
  if (!options?.schemaManifest || !options.unitOfWork) throw new TypeError('Formation projection store requires persistence.');
  const repository = createRepositoryDefinition({
    repositoryId: 'libra_formation_projection_store', owner: 'libra', schemaManifest: options.schemaManifest,
    statements: {
      find: { kind: 'select-one', tableId: TABLE_ID, keyColumns: ['subject_id'], columns: COLUMNS, safeIntegers: true },
      find_by_offer: { kind:'select-one', tableId:TABLE_ID, keyColumns:['current_offer_id'], columns:COLUMNS, safeIntegers:true },
      insert: { kind: 'insert', tableId: TABLE_ID, columns: COLUMNS },
      update: { kind: 'update', tableId: TABLE_ID, setColumns: SET_COLUMNS, keyColumns: ['subject_id'],
        compareColumns: [{ column: 'projection_revision', parameter: 'expected_projection_revision' }] },
      active_page: { kind: 'select-filtered-page', tableId: TABLE_ID, excludedKeyColumns: ['classification'], maxItems: 26,
        orderBy: [{ column: 'attention_priority', direction: 'asc' }, { column: 'updated_at_ms', direction: 'desc' }, { column: 'subject_id', direction: 'asc' }],
        columns: COLUMNS, safeIntegers: true },
      active_scan: { kind: 'select-filtered-page', tableId: TABLE_ID, excludedKeyColumns: ['classification'], maxItems: 500,
        orderBy: [{ column: 'attention_priority', direction: 'asc' }, { column: 'updated_at_ms', direction: 'desc' }, { column: 'subject_id', direction: 'asc' }],
        columns: COLUMNS, safeIntegers: true },
      completed_page: { kind: 'select-filtered-page', tableId: TABLE_ID, fixedKeyColumns: ['classification'], maxItems: 101,
        orderBy: [{ column: 'completed_at_ms', direction: 'desc' }, { column: 'subject_id', direction: 'asc' }],
        columns: COLUMNS, safeIntegers: true },
      counts: { kind: 'count-grouped', tableId: TABLE_ID, groupColumn: 'classification' }
    }
  });

  function read(statementId, parameters) {
    return options.unitOfWork.execute([{ participantId: 'libra_formation_projection_read', owner: 'libra', repositories: [repository], execute(context) {
      return context.repository(repository.repositoryId).invoke(statementId, parameters);
    } }]).libra_formation_projection_read;
  }
  function find(subjectId) { return read('find', { subject_id: subjectId }) || null; }
  function findByOffer(offerId) { return read('find_by_offer', { current_offer_id:offerId }) || null; }
  function upsert(row) {
    return options.unitOfWork.execute([{ participantId: 'libra_formation_projection_write', owner: 'libra', repositories: [repository], execute(context) {
      const repo = context.repository(repository.repositoryId), current = repo.invoke('find', { subject_id: row.subject_id });
      if (current && current.projection_digest !== projectionDigest(current)) {
        throw Object.assign(new Error('Formation projection digest is invalid.'), {
          code: 'FORMATION_PROJECTION_DIGEST_INVALID', subjectId: row.subject_id
        });
      }
      if (current?.basis_digest === row.basis_digest) {
        return Object.freeze({ kind: 'no_op', revision: Number(current.projection_revision) });
      }
      if (!current) {
        repo.invoke('insert', { ...row, projection_revision: 1 });
        return Object.freeze({ kind: 'inserted', revision: 1 });
      }
      const revision = Number(current.projection_revision) + 1;
      const result = repo.invoke('update', { ...row, subject_id: row.subject_id, projection_revision: revision,
        expected_projection_revision: Number(current.projection_revision) });
      if (result.changes !== 1) throw Object.assign(new Error('Formation projection changed concurrently.'), { code: 'FORMATION_PROJECTION_CAS_CONFLICT' });
      return Object.freeze({ kind: 'updated', revision });
    } }]).libra_formation_projection_write;
  }
  function listActive(offset, limit) { return read('active_page', { excluded_classification: 'completed', offset, limit }); }
  function listActiveScan(offset, limit) { return read('active_scan', { excluded_classification: 'completed', offset, limit }); }
  function listCompleted(offset, limit) { return read('completed_page', { classification: 'completed', offset, limit }); }
  function counts() { return read('counts', {}); }
  return Object.freeze({ find, findByOffer, upsert, listActive, listActiveScan, listCompleted, counts });
}

module.exports = Object.freeze({ COLUMNS, createFormationProjectionStore });
