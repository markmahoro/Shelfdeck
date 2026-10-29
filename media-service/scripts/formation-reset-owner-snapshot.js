'use strict';

const { describeFreshResetSeriesRetention } = require('../src/helix/domains/arca/public');
const { describeFreshResetMetadataRetention } = require('../src/helix/domains/libra/public');

function readResetOwnerSnapshot({ Database, sourcePath }) {
  const db = new Database(sourcePath, { readonly: true, fileMustExist: true });
  try {
    db.pragma('query_only=ON'); db.exec('BEGIN');
    return readResetOwnerSnapshotDatabase(db);
  } finally { if (db.inTransaction) db.exec('ROLLBACK'); db.close(); }
}

function readResetOwnerSnapshotDatabase(db) {
    if (!db.readonly || !db.inTransaction) throw Object.assign(new Error('Owner retention requires a frozen read-only snapshot.'),
      { code: 'RESET_RETENTION_READONLY_REQUIRED' });
    const retainedVersions = db.prepare(`SELECT v.* FROM arca_series_presentation_versions v WHERE v.scope_id IN (
      SELECT r.scope_id FROM arca_series_presentation_references r JOIN arca_shelf_entries e USING(shelf_entry_id)
      UNION SELECT l.scope_id FROM arca_series_presentation_commit_links l JOIN arca_ondeck_commit_receipts c USING(on_deck_run_id))
      ORDER BY v.scope_id,v.revision`).all();
    const seriesRetention = describeFreshResetSeriesRetention({
      scopes: db.prepare('SELECT * FROM arca_series_presentation_scopes ORDER BY scope_id').all(),
      builds: db.prepare('SELECT * FROM arca_series_presentation_builds ORDER BY build_id').all(),
      retainedVersions,
      committedEntryIds: db.prepare('SELECT shelf_entry_id FROM arca_shelf_entries ORDER BY shelf_entry_id').all().map(row => row.shelf_entry_id),
    });
    const observations = [];
    if (seriesRetention.metadataBases.length) {
      const wanted = new Set(seriesRetention.metadataBases.map(row => row.basis.metadataEvidenceId));
      for (const row of db.prepare(`SELECT r.result_id,r.result_schema_ref,r.result_json,r.result_digest,r.outcome_kind,
          e.capability_ref,w.owner_domain,w.process_type,w.process_id,w.work_kind
        FROM fx_workflow_events e JOIN fx_event_result_bindings r ON r.event_id=e.event_id
        JOIN fx_supporting_works w ON w.work_id=e.work_id WHERE e.capability_ref='libra.product_metadata.fetch@1'`).iterate()) {
        const result = JSON.parse(row.result_json);
        if (wanted.has(result?.evidenceId)) observations.push({ result, resultId: row.result_id, resultSchemaRef: row.result_schema_ref,
          resultDigest: row.result_digest, outcomeKind: row.outcome_kind, capabilityRef: row.capability_ref, ownerDomain: row.owner_domain,
          processType: row.process_type, processId: row.process_id, workKind: row.work_kind });
      }
    }
    return { seriesRetention, metadataRetention: describeFreshResetMetadataRetention({ metadataBases: seriesRetention.metadataBases, observations }) };
}

module.exports = Object.freeze({ readResetOwnerSnapshot, readResetOwnerSnapshotDatabase });
