'use strict';

const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');
const {COLUMNS:WITHDRAWAL_COLUMNS,decodeOfferWithdrawalRow}=require('../persistence/offer-withdrawal-store');

const {createSeriesPresentationStore}=require('../persistence/series-presentation-store');
const {createSeriesSourceReassessmentFence}=require('../persistence/series-source-reassessment-fence');
const MAX_ITEMS = 100;
const NON_RETRYABLE = new Set([
  'CLEAN_ARCA_STAGE_TARGET_OCCUPIED', 'CLEAN_ARCA_TARGET_OCCUPIED', 'CLEAN_ARCA_PLACEMENT_UNVERIFIED',
  'CLEAN_ARCA_STAGE_SLOT_INVALID', 'CLEAN_ARCA_STAGE_SLOT_DRIFT', 'CLEAN_ARCA_TARGET_ESCAPE',
  'CLEAN_ARCA_SETTLEMENT_REALITY_DRIFT', 'CLEAN_ARCA_SETTLEMENT_UNKNOWN_MEMBER',
  'CLEAN_ARCA_SETTLEMENT_MAPPING_INVALID', 'CLEAN_ARCA_SETTLEMENT_MAPPING_DRIFT',
  'CLEAN_ARCA_SETTLEMENT_HANDLE_INVALID', 'ARCA_ONDECK_SETTLEMENT_APPROVAL_STALE',
  'CLEAN_ARCA_FINAL_NFO_SEMANTIC_DRIFT', 'CLEAN_ARCA_FINAL_NFO_BASIS_MISSING',
]);
const RECHECKABLE = new Set(['CLEAN_ARCA_STAGE_TARGET_OCCUPIED', 'CLEAN_ARCA_TARGET_OCCUPIED']);

