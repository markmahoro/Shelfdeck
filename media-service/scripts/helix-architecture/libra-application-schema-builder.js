'use strict';

const crypto = require('crypto');

const DRAFT = 'https://json-schema.org/draft/2020-12/schema';
const typeId = (name) => `helix://contracts/application-types/${name}/v1`;
const text = (options = {}) => ({ type: 'string', minLength: 1, ...options });
const id = () => text({ maxLength: 256 });
const digest = () => text({ pattern: '^[a-f0-9]{64}$' });
const positive = () => ({ type: 'integer', minimum: 1 });
const nonNegative = () => ({ type: 'integer', minimum: 0 });
const nullable = (schema) => ({ anyOf: [schema, { type: 'null' }] });
const object = (properties, required = Object.keys(properties), options = {}) => ({
  type: 'object', additionalProperties: false, properties, required, ...options
});

function productDeliveryQuery() {
  return {
    $schema: DRAFT,
    $id: typeId('ProductDeliveryQuery'),
    title: 'ProductDeliveryQuery@1',
    'x-helix-ssotRefs': ['8.2.2', '8.6.21'],
    'x-helix-maxCanonicalBytes': 4 * 1024,
    ...object({
      queryContract: { const: 'libra.product-delivery@1' },
      readPurpose: { type: 'string', enum: ['historical', 'acceptance_fence'] },
      offerId: id(),
      onDeckPackageId: id(),
      expectedPackageRevision: positive(),
      expectedPackageDigest: digest()
    })
  };
}

function deliveryFence() {
  return object({
    eligibility: { type: 'string', enum: ['eligible', 'ineligible'] },
    reasonCode: { type: 'string', enum: [
      'run_not_active', 'spec_not_current', 'package_not_current', 'delivery_already_terminal', 'control_not_libra'
    ] },
    libraRunId: id(),
    runState: { type: 'string', enum: ['active', 'suspended', 'superseded', 'frozen', 'completed', 'discarded'] },
    runStateRevision: positive(),
    runStateDigest: digest(),
    acceptanceSpecId: id(),
    packageRevisionHead: nonNegative(),
    deliveryReceiptAbsent: { type: 'boolean' },
    productControlSetDigest: digest(),
    fenceDigest: digest()
  }, [
    'eligibility', 'libraRunId', 'runState', 'runStateRevision', 'runStateDigest', 'acceptanceSpecId',
    'packageRevisionHead', 'deliveryReceiptAbsent', 'fenceDigest'
  ], {
    allOf: [{
      if: { properties: { eligibility: { const: 'eligible' } } },
      then: {
        properties: { runState: { const: 'active' }, deliveryReceiptAbsent: { const: true } },
        not: { required: ['reasonCode'] }
      },
      else: { required: ['reasonCode'] }
    }]
  });
}

function productDeliveryReadResult() {
  const found = object({
    resultKind: { const: 'found' },
    onDeckProductPackage: { $ref: 'helix://contracts/types/OnDeckProductPackage/v1' },
    deliveryFence: { oneOf: [deliveryFence(), { type: 'null' }] },
    readDigest: digest()
  });
  const notFound = object({
    resultKind: { const: 'not_found' },
    reasonCode: { const: 'package_missing' },
    checkedAtMs: nonNegative()
  });
  return {
    $schema: DRAFT,
    $id: typeId('ProductDeliveryReadResult'),
    title: 'ProductDeliveryReadResult@1',
    'x-helix-ssotRefs': ['8.2.2', '8.6.21'],
    'x-helix-maxCanonicalBytes': 16 * 1024 * 1024,
    oneOf: [found, notFound]
  };
}

function workspaceCleanupScopeQuery() {
  const readSelector = object({
    kind: { type: 'string', enum: ['current', 'revision'] },
    revision: positive()
  }, ['kind'], {
    allOf: [{
      if: { properties: { kind: { const: 'revision' } } },
      then: { required: ['revision'] },
      else: { not: { required: ['revision'] } }
    }]
  });
  return {
    $schema: DRAFT,
    $id: typeId('WorkspaceCleanupScopeQuery'),
    title: 'WorkspaceCleanupScopeQuery@1',
    'x-helix-ssotRefs': ['8.1.4', '8.6.21'],
    'x-helix-maxCanonicalBytes': 4 * 1024,
    ...object({
      queryContract: { const: 'libra.workspace-reclamation.scope@1' },
      cleanupScopeId: id(),
      readSelector,
      expectedCurrent: object({ stateRevision: positive(), stateDigest: digest() }),
      queryId: digest(),
      queryDigest: digest()
    }, ['queryContract', 'cleanupScopeId', 'readSelector', 'queryId', 'queryDigest'], {
      allOf: [{
        if: { properties: { readSelector: { properties: { kind: { const: 'revision' } }, required: ['kind'] } } },
        then: { not: { required: ['expectedCurrent'] } }
      }]
    })
  };
}

