'use strict';

const path = require('node:path');
const {
  createRepositoryDefinition,
} = require('../../../foundation/persistence/owner-repository');

function normalizeDirectoryKey(value) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

const ACTIVE_RUN_STATES = Object.freeze(['ready', 'offloading', 'blocked']);

/**
 * Queries target directories currently occupied by active Arca Inventory
 * entries or non-terminal On-deck Runs on a given Storage Endpoint.
 */
function createTargetDirectoryOccupancyQuery(options) {
  if (!options?.schemaManifest || !options.unitOfWork) {
    throw new TypeError('Arca Target Directory Occupancy Query requires clean persistence.');
  }
  const repository = createRepositoryDefinition({
    repositoryId: 'arca_target_directory_occupancy_query',
    owner: 'arca',
    schemaManifest: options.schemaManifest,
    statements: {
      list_active_materials: {
        kind: 'select-all',
        tableId: 'arca_inventory_materials',
        columns: ['shelf_entry_id', 'location'],
        keyColumns: ['active_guard', 'endpoint_id'],
      },
      list_runs_by_state: {
        kind: 'select-all',
        tableId: 'arca_ondeck_runs',
        columns: ['on_deck_run_id'],
        keyColumns: ['state'],
      },
      find_decision: {
        kind: 'select-one',
        tableId: 'arca_final_inventory_decisions',
        columns: ['on_deck_run_id', 'target_endpoint_id', 'target_location'],
        keyColumns: ['on_deck_run_id'],
      },
    },
  });

  function readOccupiedTargetDirectories(request) {
    const endpointId = request?.endpointId;
    if (typeof endpointId !== 'string' || !endpointId) {
      throw new TypeError('Arca Target Directory Occupancy Query requires an exact endpointId.');
    }
    const excludeShelfEntryId = request.excludeShelfEntryId || null;
    const excludeOnDeckRunId = request.excludeOnDeckRunId || null;
    return options.unitOfWork.execute([{
      participantId: 'arca_target_directory_occupancy_read',
      owner: 'arca',
      repositories: [repository],
      execute(context) {
        const repo = context.repository(repository.repositoryId);
        const occupied = new Set();
        const materials = repo.invoke('list_active_materials', {
          active_guard: 1,
          endpoint_id: endpointId,
        });
        for (const row of materials) {
          if (excludeShelfEntryId && row.shelf_entry_id === excludeShelfEntryId) continue;
          if (typeof row.location === 'string' && row.location) {
            occupied.add(normalizeDirectoryKey(path.dirname(path.resolve(row.location))));
          }
        }
        for (const state of ACTIVE_RUN_STATES) {
          const runs = repo.invoke('list_runs_by_state', { state });
          for (const run of runs) {
            if (excludeOnDeckRunId && run.on_deck_run_id === excludeOnDeckRunId) continue;
            const decision = repo.invoke('find_decision', {
              on_deck_run_id: run.on_deck_run_id,
            });
            if (decision && decision.target_endpoint_id === endpointId &&
                typeof decision.target_location === 'string' && decision.target_location) {
              occupied.add(normalizeDirectoryKey(decision.target_location));
            }
          }
        }
        return occupied;
      },
    }]).arca_target_directory_occupancy_read;
  }

  return Object.freeze({ readOccupiedTargetDirectories });
}

module.exports = Object.freeze({
  createTargetDirectoryOccupancyQuery,
});
