'use strict';

const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');

const COMPLETION_WORKS = new Set([
  'product_conformance',
  'deliverable_promotion',
  'external_import_selection',
]);

function createLibraRunExecutionProjection(options) {
  if (!options?.schemaManifest || !options.unitOfWork) {
    throw new TypeError('Libra Run Execution Projection requires Libra persistence.');
  }
  const repository = createRepositoryDefinition({
    repositoryId: 'libra_run_execution_projection',
    owner: 'libra',
    schemaManifest: options.schemaManifest,
    statements: {
      find_run: {
        kind: 'select-one',
        tableId: 'libra_runs',
        columns: ['libra_run_id', 'state', 'priority_class'],
        keyColumns: ['libra_run_id'],
      },
      list_revisions: {
        kind: 'select-all',
        tableId: 'libra_run_revisions',
        columns: ['libra_run_id', 'state_revision', 'transition_kind'],
        keyColumns: ['libra_run_id'],
      },
    },
  });
  const cache = new Map();

  function read({ processId, workKind }) {
    let runPriority = cache.get(processId);
    if (!runPriority) runPriority = options.unitOfWork.execute([{
      participantId: 'libra_run_execution_projection_read',
      owner: 'libra',
      repositories: [repository],
      execute(context) {
        const repo = context.repository(repository.repositoryId);
        const run = repo.invoke('find_run', { libra_run_id: processId });
        if (!run) throw new Error('Libra Run priority projection is unavailable.');
        const priorityRevision = 1 + repo.invoke('list_revisions', {
          libra_run_id: processId,
        }).filter((row) => row.transition_kind === 'reprioritized').length;
        return Object.freeze({
          priorityClass: run.priority_class === 'expedited'
            ? 'expedited_formation'
            : 'normal_foreground',
          priorityRevision,
        });
      },
    }]).libra_run_execution_projection_read;
    cache.set(processId, runPriority);
    return Object.freeze({
      ...runPriority,
      localPriority: COMPLETION_WORKS.has(workKind) ? 200 : 100,
      supplyRole: COMPLETION_WORKS.has(workKind) ? 'completion' : 'expansion',
    });
  }

  function invalidate(processId) {
    cache.delete(processId);
  }

  return Object.freeze({ read, invalidate });
}

module.exports = Object.freeze({ createLibraRunExecutionProjection });
