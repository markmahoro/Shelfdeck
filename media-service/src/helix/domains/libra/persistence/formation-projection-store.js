'use strict';

const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');
const {
  FORMATION_PROJECTION_COLUMNS,
  formationProjectionDigest,
} = require('../model/formation-projection-contract');

const TABLE_ID = 'libra_formation_projections';
const COLUMNS = FORMATION_PROJECTION_COLUMNS;
const SET_COLUMNS = Object.freeze(COLUMNS.filter((column) => column !== 'subject_id'));

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
        orderBy: [{ column: 'added_at_ms', direction: 'desc' }, { column: 'subject_id', direction: 'asc' }],
        columns: COLUMNS, safeIntegers: true },
      active_scan: { kind: 'select-filtered-page', tableId: TABLE_ID, excludedKeyColumns: ['classification'], maxItems: 500,
        orderBy: [{ column: 'added_at_ms', direction: 'desc' }, { column: 'subject_id', direction: 'asc' }],
        columns: COLUMNS, safeIntegers: true },
      completed_page: { kind: 'select-joined-page', tableId: TABLE_ID, joins:[], maxItems: 101,
        filters:[{column:'classification',kind:'equals',parameter:'classification'},
          {column:'target_shelf_id',kind:'equals',parameter:'shelf',optional:true},
          {column:'display_identity',kind:'contains',parameter:'query',optional:true}],
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
      if (row.projection_digest !== formationProjectionDigest(row)) {
        throw Object.assign(new Error('Formation projection write digest is invalid.'), {
          code: 'FORMATION_PROJECTION_WRITE_DIGEST_INVALID', subjectId: row.subject_id
        });
      }
      if (current && current.projection_digest !== formationProjectionDigest(current)) {
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
  function listCompleted(offset, limit, filters={}) { return read('completed_page', { classification: 'completed', offset, limit, shelf:filters.shelfId||'',query:String(filters.q||'').trim() }); }
  function counts() { return read('counts', {}); }
  return Object.freeze({ find, findByOffer, upsert, listActive, listActiveScan, listCompleted, counts });
}

module.exports = Object.freeze({ COLUMNS, createFormationProjectionStore });
