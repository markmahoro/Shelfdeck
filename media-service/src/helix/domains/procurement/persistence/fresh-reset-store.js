'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');
const { findResetBarrier } = require('../model/field-reset-barrier');

function fail(code) { throw Object.assign(new Error(code), { code }); }

// The Operator calls this Owner port only on a new, isolated database. The
// retained Observation rows are evidence; they never acquire a new queue right.
function createFreshResetFieldNormalization({ schemaManifest, unitOfWork }) {
  const repository = createRepositoryDefinition({ repositoryId: 'procurement_fresh_reset', owner: 'procurement', schemaManifest,
    statements: {
      fields: { kind: 'select-all', tableId: 'proc_material_fields', columns: ['field_id', 'current_observation_revision'], keyColumns: [] },
      observations: { kind: 'select-all', tableId: 'proc_field_observations', columns: ['revision'], keyColumns: ['field_id'] },
      barrier: findResetBarrier,
      insert: { kind: 'insert', tableId: 'proc_field_reset_barriers', columns: findResetBarrier.columns },
      head: { kind: 'update', tableId: 'proc_material_fields', setColumns: ['current_observation_revision'], keyColumns: ['field_id'],
        compareColumns: [{ column: 'current_observation_revision', parameter: 'expected_revision', nullSafe: true }] },
    } });
  return ({ generationId }) => {
    if (!/^[0-9a-f]{64}$/.test(generationId || '')) fail('PROCUREMENT_RESET_GENERATION_INVALID');
    return unitOfWork.execute([{ participantId: 'procurement_fresh_reset', owner: 'procurement', repositories: [repository], execute(context) {
      const repo = context.repository(repository.repositoryId), fields = [];
      for (const field of repo.invoke('fields').sort((a, b) => a.field_id.localeCompare(b.field_id))) {
        let minimum = 0;
        for (const row of repo.invoke('observations', { field_id: field.field_id })) minimum = Math.max(minimum, Number(row.revision));
        const barrier = repo.invoke('barrier', { field_id: field.field_id });
        if (barrier) {
          if (barrier.reset_id !== generationId || barrier.minimum_observation_revision !== minimum ||
              field.current_observation_revision !== (minimum || null)) fail('PROCUREMENT_RESET_BARRIER_CONFLICT');
        } else {
          if (field.current_observation_revision !== null) fail('PROCUREMENT_RESET_HEAD_NOT_DETACHED');
          repo.invoke('insert', { field_id: field.field_id, reset_id: generationId,
            minimum_observation_revision: minimum, created_at_ms: context.commitTimeMs });
          if (repo.invoke('head', { field_id: field.field_id, current_observation_revision: minimum || null, expected_revision: null }).changes !== 1)
            fail('PROCUREMENT_RESET_HEAD_CONFLICT');
        }
        fields.push({ fieldId: field.field_id, minimumObservationRevision: minimum });
      }
      const body = { schemaRef: 'procurement.fresh-reset-fields@1', generationId, fields };
      return { ...body, digest: canonicalDigest(body) };
    } }]).procurement_fresh_reset;
  };
}

module.exports = Object.freeze({ createFreshResetFieldNormalization });