function workspaceCleanupScopeProjection() {
  return {
    $schema: DRAFT,
    $id: typeId('WorkspaceCleanupScopeProjection'),
    title: 'WorkspaceCleanupScopeProjection@1',
    'x-helix-ssotRefs': ['8.6.21'],
    'x-helix-maxCanonicalBytes': 8 * 1024,
    ...object({
      cleanupScopeId: id(),
      libraRunId: id(),
      triggerKind: { type: 'string', enum: ['offload_completed', 'run_superseded', 'run_discarded'] },
      state: { type: 'string', enum: ['active', 'completed', 'blocked'] },
      stateRevision: positive(),
      stateDigest: digest(),
      memberCount: { type: 'integer', minimum: 0, maximum: 1024 },
      pendingCount: { type: 'integer', minimum: 0, maximum: 1024 },
      completedCount: { type: 'integer', minimum: 0, maximum: 1024 },
      blockedCount: { type: 'integer', minimum: 0, maximum: 1024 },
      memberSetDigest: digest(),
      terminalMemberStateSetDigest: digest(),
      createdAtMs: nonNegative(),
      completedAtMs: nullable(nonNegative()),
      projectionDigest: digest()
    }, [
      'cleanupScopeId', 'libraRunId', 'triggerKind', 'state', 'stateRevision', 'stateDigest',
      'memberCount', 'pendingCount', 'completedCount', 'blockedCount', 'memberSetDigest',
      'terminalMemberStateSetDigest', 'createdAtMs', 'projectionDigest'
    ], {
      allOf: [{
        if: { properties: { state: { const: 'completed' } } },
        then: { required: ['completedAtMs'], properties: { completedAtMs: nonNegative() } },
        else: { properties: { completedAtMs: { type: 'null' } } }
      }]
    })
  };
}

function workspaceCleanupScopeReadResult() {
  const common = { queryId: digest(), queryDigest: digest() };
  const resultDigest = { resultDigest: digest() };
  return {
    $schema: DRAFT,
    $id: typeId('WorkspaceCleanupScopeReadResult'),
    title: 'WorkspaceCleanupScopeReadResult@1',
    'x-helix-ssotRefs': ['8.6.21'],
    'x-helix-maxCanonicalBytes': 16 * 1024,
    oneOf: [
      object({ resultKind: { const: 'found' }, ...common,
        projection: { $ref: typeId('WorkspaceCleanupScopeProjection') }, ...resultDigest }),
      object({ resultKind: { const: 'not_found' }, ...common,
        reasonCode: { type: 'string', enum: ['scope_missing', 'revision_missing'] }, ...resultDigest }),
      object({ resultKind: { const: 'stale' }, ...common,
        expectedStateRevision: positive(), expectedStateDigest: digest(),
        actualStateRevision: positive(), actualStateDigest: digest(), ...resultDigest }),
      object({ resultKind: { const: 'integrity_error' }, ...common,
        reasonCode: { type: 'string', enum: [
          'owner_rows_incomplete', 'revision_chain_broken', 'digest_mismatch',
          'discard_receipt_continuity_broken'
        ] }, ...resultDigest })
    ]
  };
}

