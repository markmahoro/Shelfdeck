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
  assert.equal(registry.targetCount, 29);
  for (const [name, schema] of Object.entries(schemas)) {
    const stored = JSON.parse(fs.readFileSync(path.join(root, 'application-types', name, 'v1/schema.json'), 'utf8'));
    assert.deepEqual(stored, schema);
    const entry = registry.entries.find((item) => item.id === name);
    assert.equal(entry.schemaId, typeId(name));
    assert.equal(entry.digest.value, schemaDigest(schema));
  }
});

test('Product Fact commit Plan freezes bounded typed refs instead of full Fact payloads', () => {
  const binding = buildLibraApplicationSchemas()
    .LibraProductFactCommitPlanBinding;
  assert.equal(binding['x-helix-maxCanonicalBytes'], 16 * 1024);
  assert.equal(binding.properties.bindingKind.const, 'product_fact_commit');
  assert.equal(binding.properties.sourceResultRefs.maxItems, 32);
  assert.equal(binding.properties.artifactRefs.maxItems, 16);
  assert.equal(Object.hasOwn(binding.properties, 'sourceBasis'), false);
  assert.equal(Object.hasOwn(binding.properties, 'resolvedProductIdentity'), false);
  assert.equal(Object.hasOwn(binding.properties, 'productMetadataDraft'), false);
  assert.equal(Object.hasOwn(binding.properties, 'verifiedArtifactManifest'), false);
});

test('Workspace Admission schemas freeze the pathless Platform evidence and initial state', () => {
  const schemas = buildLibraApplicationSchemas();
  assert.equal(schemas.LibraWorkspaceAdmissionDecision.properties.platformWorkspaceRootSnapshot.$ref,
    typeId('PlatformWorkspaceRootSnapshot'));
  assert.equal(schemas.LibraWorkspaceAdmissionDecision.properties.spaceAdmissionEvidence.$ref,
    typeId('WorkspaceSpaceAdmissionEvidence'));
  assert.equal(schemas.LibraWorkspaceAdmissionResult.properties.workspaceRevision.const, 1);
  assert.equal(schemas.LibraWorkspaceAdmissionResult.properties.workspaceState.const, 'active');
  assert.deepEqual(schemas.WorkspaceProductVerificationSnapshot.oneOf.map((branch) =>
    [branch.properties.verificationKind.const, branch.properties.verificationValue.$ref]), [
    ['media', 'helix://contracts/types/ProductMediaVerification/v1'],
    ['artifact', 'helix://contracts/types/ArtifactManifestVerification/v1'],
    ['structural', 'helix://contracts/types/ManifestVerification/v1']
  ]);
  assert.equal(schemas.WorkspaceProductVerificationSnapshot.oneOf[1].properties.artifactHandle.$ref,
    'helix://contracts/types/ArtifactHandle/v1');
  assert.equal(schemas.WorkspaceProductVerificationSnapshot.oneOf[2].properties.manifestContract.$ref,
    'helix://contracts/domain-types/ManifestContract/v1');
  assert.equal(schemas.LibraWorkspaceMaterialReferenceDecision.properties.workspaceMaterialHandle.$ref,
    'helix://contracts/types/WorkspaceMaterialHandle/v1');
  assert.equal(schemas.LibraWorkspaceMaterialReferenceResult.properties.referenceSnapshot.$ref,
    'helix://contracts/application-types/WorkspaceMaterialReferenceSnapshot/v1');
  assert.equal(schemas.LibraWorkspaceEpisodeClaims.type, 'array');
  assert.equal(schemas.LibraWorkspaceEpisodeClaims.maxItems, 32);
  assert.deepEqual(Object.keys(schemas.LibraWorkspaceEpisodeClaims.items.properties),
    ['episodeKey', 'seasonClaimDigest', 'claimDigest']);
});

test('Run Lifecycle schemas freeze typed evidence and the bounded recovery policy', () => {
  const schemas = buildLibraApplicationSchemas();
  assert.deepEqual(schemas.LibraRunRecoveryPolicySnapshot.properties.assessmentOffsetsMs.prefixItems.map((item) => item.const),
    [60000, 300000, 900000, 1800000, 3600000]);
  assert.equal(schemas.LibraRunRecoveryPolicySnapshot.properties.maxRecoveryAssessments.const, 5);
  assert.equal(schemas.LibraRunFreshnessAssessment.properties.dimensionResults.minItems, 5);
  assert.equal(schemas.LibraRunFreshnessAssessment.properties.dimensionResults.maxItems, 5);
  assert.deepEqual(schemas.LibraRunLifecycleDecision.properties.transitionKind.enum,
    ['suspend', 'resume', 'freeze', 'freshness_confirmed', 'recovery_reassessed', 'set_priority', 'complete']);
  assert.deepEqual(schemas.LibraRunLifecycleDecision.properties.transitionEvidence.oneOf.slice(0, 3).map((item) => item.$ref),
    [typeId('LibraRunFreshnessAssessment'), typeId('LibraRunTerminalDeliveryEvidence'), typeId('LibraRunPriorityIntent')]);
  assert.equal(schemas.LibraRunTerminalDeliveryEvidence.properties.blockedWorks.maxItems, 256);
});

test('Run Admission schemas close immutable scope, head zero, and Result continuity', () => {
  const schemas = buildLibraApplicationSchemas();
  assert.deepEqual(schemas.ProductionMaterialManifest.oneOf.map((branch) => branch.properties.manifestRole.const),
    ['run_input', 'product_delivery']);
  assert.equal(schemas.ProductionMaterialManifest.oneOf[0].properties.members.minItems, 1);
  assert.equal(schemas.ProductionMaterialManifest.oneOf[0].properties.members.maxItems, 1024);
  assert.ok(schemas.ProductionMaterialManifest.oneOf[1].properties.members.items.required.includes('committedControlRevision'));
  for (const branch of schemas.ProductionMaterialManifest.oneOf) {
    const member = branch.properties.members.items;
    assert.equal(member.allOf[0].if.properties.role.not.const, 'primary_payload');
    assert.equal(member.allOf[0].then.properties.episodeClaims.maxItems, 0);
  }
  assert.equal(schemas.ProductionMaterialOutputRequirement.properties.outputRequirementDigest.pattern, '^[a-f0-9]{64}$');
  assert.equal(schemas.LibraRunAdmissionDecision.properties.expectedRunAdmissionHead.properties.headRevision.minimum, 0);
  assert.equal(schemas.LibraRunAdmissionDecision.properties.runExecutionBasis.$ref, typeId('LibraRunExecutionBasis'));
  assert.equal(schemas.LibraRunAdmissionResult.properties.stateRevision.const, 1);
  assert.equal(schemas.LibraRunExecutionBasisRecord.properties.productionMaterialManifestRef.properties.memberCount.minimum, 1);
  assert.ok(schemas.LibraRunExecutionBasisRecord.properties.productionMaterialManifestRef.required.includes('memberSetDigest'));
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
