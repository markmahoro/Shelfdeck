'use strict';

const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const DELETE_BATCH_LIMIT = 1000;
const SCAN_PAGE_LIMIT = 500;
const SCAN_LIMIT = 10000;
const OPEN_WORK_STATES = new Set(['admitted', 'ready', 'running', 'blocked']);

class FieldObservationRetentionStoreError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'FieldObservationRetentionStoreError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new FieldObservationRetentionStoreError(code, message, details);
}

function definitions(schemaManifest) {
  const procurement = createRepositoryDefinition({
    repositoryId: 'field_observation_retention', owner: 'procurement', schemaManifest,
    statements: {
      candidate_entries: { kind:'select-before-page', tableId:'proc_field_observation_entries', columns:[
        'field_id','field_observation_work_id','observation_id','material_key','page_ordinal','entry_ordinal','observed_at_ms'
      ], upperBoundColumn:'observed_at_ms', orderBy:[
        'observed_at_ms','field_id','field_observation_work_id','page_ordinal','entry_ordinal'
      ], maxItems:SCAN_PAGE_LIMIT },
      delete_entry: { kind:'delete-one', tableId:'proc_field_observation_entries', keyColumns:[
        'field_id','field_observation_work_id','page_ordinal','entry_ordinal'
      ] },
      fields: { kind:'select-all', tableId:'proc_material_fields', columns:['field_id','current_observation_revision'], keyColumns:[] },
      observation: { kind:'select-one', tableId:'proc_field_observations', columns:[
        'field_id','revision','observation_id','field_observation_work_id'
      ], keyColumns:['field_id','revision'] },
      material: { kind:'select-one', tableId:'proc_field_materials', columns:[
        'field_id','material_key','last_observation_id'
      ], keyColumns:['field_id','material_key'] },
      runs: { kind:'select-all', tableId:'proc_procurement_runs', columns:[
        'field_observation_work_id','state'
      ], keyColumns:['state'] },
      retries: { kind:'select-all', tableId:'proc_procurement_retry_intents', columns:[
        'retry_field_observation_work_id','state'
      ], keyColumns:['state'] },
    },
  });
  const foundation = createRepositoryDefinition({
    repositoryId: 'field_observation_retention_works', owner:'execution-foundation', schemaManifest,
    statements: {
      observation_works: { kind:'select-all', tableId:'fx_supporting_works', columns:['work_id','state'],
        keyColumns:['owner_domain','process_type','work_kind','state'] },
    },
  });
  return Object.freeze({ procurement, foundation });
}

function exactMaterialPointer(row) {
  return row.field_id + '\0' + row.observation_id + '\0' + row.material_key;
}

function classifyProtection(row, protection) {
  if (protection.openWorkIds.has(row.field_observation_work_id)) return 'non_terminal_work';
  if (protection.currentFieldWorkIds.has(row.field_observation_work_id)) return 'current_field_work';
  if (protection.runWorkIds.has(row.field_observation_work_id)) return 'procurement_run';
  if (protection.retryWorkIds.has(row.field_observation_work_id)) return 'open_retry_intent';
  if (protection.currentMaterialPointers.has(exactMaterialPointer(row))) return 'current_material_pointer';
  return null;
}

