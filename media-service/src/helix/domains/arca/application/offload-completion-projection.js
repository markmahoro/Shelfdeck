'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');
const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');

class OffloadCompletionPortError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'OffloadCompletionPortError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new OffloadCompletionPortError(code, message);
}

function definition(schemaManifest) {
  return createRepositoryDefinition({
    repositoryId: 'arca_offload_completion_projection',
    owner: 'arca',
    readOnly: true,
    schemaManifest,
    statements: {
      find_completion: {
        kind: 'select-one',
        tableId: 'arca_offload_completions',
        columns: [
          'offload_completion_id', 'on_deck_run_id', 'shelf_entry_id',
          'inventory_revision', 'package_id', 'completion_digest',
          'committed_at_ms',
        ],
        keyColumns: ['package_id'],
        safeIntegers: true,
      },
      find_receipt: {
        kind: 'select-one',
        tableId: 'arca_ondeck_commit_receipts',
        columns: ['on_deck_run_id', 'commit_digest'],
        keyColumns: ['on_deck_run_id'],
      },
    },
  });
}

function createOffloadCompletionPort(options) {
  if (!options?.schemaManifest || !options.unitOfWork) {
    fail('P14_OFFLOAD_PORT_DEPENDENCIES',
      'Off-load Completion Port requires Arca owner persistence.');
  }
  const repository = definition(options.schemaManifest);
  return Object.freeze({
    readCompletion(query) {
      if (!query || query.queryContract !== 'arca.offload-completion@1' ||
          typeof query.onDeckPackageId !== 'string' ||
          !/^[a-f0-9]{64}$/.test(query.expectedPackageDigest || '')) {
        fail('P14_OFFLOAD_QUERY_INVALID',
          'Off-load Completion query is not the closed formal query.');
      }
      return options.unitOfWork.execute([{
        participantId: 'arca_offload_completion_read',
        owner: 'arca',
        repositories: [repository],
        execute(context) {
          const repo = context.repository(repository.repositoryId);
          const row = repo.invoke('find_completion', {
            package_id: query.onDeckPackageId,
          });
          if (!row) {
            return Object.freeze({
              resultKind: 'not_found',
              checkedAtMs: context.commitTimeMs,
            });
          }
          const expectedCompletionDigest = canonicalDigest({
            schema: 'arca.offload-completion@1',
            onDeckRunId: row.on_deck_run_id,
            shelfEntryId: row.shelf_entry_id,
            inventoryRevision: Number(row.inventory_revision),
            packageId: row.package_id,
            packageDigest: query.expectedPackageDigest,
          });
          const receipt = repo.invoke('find_receipt', {
            on_deck_run_id: row.on_deck_run_id,
          });
          if (!receipt ||
              row.completion_digest !== expectedCompletionDigest) {
            fail('P14_OFFLOAD_PROJECTION_INTEGRITY',
              'Arca Off-load Completion cannot be reconstructed exactly.');
          }
          const factBase = {
            schemaRef: 'helix://contracts/types/OffloadCompletionFact/v1',
            schemaVersion: 1,
            factId: row.offload_completion_id,
            ownerDomain: 'arca',
            aggregateType: 'on_deck_run',
            aggregateId: row.on_deck_run_id,
            revision: 1,
            factSchemaRef: 'arca.offload-completion@1',
            commitMarker: canonicalDigest({
              schema: 'arca.on-deck-commit-marker@1',
              onDeckRunId: row.on_deck_run_id,
              commitDigest: receipt.commit_digest,
            }),
            committedAtMs: Number(row.committed_at_ms),
            onDeckRunId: row.on_deck_run_id,
            shelfEntryId: row.shelf_entry_id,
            inventoryRevision: Number(row.inventory_revision),
            packageId: row.package_id,
            completionDigest: row.completion_digest,
          };
          const offloadCompletionFact = Object.freeze({
            ...factBase,
            factDigest: canonicalDigest(factBase),
          });
          const projection = {
            resultKind: 'found',
            projectionRevision: 1,
            onDeckPackageId: query.onDeckPackageId,
            packageDigest: query.expectedPackageDigest,
            offloadCompletionFact,
          };
          projection.projectionDigest = canonicalDigest({
            schema: 'arca.offload-completion-projection@1',
            projectionRevision: 1,
            offloadCompletionFact,
          });
          return Object.freeze(projection);
        },
      }]).arca_offload_completion_read;
    },
  });
}

module.exports = Object.freeze({
  OffloadCompletionPortError,
  createOffloadCompletionPort,
});