function libraRunDiscardReceipt() {
  return {
    $schema: DRAFT,
    $id: typeId('LibraRunDiscardReceipt'),
    title: 'LibraRunDiscardReceipt@1',
    'x-helix-ssotRefs': ['8.6.21'],
    'x-helix-envelopeRef': 'helix://contracts/types/ReceiptEnvelope/v1',
    'x-helix-maxCanonicalBytes': 8 * 1024,
    ...object({
      schemaRef: { const: typeId('LibraRunDiscardReceipt') },
      schemaVersion: { const: 1 },
      receiptId: id(),
      receiptKind: { const: 'libra_run_discarded' },
      ownerDomain: { const: 'libra' },
      scopeType: { const: 'libra_run' },
      scopeId: id(),
      scopeDigest: digest(),
      effectReceiptRef: nullable(id()),
      committedAtMs: nonNegative(),
      discardDecisionId: digest(),
      libraRunId: id(),
      committedRunStateRevision: positive(),
      releasedInputControlSetDigest: digest(),
      cleanupScopeId: nullable(id()),
      cleanupMemberSetDigest: digest(),
      commitDigest: digest()
    }, [
      'schemaRef', 'schemaVersion', 'receiptId', 'receiptKind', 'ownerDomain', 'scopeType', 'scopeId',
      'scopeDigest', 'committedAtMs', 'discardDecisionId', 'libraRunId', 'committedRunStateRevision',
      'releasedInputControlSetDigest', 'cleanupMemberSetDigest', 'commitDigest'
    ])
  };
}

function libraRunDiscardCommand() {
  return {
    $schema: DRAFT,
    $id: typeId('LibraRunDiscardCommand'),
    title: 'LibraRunDiscardCommand@1',
    'x-helix-ssotRefs': ['8.1.4', '8.6.21'],
    'x-helix-maxCanonicalBytes': 4 * 1024,
    ...object({
      commandContract: { const: 'libra.run-discard@1' },
      commandId: digest(),
      libraRunId: id(),
      expectedRunStateRevision: positive(),
      expectedRunStateDigest: digest(),
      actorId: id(),
      idempotencyKey: id(),
      commandDigest: digest()
    })
  };
}

function libraRunDiscardCommandResult() {
  const common = { commandId: digest(), commandDigest: digest(), libraRunId: id() };
  const resultDigest = { resultDigest: digest() };
  return {
    $schema: DRAFT,
    $id: typeId('LibraRunDiscardCommandResult'),
    title: 'LibraRunDiscardCommandResult@1',
    'x-helix-ssotRefs': ['8.6.21'],
    'x-helix-maxCanonicalBytes': 16 * 1024,
    oneOf: [
      object({ resultKind: { const: 'discarded' }, ...common,
        discardReceipt: { $ref: typeId('LibraRunDiscardReceipt') },
        cleanupMemberCount: { type: 'integer', minimum: 0, maximum: 1024 }, ...resultDigest }),
      object({ resultKind: { const: 'not_found' }, ...common,
        reasonCode: { const: 'run_missing' }, ...resultDigest }),
      object({ resultKind: { const: 'stale' }, ...common,
        expectedRunStateRevision: positive(), expectedRunStateDigest: digest(),
        actualRunStateRevision: positive(), actualRunStateDigest: digest(), ...resultDigest }),
      object({ resultKind: { const: 'invalid_state' }, ...common,
        reasonCode: { const: 'run_not_frozen' }, actualRunStateRevision: positive(),
        actualRunStateDigest: digest(), ...resultDigest }),
      object({ resultKind: { const: 'conflict' }, ...common,
        reasonCode: { const: 'idempotency_key_reused' }, existingCommandDigest: digest(), ...resultDigest }),
      object({ resultKind: { const: 'integrity_error' }, ...common,
        reasonCode: { type: 'string', enum: [
          'run_history_incomplete', 'material_manifest_incomplete', 'workspace_reference_incomplete',
          'control_fence_mismatch', 'discard_receipt_mismatch'
        ] }, ...resultDigest })
    ]
  };
}

function buildLibraApplicationSchemas() {
  return Object.freeze({
    ProductDeliveryQuery: productDeliveryQuery(),
    ProductDeliveryReadResult: productDeliveryReadResult(),
    WorkspaceCleanupScopeQuery: workspaceCleanupScopeQuery(),
    WorkspaceCleanupScopeProjection: workspaceCleanupScopeProjection(),
    WorkspaceCleanupScopeReadResult: workspaceCleanupScopeReadResult(),
    LibraRunDiscardReceipt: libraRunDiscardReceipt(),
    LibraRunDiscardCommand: libraRunDiscardCommand(),
    LibraRunDiscardCommandResult: libraRunDiscardCommandResult()
  });
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = canonicalize(value[key]);
      return result;
    }, {});
  }
  return value;
}

function schemaDigest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

module.exports = Object.freeze({ buildLibraApplicationSchemas, schemaDigest, typeId });
