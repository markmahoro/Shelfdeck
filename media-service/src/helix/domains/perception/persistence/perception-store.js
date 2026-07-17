'use strict';

const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');
const { createCursor, createRecord, createRelation, createResolution, createSource } = require('../model/perception-store-contracts');

class PerceptionStoreError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'PerceptionStoreError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) { throw new PerceptionStoreError(code, message, details); }
function exactInput(value, keys, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length ||
      keys.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) fail(code, 'Perception Store input does not match its closed contract.');
}

function createPerceptionStore(options) {
  if (!options || !options.schemaManifest || !options.unitOfWork || typeof options.unitOfWork.execute !== 'function') {
    fail('P6_PERCEPTION_STORE_DEPENDENCIES', 'Schema manifest and Perception unit of work are required.');
  }
  const recordDefinition = createRepositoryDefinition({
    repositoryId: 'perception_record_repository', owner: 'perception', schemaManifest: options.schemaManifest,
    statements: {
      insert_source: { kind: 'insert', tableId: 'perception_sources', columns: [
        'perception_source_id', 'source_kind', 'integration_id', 'status', 'config_revision', 'created_at_ms', 'updated_at_ms'
      ] },
      find_source: { kind: 'select-one', tableId: 'perception_sources', columns: [
        'perception_source_id', 'source_kind', 'integration_id', 'status', 'config_revision', 'current_cursor_revision', 'created_at_ms', 'updated_at_ms'
      ], keyColumns: ['perception_source_id'] },
      revise_source: { kind: 'update', tableId: 'perception_sources', setColumns: [
        'source_kind', 'integration_id', 'status', 'config_revision', 'updated_at_ms'
      ], keyColumns: ['perception_source_id'], compareColumns: [{ column: 'config_revision', parameter: 'expected_config_revision' }] },
      initialize_cursor_head: { kind: 'update', tableId: 'perception_sources', setColumns: ['current_cursor_revision', 'updated_at_ms'],
        keyColumns: ['perception_source_id'] },
      advance_cursor_head: { kind: 'update', tableId: 'perception_sources', setColumns: ['current_cursor_revision', 'updated_at_ms'],
        keyColumns: ['perception_source_id'], compareColumns: [{ column: 'current_cursor_revision', parameter: 'expected_cursor_revision' }] },
      insert_cursor: { kind: 'insert', tableId: 'perception_source_cursors', columns: [
        'perception_source_id', 'revision', 'cursor_value', 'observation_digest', 'committed_at_ms'
      ] },
      find_cursor: { kind: 'select-one', tableId: 'perception_source_cursors', columns: [
        'perception_source_id', 'revision', 'cursor_value', 'observation_digest', 'committed_at_ms'
      ], keyColumns: ['perception_source_id', 'revision'] },
      insert_record: { kind: 'insert', tableId: 'perception_records', columns: [
        'perception_id', 'perception_source_id', 'source_kind', 'source_record_key', 'source_record_revision', 'source_record_digest',
        'rating', 'watched_state', 'observed_title', 'provenance_digest', 'observed_at_ms', 'committed_at_ms'
      ] },
      find_record: { kind: 'select-one', tableId: 'perception_records', columns: [
        'perception_id', 'perception_source_id', 'source_kind', 'source_record_key', 'source_record_revision', 'source_record_digest',
        'rating', 'watched_state', 'observed_title', 'provenance_digest', 'observed_at_ms', 'committed_at_ms'
      ], keyColumns: ['perception_id'] },
      find_record_by_source_identity: { kind: 'select-one', tableId: 'perception_records', columns: [
        'perception_id', 'perception_source_id', 'source_kind', 'source_record_key', 'source_record_revision', 'source_record_digest',
        'rating', 'watched_state', 'observed_title', 'provenance_digest', 'observed_at_ms', 'committed_at_ms'
      ], keyColumns: ['perception_source_id', 'source_record_key', 'source_record_revision', 'source_record_digest'] },
      insert_anchor: { kind: 'insert', tableId: 'perception_identity_anchors', columns: [
        'perception_id', 'anchor_kind', 'anchor_value', 'confidence_class', 'evidence_digest'
      ] },
      find_anchors: { kind: 'select-all', tableId: 'perception_identity_anchors', columns: [
        'perception_id', 'anchor_kind', 'anchor_value', 'confidence_class', 'evidence_digest'
      ], keyColumns: ['perception_id'] },
      find_anchor_matches: { kind: 'select-all', tableId: 'perception_identity_anchors', columns: [
        'perception_id', 'anchor_kind', 'anchor_value', 'confidence_class', 'evidence_digest'
      ], keyColumns: ['anchor_kind', 'anchor_value'] },
      insert_relation: { kind: 'insert', tableId: 'perception_dedup_relations', columns: [
        'relation_id', 'left_perception_id', 'right_perception_id', 'rule_revision', 'relation', 'evidence_digest', 'committed_at_ms'
      ] },
      find_relation_pair: { kind: 'select-one', tableId: 'perception_dedup_relations', columns: [
        'relation_id', 'left_perception_id', 'right_perception_id', 'rule_revision', 'relation', 'evidence_digest', 'committed_at_ms'
      ], keyColumns: ['left_perception_id', 'right_perception_id'] }
    }
  });
  const resolutionDefinition = createRepositoryDefinition({
    repositoryId: 'perception_resolution_repository', owner: 'perception', schemaManifest: options.schemaManifest,
    statements: {
      insert_resolution: { kind: 'insert', tableId: 'perception_resolution_revisions', columns: [
        'resolution_id', 'query_contract', 'query_input_digest', 'revision', 'result_kind', 'winning_perception_id', 'result_digest', 'resolved_at_ms'
      ] },
      find_resolution: { kind: 'select-one', tableId: 'perception_resolution_revisions', columns: [
        'resolution_id', 'query_contract', 'query_input_digest', 'revision', 'result_kind', 'winning_perception_id', 'result_digest', 'resolved_at_ms'
      ], keyColumns: ['resolution_id'] },
      insert_resolution_head: { kind: 'insert', tableId: 'perception_resolution_heads', columns: [
        'query_contract', 'query_input_digest', 'current_resolution_id', 'current_revision', 'updated_at_ms'
      ] },
      find_resolution_head: { kind: 'select-one', tableId: 'perception_resolution_heads', columns: [
        'query_contract', 'query_input_digest', 'current_resolution_id', 'current_revision', 'updated_at_ms'
      ], keyColumns: ['query_contract', 'query_input_digest'] },
      advance_resolution_head: { kind: 'update', tableId: 'perception_resolution_heads',
        setColumns: ['current_resolution_id', 'current_revision', 'updated_at_ms'], keyColumns: ['query_contract', 'query_input_digest'],
        compareColumns: [{ column: 'current_revision', parameter: 'expected_current_revision' }] }
    }
  });

  function execute(repositories, body) {
    return options.unitOfWork.execute([{
      participantId: 'perception_store', owner: 'perception', repositories, execute: body
    }]).perception_store;
  }

  const repositoryManifest = Object.freeze({
    components: Object.freeze([
      Object.freeze({ component: 'PerceptionRecordRepository', repositoryId: recordDefinition.repositoryId, tableIds: recordDefinition.tableIds }),
      Object.freeze({ component: 'PerceptionResolutionRepository', repositoryId: resolutionDefinition.repositoryId, tableIds: resolutionDefinition.tableIds })
    ])
  });

  return Object.freeze({
    repositoryManifest,
    registerSource(input) {
      exactInput(input, ['perceptionSourceId', 'sourceKind', 'integrationId', 'status', 'configRevision', 'initialCursor'], 'P6_PERCEPTION_SOURCE_INPUT');
      if (input.initialCursor !== null) exactInput(input.initialCursor, ['revision', 'cursorValue', 'observationDigest'], 'P6_PERCEPTION_CURSOR_INPUT');
      return execute([recordDefinition], (context) => {
        const repository = context.repository(recordDefinition.repositoryId);
        if (input.configRevision !== 1 || input.initialCursor !== null && input.initialCursor.revision !== 1) {
          fail('P6_PERCEPTION_SOURCE_INITIAL_REVISION', 'New Source and an optional initial Cursor must start at revision 1.');
        }
        repository.invoke('insert_source', {
          perception_source_id: input.perceptionSourceId, source_kind: input.sourceKind, integration_id: input.integrationId,
          status: input.status, config_revision: input.configRevision, created_at_ms: context.commitTimeMs, updated_at_ms: context.commitTimeMs
        });
        if (input.initialCursor === null) return mapSource(repository.invoke('find_source', { perception_source_id: input.perceptionSourceId }));
        const cursor = createCursor({ perceptionSourceId: input.perceptionSourceId, ...input.initialCursor, committedAtMs: context.commitTimeMs });
        repository.invoke('insert_cursor', cursorRow(cursor));
        const initialized = repository.invoke('initialize_cursor_head', {
          current_cursor_revision: 1, updated_at_ms: context.commitTimeMs, perception_source_id: input.perceptionSourceId
        });
        if (initialized.changes !== 1) fail('P6_PERCEPTION_CURSOR_HEAD_INITIALIZE', 'Perception Source cursor head initialization failed.');
        return mapSource(repository.invoke('find_source', { perception_source_id: input.perceptionSourceId }));
      });
    },
    reviseSource(input, expectedConfigRevision) {
      exactInput(input, ['perceptionSourceId', 'sourceKind', 'integrationId', 'status', 'configRevision'], 'P6_PERCEPTION_SOURCE_INPUT');
      return execute([recordDefinition], (context) => {
        const repository = context.repository(recordDefinition.repositoryId);
        const current = repository.invoke('find_source', { perception_source_id: input.perceptionSourceId });
        if (!current) fail('P6_PERCEPTION_SOURCE_NOT_FOUND', 'Perception Source does not exist.');
        if (expectedConfigRevision !== current.config_revision || input.configRevision !== current.config_revision + 1) {
          fail('P6_PERCEPTION_SOURCE_REVISION_CONFLICT', 'Perception Source config revision is stale or skipped.');
        }
        const result = repository.invoke('revise_source', {
          source_kind: input.sourceKind, integration_id: input.integrationId, status: input.status,
          config_revision: input.configRevision, updated_at_ms: context.commitTimeMs,
          perception_source_id: input.perceptionSourceId, expected_config_revision: expectedConfigRevision
        });
        if (result.changes !== 1) fail('P6_PERCEPTION_SOURCE_REVISION_CONFLICT', 'Perception Source config changed concurrently.');
        return mapSource(repository.invoke('find_source', { perception_source_id: input.perceptionSourceId }));
      });
    },
    advanceSourceCursor(input, expectedCursorRevision) {
      exactInput(input, ['perceptionSourceId', 'revision', 'cursorValue', 'observationDigest'], 'P6_PERCEPTION_CURSOR_INPUT');
      return execute([recordDefinition], (context) => {
        const repository = context.repository(recordDefinition.repositoryId);
        const source = repository.invoke('find_source', { perception_source_id: input.perceptionSourceId });
        if (!source) fail('P6_PERCEPTION_SOURCE_NOT_FOUND', 'Perception Source does not exist.');
        const nextRevision = source.current_cursor_revision === null ? 1 : source.current_cursor_revision + 1;
        if (expectedCursorRevision !== source.current_cursor_revision || input.revision !== nextRevision) {
          fail('P6_PERCEPTION_CURSOR_REVISION_CONFLICT', 'Perception Source cursor revision is stale or skipped.');
        }
        const cursor = createCursor({ ...input, committedAtMs: context.commitTimeMs });
        repository.invoke('insert_cursor', cursorRow(cursor));
        const result = source.current_cursor_revision === null
          ? repository.invoke('initialize_cursor_head', {
            current_cursor_revision: cursor.revision, updated_at_ms: context.commitTimeMs,
            perception_source_id: cursor.perceptionSourceId
          })
          : repository.invoke('advance_cursor_head', {
            current_cursor_revision: cursor.revision, updated_at_ms: context.commitTimeMs,
            perception_source_id: cursor.perceptionSourceId, expected_cursor_revision: expectedCursorRevision
          });
        if (result.changes !== 1) fail('P6_PERCEPTION_CURSOR_REVISION_CONFLICT', 'Perception Source cursor changed concurrently.');
        return cursor;
      });
    },
    appendRecord(input) {
      exactInput(input, ['perceptionId', 'perceptionSourceId', 'sourceKind', 'sourceRecordKey', 'sourceRecordRevision',
        'sourceRecordDigest', 'rating', 'watchedState', 'observedTitle', 'provenanceDigest', 'observedAtMs', 'anchors'], 'P6_PERCEPTION_RECORD_INPUT');
      return execute([recordDefinition], (context) => {
        const repository = context.repository(recordDefinition.repositoryId);
        if (!repository.invoke('find_source', { perception_source_id: input.perceptionSourceId })) fail('P6_PERCEPTION_SOURCE_NOT_FOUND', 'Perception Source does not exist.');
        const record = createRecord({ ...input, committedAtMs: context.commitTimeMs });
        repository.invoke('insert_record', recordRow(record));
        for (const anchor of record.anchors) repository.invoke('insert_anchor', {
          perception_id: record.perceptionId, anchor_kind: anchor.anchorKind, anchor_value: anchor.anchorValue,
          confidence_class: anchor.confidenceClass, evidence_digest: anchor.evidenceDigest
        });
        return record;
      });
    },
    appendDedupRelation(input) {
      exactInput(input, ['relationId', 'leftPerceptionId', 'rightPerceptionId', 'ruleRevision', 'relation', 'evidenceDigest'], 'P6_PERCEPTION_RELATION_INPUT');
      return execute([recordDefinition], (context) => {
        const repository = context.repository(recordDefinition.repositoryId);
        const relation = createRelation({ ...input, committedAtMs: context.commitTimeMs });
        if (!repository.invoke('find_record', { perception_id: relation.leftPerceptionId }) ||
            !repository.invoke('find_record', { perception_id: relation.rightPerceptionId })) {
          fail('P6_PERCEPTION_RELATION_RECORD_MISSING', 'Perception relation requires two existing Records.');
        }
        if (repository.invoke('find_relation_pair', {
          left_perception_id: relation.leftPerceptionId, right_perception_id: relation.rightPerceptionId
        })) fail('P6_PERCEPTION_RELATION_PAIR_CONFLICT', 'Normalized Perception relation pair already exists.');
        repository.invoke('insert_relation', relationRow(relation));
        return relation;
      });
    },
    publishResolution(input, expectedRevision) {
      exactInput(input, ['resolutionId', 'queryContract', 'queryInputDigest', 'revision', 'resultKind', 'winningPerceptionId', 'resultDigest'], 'P6_PERCEPTION_RESOLUTION_INPUT');
      return execute([resolutionDefinition, recordDefinition], (context) => {
        const repository = context.repository(resolutionDefinition.repositoryId);
        const records = context.repository(recordDefinition.repositoryId);
        const resolution = createResolution({ ...input, resolvedAtMs: context.commitTimeMs });
        const head = repository.invoke('find_resolution_head', {
          query_contract: resolution.queryContract, query_input_digest: resolution.queryInputDigest
        });
        if (!head) {
          if (expectedRevision !== null || resolution.revision !== 1) fail('P6_PERCEPTION_RESOLUTION_INITIAL_REVISION', 'New Resolution head must start at revision 1 without expected revision.');
        } else if (expectedRevision !== head.current_revision || resolution.revision !== head.current_revision + 1) {
          fail('P6_PERCEPTION_RESOLUTION_REVISION_CONFLICT', 'Resolution revision is stale or skipped.');
        }
        if (resolution.resultKind === 'found' && !records.invoke('find_record', { perception_id: resolution.winningPerceptionId })) {
          fail('P6_PERCEPTION_RESOLUTION_WINNER_MISSING', 'Found Resolution winner does not exist.');
        }
        repository.invoke('insert_resolution', resolutionRow(resolution));
        if (!head) repository.invoke('insert_resolution_head', {
          query_contract: resolution.queryContract, query_input_digest: resolution.queryInputDigest,
          current_resolution_id: resolution.resolutionId, current_revision: resolution.revision, updated_at_ms: context.commitTimeMs
        });
        else {
          const advanced = repository.invoke('advance_resolution_head', {
            current_resolution_id: resolution.resolutionId, current_revision: resolution.revision, updated_at_ms: context.commitTimeMs,
            query_contract: resolution.queryContract, query_input_digest: resolution.queryInputDigest,
            expected_current_revision: expectedRevision
          });
          if (advanced.changes !== 1) fail('P6_PERCEPTION_RESOLUTION_REVISION_CONFLICT', 'Resolution head changed concurrently.');
        }
        return resolution;
      });
    },
    getSource(perceptionSourceId) {
      return execute([recordDefinition], (context) => mapSource(context.repository(recordDefinition.repositoryId).invoke('find_source', { perception_source_id: perceptionSourceId })));
    },
    getCurrentCursor(perceptionSourceId) {
      return execute([recordDefinition], (context) => {
        const repository = context.repository(recordDefinition.repositoryId);
        const source = repository.invoke('find_source', { perception_source_id: perceptionSourceId });
        if (!source || source.current_cursor_revision === null) return undefined;
        return mapCursor(repository.invoke('find_cursor', {
          perception_source_id: perceptionSourceId, revision: source.current_cursor_revision
        }));
      });
    },
    getRecord(perceptionId) {
      return execute([recordDefinition], (context) => mapRecord(context.repository(recordDefinition.repositoryId),
        context.repository(recordDefinition.repositoryId).invoke('find_record', { perception_id: perceptionId })));
    },
    findRecordBySourceIdentity(identity) {
      exactInput(identity, ['perceptionSourceId', 'sourceRecordKey', 'sourceRecordRevision', 'sourceRecordDigest'], 'P6_PERCEPTION_SOURCE_IDENTITY_INPUT');
      return execute([recordDefinition], (context) => {
        const repository = context.repository(recordDefinition.repositoryId);
        return mapRecord(repository, repository.invoke('find_record_by_source_identity', {
          perception_source_id: identity.perceptionSourceId, source_record_key: identity.sourceRecordKey,
          source_record_revision: identity.sourceRecordRevision, source_record_digest: identity.sourceRecordDigest
        }));
      });
    },
    findRecordsByAnchor(anchorKind, anchorValue) {
      return execute([recordDefinition], (context) => {
        const repository = context.repository(recordDefinition.repositoryId);
        const matches = repository.invoke('find_anchor_matches', { anchor_kind: anchorKind, anchor_value: anchorValue });
        return Object.freeze(matches.map((match) => mapRecord(repository,
          repository.invoke('find_record', { perception_id: match.perception_id }))));
      });
    },
    getCurrentResolution(queryContract, queryInputDigest) {
      return execute([resolutionDefinition], (context) => {
        const repository = context.repository(resolutionDefinition.repositoryId);
        const head = repository.invoke('find_resolution_head', { query_contract: queryContract, query_input_digest: queryInputDigest });
        if (!head) return undefined;
        const resolution = mapResolution(repository.invoke('find_resolution', { resolution_id: head.current_resolution_id }));
        if (!resolution || resolution.queryContract !== queryContract || resolution.queryInputDigest !== queryInputDigest ||
            resolution.revision !== head.current_revision) fail('P6_PERCEPTION_RESOLUTION_HEAD_CORRUPT', 'Resolution head does not point to its exact immutable revision.');
        return resolution;
      });
    }
  });
}