function createFormationStatusProjection(options) {
  if (!options?.schemaManifest || !options.unitOfWork) {
    throw new TypeError('Arca Formation status projection requires clean persistence.');
  }
  function blockedFailure(onDeckRunId) {
    const reader = options.workResultReader;
    if (typeof reader?.listWorks !== 'function' || typeof reader.readFailures !== 'function') return null;
    const works = reader.listWorks({ownerDomain:'arca',processType:'arca_ondeck_run',processId:onDeckRunId,workKind:'on_deck_execution'});
    const ordered = works.slice().sort((left,right)=>Number(left.created_at_ms)-Number(right.created_at_ms) ||
      String(left.work_id).localeCompare(String(right.work_id))).reverse();
    for (const work of ordered) {
      const failure = reader.readFailures(work.work_id)[0];
      if (failure) return Object.freeze({workId:work.work_id,failureCode:failure.code||null,diagnostics:failure.diagnostics||null});
    }
    return null;
  }
  const repository = createRepositoryDefinition({
    repositoryId: 'arca_formation_status_projection',
    owner: 'arca',
    schemaManifest: options.schemaManifest,
    statements: {
      withdrawals:{kind:'select-in',tableId:'arca_offer_withdrawal_receipts',keyColumn:'offer_id',maxItems:MAX_ITEMS,
        columns:WITHDRAWAL_COLUMNS,safeIntegers:true},
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
        columns: ['receipt_id','on_deck_run_id', 'shelf_entry_id', 'inventory_revision', 'deck_fact_revision',
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
    const blockedRuns = [];
    const result = options.unitOfWork.execute([{
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
            blockedRuns.push({ offerId: receipt.offer_id, onDeckRunId: run.on_deck_run_id });
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
            onDeckCommitReceipt:Object.freeze({receiptId:commit.receipt_id,receiptKind:'on_deck_committed',
              ownerDomain:'arca',onDeckRunId:run.on_deck_run_id,onDeckPackageId:receipt.on_deck_package_id,
              packageDigest:receipt.package_digest,shelfEntryId:commit.shelf_entry_id,
              inventoryRevision:Number(commit.inventory_revision),deckFactRevision:Number(commit.deck_fact_revision),
              commitDigest:commit.commit_digest,committedAtMs:Number(commit.committed_at_ms)}),
          } : {
            stage: 'in_progress', reasonCode: null, completedAtMs: null,
            shelfEntryId: null, onDeckRunId: run.on_deck_run_id,
          }));
        }
        for(const row of repo.invoke('withdrawals',{values:ids})){
          const receipt=decodeOfferWithdrawalRow(row);
          if(receipts.some(item=>item.offer_id===row.offer_id&&item.outcome==='accepted'))
            throw Object.assign(new Error('A withdrawn Offer cannot also own Accepted responsibility.'),{code:'ARCA_OFFER_WITHDRAWAL_CORRUPT'});
          result.set(row.offer_id,Object.freeze({stage:'offer_withdrawn',reasonCode:'target_not_current',completedAtMs:null,
            shelfEntryId:null,withdrawalReceipt:receipt}));
        }
        return result;
      },
    }]).arca_formation_status_read;
    for (const blocked of blockedRuns) {
      const failure = blockedFailure(blocked.onDeckRunId), failureCode = failure?.failureCode || null;
      result.set(blocked.offerId, Object.freeze({
        stage: 'attention_required', reasonCode: 'ARCA_ONDECK_BLOCKED',
        completedAtMs: null, shelfEntryId: null, onDeckRunId: blocked.onDeckRunId,
        failureCode, diagnostics: failure?.diagnostics || null,
        retryAvailable: failureCode ? !NON_RETRYABLE.has(failureCode) : true,
        canRecheck: failureCode ? RECHECKABLE.has(failureCode) : false,
      }));
    }
    if (typeof options.workResultReader?.scopedWorkStatus === 'function') {
      for (const [offerId, status] of result) {
        if (!status.onDeckRunId) continue;
        const seriesStore=createSeriesPresentationStore(options),reservation=seriesStore.read('run_reservation',{on_deck_run_id:status.onDeckRunId}),
          shared=reservation&&seriesStore.readScope(reservation.scope_id);
        if(status.stage!=='in_progress'){
          if(reservation?.committed_version){const version=seriesStore.manifest(reservation.scope_id,Number(reservation.committed_version));if(version)result.set(offerId,Object.freeze({...status,sharedBuildId:version.value.buildId}));}
          continue;
        }
        const work=options.workResultReader.scopedWorkStatus({ownerDomain:'arca',processType:'arca_ondeck_run',processId:status.onDeckRunId,workKind:'on_deck_execution'}),
          sharedStatus=shared?.active_build_id?options.workResultReader.scopedWorkStatus({
            ownerDomain:'arca',processType:'arca_series_presentation',processId:shared.active_build_id,workKind:'series_presentation'}):null;
        if(shared?.active_build_id){result.set(offerId,Object.freeze({...status,sharedBuildId:shared.active_build_id}));}
        else if(reservation?.committed_version){const version=seriesStore.manifest(reservation.scope_id,Number(reservation.committed_version));if(version)result.set(offerId,Object.freeze({...status,sharedBuildId:version.value.buildId}));}
        if(sharedStatus&&!sharedStatus.open&&sharedStatus.latestState==='failed'){
          let canSupplyImages=false;if(options.series)canSupplyImages=options.series.canReassess(shared.active_build_id);else try{options.unitOfWork.execute([createSeriesSourceReassessmentFence(options,shared.active_build_id)]);canSupplyImages=true;}catch(error){if(error.code!=='ARCA_SERIES_SOURCE_REASSESSMENT_UNSAFE')throw error;}
          result.set(offerId,Object.freeze({...status,stage:'attention_required',reasonCode:sharedStatus.failureCode||'ARCA_SERIES_PRESENTATION_FAILED',retryAvailable:true,canSupplyImages,blockedPhase:'series_presentation',sharedBuildId:shared.active_build_id}));continue;
        }
        if (!work.open && work.latestState === 'failed') {
          result.set(offerId, Object.freeze({ ...status, stage:'attention_required',
            reasonCode:work.failureCode || 'ARCA_ONDECK_EXECUTION_FAILED' }));
        }
      }
    }
    return result;
  }

  return Object.freeze({ read });
}

module.exports = Object.freeze({ MAX_ITEMS, createFormationStatusProjection });