function createFieldObservationRetentionStore(options) {
  if (!options?.schemaManifest || !options.unitOfWork || typeof options.unitOfWork.execute !== 'function') {
    fail('P7_FIELD_OBSERVATION_RETENTION_DEPENDENCIES', 'Observation retention requires clean persistence.');
  }
  const repositories = definitions(options.schemaManifest);

  function purge(input) {
    if (!input || !Number.isSafeInteger(input.cutoffMs) || input.cutoffMs < RETENTION_MS ||
        !Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > DELETE_BATCH_LIMIT) {
      fail('P7_FIELD_OBSERVATION_RETENTION_INPUT_INVALID', 'Observation retention cutoff or batch limit is invalid.');
    }
    let openWorkIds;
    const result = options.unitOfWork.execute([{
      participantId:'field_observation_retention_work_read', owner:'execution-foundation',
      boundBusinessOwner:'procurement', repositories:[repositories.foundation], execute(context) {
        const repository = context.repository(repositories.foundation.repositoryId);
        const rows = [...OPEN_WORK_STATES].flatMap((state) => repository.invoke('observation_works', {
          owner_domain:'procurement', process_type:'material_field', work_kind:'field_observation', state,
        }));
        openWorkIds = new Set(rows.map((row) => row.work_id));
        return Object.freeze({ openWorkCount:openWorkIds.size });
      },
    }, {
      participantId:'field_observation_retention_delete', owner:'procurement', repositories:[repositories.procurement], execute(context) {
        if (!openWorkIds) fail('P7_FIELD_OBSERVATION_RETENTION_WORK_SNAPSHOT_MISSING', 'Retention Work snapshot is missing.');
        const repository = context.repository(repositories.procurement.repositoryId);
        const currentFieldWorkIds = new Set(repository.invoke('fields').map((field) =>
          field.current_observation_revision === null ? null :
            repository.invoke('observation', { field_id:field.field_id,
              revision:field.current_observation_revision })?.field_observation_work_id
        ).filter(Boolean));
        const runWorkIds = new Set(['active','waiting'].flatMap((state) => repository.invoke('runs', { state }))
          .map((run) => run.field_observation_work_id));
        const retryWorkIds = new Set(repository.invoke('retries', { state:'open' })
          .map((intent) => intent.retry_field_observation_work_id));
        const currentMaterialPointers = new Set();
        const materialCache = new Map();
        const protection = { openWorkIds, currentFieldWorkIds, runWorkIds, retryWorkIds, currentMaterialPointers };
        const protectedByReason = Object.create(null);
        let scanned = 0; let deleted = 0; let offset = 0; let exhausted = false;
        while (scanned < SCAN_LIMIT && deleted < input.limit) {
          const pageLimit = Math.min(SCAN_PAGE_LIMIT, SCAN_LIMIT - scanned);
          const candidates = repository.invoke('candidate_entries', {
            upperBound:input.cutoffMs, offset, limit:pageLimit,
          });
          if (candidates.length === 0) { exhausted = true; break; }
          let protectedCount = 0;
          for (const row of candidates) {
            if (deleted >= input.limit) break;
            const materialCacheKey = row.field_id + '\0' + row.material_key;
            if (!materialCache.has(materialCacheKey)) materialCache.set(materialCacheKey,
              repository.invoke('material', { field_id:row.field_id, material_key:row.material_key }) || null);
            const currentMaterial = materialCache.get(materialCacheKey);
            if (currentMaterial?.last_observation_id === row.observation_id) {
              currentMaterialPointers.add(exactMaterialPointer(row));
            }
            const reason = classifyProtection(row, protection);
            if (reason) {
              protectedByReason[reason] = (protectedByReason[reason] || 0) + 1;
              protectedCount += 1;
              continue;
            }
            const removed = repository.invoke('delete_entry', row);
            if (removed.changes !== 1) fail('P7_FIELD_OBSERVATION_RETENTION_DELETE_FENCE', 'Retention candidate changed inside its transaction.');
            deleted += 1;
          }
          scanned += candidates.length;
          offset += protectedCount;
          if (candidates.length < pageLimit) { exhausted = true; break; }
        }
        return Object.freeze({
          cutoffMs:input.cutoffMs, scanned, deleted, exhausted,
          backlogLikely:deleted === input.limit || !exhausted,
          protectedByReason:Object.freeze({ ...protectedByReason }),
          protectedWorkCounts:Object.freeze({ open:openWorkIds.size, currentField:currentFieldWorkIds.size,
            run:runWorkIds.size, retry:retryWorkIds.size }),
        });
      },
    }]);
    return result.field_observation_retention_delete;
  }

  return Object.freeze({ purge });
}

module.exports = Object.freeze({
  DELETE_BATCH_LIMIT,
  RETENTION_MS,
  FieldObservationRetentionStoreError,
  classifyProtection,
  createFieldObservationRetentionStore,
});
