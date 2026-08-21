'use strict';

const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');

function createFormationRunHistoryStore(options) {
  if (!options?.schemaManifest || !options.unitOfWork) {
    throw new TypeError('Formation Run history store requires clean persistence.');
  }
  const repository = createRepositoryDefinition({
    repositoryId: 'libra_formation_run_history', owner: 'libra', schemaManifest: options.schemaManifest,
    statements: {
      discarded_page: {
        kind: 'select-filtered-page', tableId: 'libra_run_discard_receipts', maxItems: 101,
        orderBy: [{ column: 'committed_at_ms', direction: 'desc' }, { column: 'receipt_id', direction: 'asc' }],
        columns: ['receipt_id', 'libra_run_id', 'committed_run_state_revision', 'commit_digest', 'committed_at_ms'],
        safeIntegers: true,
      },
      runs: {
        kind: 'select-in', tableId: 'libra_runs', keyColumn: 'libra_run_id', maxItems: 101,
        columns: ['libra_run_id', 'subject_id', 'state', 'state_revision', 'state_digest'], safeIntegers: true,
      },
    },
  });

  function listDiscarded(offset, limit) {
    return options.unitOfWork.execute([{
      participantId: 'libra_formation_run_history_read', owner: 'libra', repositories: [repository], execute(context) {
        const repo = context.repository(repository.repositoryId);
        const receipts = repo.invoke('discarded_page', { offset, limit });
        if (!receipts.length) return Object.freeze([]);
        const runs = new Map(repo.invoke('runs', { values: receipts.map((row) => row.libra_run_id) })
          .map((row) => [row.libra_run_id, row]));
        return Object.freeze(receipts.map((receipt) => {
          const run = runs.get(receipt.libra_run_id);
          if (!run || run.state !== 'discarded' || Number(run.state_revision) !== Number(receipt.committed_run_state_revision)) {
            throw Object.assign(new Error('Discarded Formation history cannot be reconstructed.'), {
              code: 'FORMATION_DISCARD_HISTORY_INTEGRITY', libraRunId: receipt.libra_run_id,
            });
          }
          return Object.freeze({
            historyId: receipt.receipt_id, libraRunId: receipt.libra_run_id, subjectId: run.subject_id,
            outcome: 'user_abandoned', label: '已结束 · 用户放弃', endedAtMs: Number(receipt.committed_at_ms),
            stateRevision: Number(run.state_revision), stateDigest: run.state_digest, evidenceDigest: receipt.commit_digest,
          });
        }));
      },
    }]).libra_formation_run_history_read;
  }

  return Object.freeze({ listDiscarded });
}

module.exports = Object.freeze({ createFormationRunHistoryStore });
