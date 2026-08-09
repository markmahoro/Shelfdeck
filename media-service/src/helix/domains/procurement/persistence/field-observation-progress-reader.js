'use strict';

const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');

class FieldObservationProgressReaderError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'FieldObservationProgressReaderError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new FieldObservationProgressReaderError(code, message, details);
}

function createFieldObservationProgressReader(options) {
  if (!options?.schemaManifest || !options.unitOfWork) {
    fail('P7_FIELD_OBSERVATION_PROGRESS_DEPENDENCIES', 'Observation progress requires Procurement persistence.');
  }
  const repository = createRepositoryDefinition({ repositoryId: 'field_observation_progress', owner: 'procurement',
    schemaManifest: options.schemaManifest, statements: {
      list: { kind: 'select-all', tableId: 'proc_field_observations', columns: [
        'field_id', 'revision', 'observation_id', 'field_observation_work_id', 'page_ordinal', 'expected_revision',
        'cursor_in', 'cursor_out', 'completed', 'result_digest'
      ], keyColumns: ['field_observation_work_id'] }
    } });
  return Object.freeze({
    read(workId) {
      const rows = options.unitOfWork.execute([{
        participantId: 'field_observation_progress_read', owner: 'procurement', repositories: [repository], execute(context) {
          return context.repository(repository.repositoryId).invoke('list', { field_observation_work_id: workId });
        }
      }]).field_observation_progress_read.sort((left, right) => left.page_ordinal - right.page_ordinal);
      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index];
        if (row.page_ordinal !== index || row.expected_revision + 1 !== row.revision ||
            (index === 0 ? row.cursor_in !== null : row.cursor_in !== rows[index - 1].cursor_out) ||
            (index < rows.length - 1 && row.completed)) {
          fail('P7_FIELD_OBSERVATION_PROGRESS_CORRUPT', 'Committed Observation page chain is not continuous.', { workId });
        }
      }
      const latest = rows[rows.length - 1] || null;
      return Object.freeze({ workId, pageCount: rows.length, nextPageOrdinal: rows.length,
        expectedObservationRevision: latest ? Number(latest.revision) : null,
        cursorIn: latest ? latest.cursor_out : null, completed: latest ? Boolean(latest.completed) : false,
        latestResultDigest: latest?.result_digest || null });
    },
  });
}

module.exports = Object.freeze({ FieldObservationProgressReaderError, createFieldObservationProgressReader });