function mapSource(row) { return row && createSource({
  perceptionSourceId: row.perception_source_id, sourceKind: row.source_kind, integrationId: row.integration_id, status: row.status,
  configRevision: row.config_revision, currentCursorRevision: row.current_cursor_revision,
  createdAtMs: row.created_at_ms, updatedAtMs: row.updated_at_ms
}); }
function mapCursor(row) { return row && createCursor({
  perceptionSourceId: row.perception_source_id, revision: row.revision, cursorValue: row.cursor_value,
  observationDigest: row.observation_digest, committedAtMs: row.committed_at_ms
}); }
function mapRecord(repository, row) { return row && createRecord({
  perceptionId: row.perception_id, perceptionSourceId: row.perception_source_id, sourceKind: row.source_kind,
  sourceRecordKey: row.source_record_key, sourceRecordRevision: row.source_record_revision, sourceRecordDigest: row.source_record_digest,
  rating: row.rating, watchedState: row.watched_state, observedTitle: row.observed_title, provenanceDigest: row.provenance_digest,
  observedAtMs: row.observed_at_ms, committedAtMs: row.committed_at_ms,
  anchors: repository.invoke('find_anchors', { perception_id: row.perception_id }).map((anchor) => ({
    anchorKind: anchor.anchor_kind, anchorValue: anchor.anchor_value, confidenceClass: anchor.confidence_class,
    evidenceDigest: anchor.evidence_digest
  }))
}); }
function mapResolution(row) { return row && createResolution({
  resolutionId: row.resolution_id, queryContract: row.query_contract, queryInputDigest: row.query_input_digest,
  revision: row.revision, resultKind: row.result_kind, winningPerceptionId: row.winning_perception_id,
  resultDigest: row.result_digest, resolvedAtMs: row.resolved_at_ms
}); }
function cursorRow(item) { return { perception_source_id: item.perceptionSourceId, revision: item.revision,
  cursor_value: item.cursorValue, observation_digest: item.observationDigest, committed_at_ms: item.committedAtMs }; }
function recordRow(item) { return { perception_id: item.perceptionId, perception_source_id: item.perceptionSourceId,
  source_kind: item.sourceKind, source_record_key: item.sourceRecordKey, source_record_revision: item.sourceRecordRevision,
  source_record_digest: item.sourceRecordDigest, rating: item.rating, watched_state: item.watchedState,
  observed_title: item.observedTitle, provenance_digest: item.provenanceDigest, observed_at_ms: item.observedAtMs,
  committed_at_ms: item.committedAtMs }; }
function relationRow(item) { return { relation_id: item.relationId, left_perception_id: item.leftPerceptionId,
  right_perception_id: item.rightPerceptionId, rule_revision: item.ruleRevision, relation: item.relation,
  evidence_digest: item.evidenceDigest, committed_at_ms: item.committedAtMs }; }
function resolutionRow(item) { return { resolution_id: item.resolutionId, query_contract: item.queryContract,
  query_input_digest: item.queryInputDigest, revision: item.revision, result_kind: item.resultKind,
  winning_perception_id: item.winningPerceptionId, result_digest: item.resultDigest, resolved_at_ms: item.resolvedAtMs }; }

module.exports = Object.freeze({ PerceptionStoreError, createPerceptionStore });
