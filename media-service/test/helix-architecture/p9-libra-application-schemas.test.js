'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  buildLibraApplicationSchemas, schemaDigest, typeId
} = require('../../scripts/helix-architecture/libra-application-schema-builder');

const root = path.resolve(__dirname, '../../src/helix/contracts');

test('materializes the SSOT-exact Libra production application contracts reproducibly', () => {
  const schemas = buildLibraApplicationSchemas();
  const registry = JSON.parse(fs.readFileSync(path.join(root, 'libra-application-type-registry.json'), 'utf8'));
  assert.equal(registry.targetCount, 14);
  for (const [name, schema] of Object.entries(schemas)) {
    const stored = JSON.parse(fs.readFileSync(path.join(root, 'application-types', name, 'v1/schema.json'), 'utf8'));
    assert.deepEqual(stored, schema);
    const entry = registry.entries.find((item) => item.id === name);
    assert.equal(entry.schemaId, typeId(name));
    assert.equal(entry.digest.value, schemaDigest(schema));
  }
});

test('Run Admission schemas close immutable scope, head zero, and Result continuity', () => {
  const schemas = buildLibraApplicationSchemas();
  assert.equal(schemas.ProductionMaterialManifest.properties.members.minItems, 1);
  assert.equal(schemas.ProductionMaterialManifest.properties.members.maxItems, 1024);
  assert.equal(schemas.ProductionMaterialOutputRequirement.properties.outputRequirementDigest.pattern, '^[a-f0-9]{64}$');
  assert.equal(schemas.LibraRunAdmissionDecision.properties.expectedRunAdmissionHead.properties.headRevision.minimum, 0);
  assert.equal(schemas.LibraRunAdmissionDecision.properties.runExecutionBasis.$ref, typeId('LibraRunExecutionBasis'));
  assert.equal(schemas.LibraRunAdmissionResult.properties.stateRevision.const, 1);
  assert.equal(schemas.LibraRunExecutionBasisRecord.properties.productionMaterialManifestRef.properties.memberCount.minimum, 1);
});

test('Workspace Reclamation query closes selector identity and excludes cleanup authority', () => {
  const schemas = buildLibraApplicationSchemas();
  const query = schemas.WorkspaceCleanupScopeQuery;
  assert.equal(query.properties.queryContract.const, 'libra.workspace-reclamation.scope@1');
  assert.deepEqual(query.properties.readSelector.properties.kind.enum, ['current', 'revision']);
  assert.equal(query.properties.expectedCurrent.required.length, 2);
  for (const forbidden of ['libraRunId', 'workspaceId', 'workspacePath', 'materialId', 'fromMs', 'deleteNow']) {
    assert.equal(query.properties[forbidden], undefined);
  }
  assert.equal(schemas.WorkspaceCleanupScopeProjection.properties.memberCount.maximum, 1024);
  assert.deepEqual(schemas.WorkspaceCleanupScopeProjection.properties.triggerKind.enum,
    ['offload_completed', 'run_superseded', 'run_discarded']);
});

test('Workspace Reclamation result unions are closed and typed', () => {
  const schemas = buildLibraApplicationSchemas();
  assert.deepEqual(schemas.WorkspaceCleanupScopeReadResult.oneOf.map((variant) =>
    variant.properties.resultKind.const), ['found', 'not_found', 'stale', 'integrity_error']);
  assert.equal(schemas.WorkspaceCleanupScopeReadResult.oneOf[0].properties.projection.$ref,
    typeId('WorkspaceCleanupScopeProjection'));
  assert.deepEqual(schemas.LibraRunDiscardCommandResult.oneOf.map((variant) =>
    variant.properties.resultKind.const),
  ['discarded', 'not_found', 'stale', 'invalid_state', 'conflict', 'integrity_error']);
  assert.equal(schemas.LibraRunDiscardCommandResult.oneOf[0].properties.discardReceipt.$ref,
    typeId('LibraRunDiscardReceipt'));
});

test('Run Discard command and receipt preserve the canonical transaction boundary', () => {
  const schemas = buildLibraApplicationSchemas();
  const command = schemas.LibraRunDiscardCommand;
  assert.equal(command.properties.commandContract.const, 'libra.run-discard@1');
  assert.deepEqual(command.required.sort(), [
    'actorId', 'commandContract', 'commandDigest', 'commandId', 'expectedRunStateDigest',
    'expectedRunStateRevision', 'idempotencyKey', 'libraRunId'
  ].sort());
  for (const forbidden of ['materialId', 'workspacePath', 'controlMembers', 'cleanupMembers', 'deleteNow']) {
    assert.equal(command.properties[forbidden], undefined);
  }
  const receipt = schemas.LibraRunDiscardReceipt;
  assert.equal(receipt.properties.receiptKind.const, 'libra_run_discarded');
  assert.equal(receipt.properties.ownerDomain.const, 'libra');
  assert.equal(receipt.properties.scopeType.const, 'libra_run');
  assert.equal(receipt.properties.cleanupScopeId.anyOf[1].type, 'null');
});

test('Product Delivery query and read variants close history and acceptance fencing', () => {
  const schemas = buildLibraApplicationSchemas();
  assert.deepEqual(schemas.ProductDeliveryQuery.properties.readPurpose.enum, ['historical', 'acceptance_fence']);
  assert.equal(schemas.ProductDeliveryQuery.properties.queryContract.const, 'libra.product-delivery@1');
  const [found, notFound] = schemas.ProductDeliveryReadResult.oneOf;
  assert.equal(found.properties.onDeckProductPackage.$ref, 'helix://contracts/types/OnDeckProductPackage/v1');
  assert.equal(found.properties.deliveryFence.oneOf[1].type, 'null');
  assert.equal(notFound.properties.reasonCode.const, 'package_missing');
});
