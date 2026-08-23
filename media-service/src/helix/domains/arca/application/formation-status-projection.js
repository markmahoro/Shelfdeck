'use strict';

const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');

const MAX_ITEMS = 100;

function createFormationStatusProjection(options) {
  if (!options?.schemaManifest || !options.unitOfWork) {
    throw new TypeError('Arca Formation status projection requires clean persistence.');
  }
  const repository = createRepositoryDefinition({
    repositoryId: 'arca_formation_status_projection',
    owner: 'arca',
    schemaManifest: options.schemaManifest,
    statements: {
      receipts: {
        kind: 'select-in', tableId: 'arca_handoff_b_receipts', keyColumn: 'offer_id', maxItems: MAX_ITEMS,
        columns: ['offer_id', 'outcome', 'custody_id', 'on_deck_package_id', 'package_digest', 'rejection_code', 'committed_at_ms'],
        safeIntegers: true,
      },
      recoveries: {
        kind: 'select-in', tableId: 'arca_acceptance_recovery_cases', keyColumn: 'offer_id', maxItems: MAX_ITEMS,
        columns: ['offer_id', 'active_work_id', 'recovery_state', 'error_code', 'updated_at_ms'], safeIntegers: true,
      },
      runs: {
        kind: 'select-in', tableId: 'arca_ondeck_runs', keyColumn: 'custody_id', maxItems: MAX_ITEMS,
        columns: ['on_deck_run_id', 'custody_id', 'state', 'terminal_at_ms'], safeIntegers: true,
      },
      commits: {
        kind: 'select-in', tableId: 'arca_ondeck_commit_receipts', keyColumn: 'on_deck_run_id', maxItems: MAX_ITEMS,
        columns: ['on_deck_run_id', 'shelf_entry_id', 'inventory_revision', 'deck_fact_revision',
          'related_disposition_completion_digest', 'commit_digest', 'committed_at_ms'], safeIntegers: true,
      },
      entries: {
        kind: 'select-in', tableId: 'arca_shelf_entries', keyColumn: 'shelf_entry_id', maxItems: MAX_ITEMS,
        columns: ['shelf_entry_id', 'current_inventory_revision', 'current_deck_fact_revision', 'created_at_ms'], safeIntegers: true,
      },
      decks: {
        kind: 'select-in', tableId: 'arca_deck_fact_revisions', keyColumn: 'shelf_entry_id', maxItems: MAX_ITEMS,
        columns: ['shelf_entry_id', 'revision', 'state', 'inventory_revision', 'fact_digest', 'committed_at_ms'], safeIntegers: true,
      },
    },
  });

  function read(offerIds) {
    const ids = [...new Set((offerIds || []).filter((value) => typeof value === 'string' && value))].sort();
    if (ids.length > MAX_ITEMS) throw new RangeError('Arca Formation status projection page exceeds its bound.');
    if (!ids.length) return new Map();
    return options.unitOfWork.execute([{
      participantId: 'arca_formation_status_read', owner: 'arca', repositories: [repository], execute(context) {
        const repo = context.repository(repository.repositoryId);
        const receipts = repo.invoke('receipts', { values: ids });
        const recoveries = repo.invoke('recoveries', { values: ids });
        const custodyIds = receipts.filter((row) => row.outcome === 'accepted' && row.custody_id).map((row) => row.custody_id);
        const runs = custodyIds.length ? repo.invoke('runs', { values: [...new Set(custodyIds)] }) : [];
        const runIds = runs.map((row) => row.on_deck_run_id);
        const commits = runIds.length ? repo.invoke('commits', { values: [...new Set(runIds)] }) : [];
        const entryIds = commits.map((row) => row.shelf_entry_id);
        const entries = entryIds.length ? repo.invoke('entries', { values: [...new Set(entryIds)] }) : [];
        const decks = entryIds.length ? repo.invoke('decks', { values: [...new Set(entryIds)] }) : [];
        const result = new Map();
        for (const recovery of recoveries) {
          if (recovery.recovery_state === 'attention_required') {
            result.set(recovery.offer_id, Object.freeze({
              stage:'attention_required', reasonCode:recovery.error_code || 'ARCA_ACCEPTANCE_EXECUTION_FAILED',
              completedAtMs:null, shelfEntryId:null,
            }));
          } else {
            result.set(recovery.offer_id, Object.freeze({
              stage:'in_progress', reasonCode:null, completedAtMs:null, shelfEntryId:null,
            }));
          }
        }
        for (const receipt of receipts) {
          if (receipt.outcome === 'rejected') {
            result.set(receipt.offer_id, Object.freeze({
              stage: 'attention_required', reasonCode: receipt.rejection_code || 'ARCA_PRODUCT_REJECTED',
              completedAtMs: null, shelfEntryId: null,
            }));
            continue;
          }
          const acceptedRuns = runs.filter((row) => row.custody_id === receipt.custody_id);
          if (acceptedRuns.length !== 1) {
            result.set(receipt.offer_id, Object.freeze({
              stage: 'attention_required', reasonCode: 'ARCA_ONDECK_RESPONSIBILITY_INCOMPLETE',
              completedAtMs: null, shelfEntryId: null,
            }));
            continue;
          }
          const run = acceptedRuns[0];
          if (run.state === 'blocked') {
            result.set(receipt.offer_id, Object.freeze({
              stage: 'attention_required', reasonCode: 'ARCA_ONDECK_BLOCKED',
              completedAtMs: null, shelfEntryId: null,
            }));
            continue;
          }
          const commit = commits.find((row) => row.on_deck_run_id === run.on_deck_run_id);
          const entry = commit && entries.find((row) => row.shelf_entry_id === commit.shelf_entry_id);
          const deck = commit && decks.find((row) => row.shelf_entry_id === commit.shelf_entry_id &&
            Number(row.revision) === Number(commit.deck_fact_revision) && row.state === 'active' &&
            Number(row.inventory_revision) === Number(commit.inventory_revision));
          const complete = run.state === 'committed' && commit && entry && deck &&
            Number(entry.current_inventory_revision) >= Number(commit.inventory_revision) &&
            Number(entry.current_deck_fact_revision) >= Number(commit.deck_fact_revision) &&
            /^[0-9a-f]{64}$/.test(commit.related_disposition_completion_digest || '');
          result.set(receipt.offer_id, Object.freeze(complete ? {
            stage: 'completed', reasonCode: null, completedAtMs: Number(commit.committed_at_ms),
            shelfEntryId: commit.shelf_entry_id, onDeckRunId: run.on_deck_run_id,
          } : {
            stage: 'in_progress', reasonCode: null, completedAtMs: null,
            shelfEntryId: null, onDeckRunId: run.on_deck_run_id,
          }));
        }
        return result;
      },
    }]).arca_formation_status_read;
  }

  return Object.freeze({ read });
}

module.exports = Object.freeze({ MAX_ITEMS, createFormationStatusProjection });
