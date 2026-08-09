'use strict';

const crypto = require('crypto');

const DRAFT = 'https://json-schema.org/draft/2020-12/schema';
const typeVersion = (name) => name === 'PhysicalMaterialIdentity' ? 2 : 1;
const typeId = (name) => `helix://contracts/types/${name}/v${typeVersion(name)}`;
const ref = (name) => ({ $ref: typeId(name) });
const domainRef = (name) => ({ $ref: `helix://contracts/domain-types/${name}/v1` });
const applicationRef = (name) => ({ $ref: `helix://contracts/application-types/${name}/v1` });
const text = (options = {}) => ({ type: 'string', minLength: 1, ...options });
const opaqueId = () => text({ maxLength: 256 });
const nonNegativeInteger = () => ({ type: 'integer', minimum: 0 });
const positiveInteger = () => ({ type: 'integer', minimum: 1 });
const boundedPositiveInteger = (maximum) => ({ type: 'integer', minimum: 1, maximum });
const digestAlgorithm = () => ({ const: 'sha256' });
const digestHex = () => text({ pattern: '^[a-f0-9]{64}$' });
const enumText = (...values) => ({ type: 'string', enum: values });
const arrayOf = (items, maxItems = 1024) => ({ type: 'array', items, maxItems });
const nullable = (schema) => ({ anyOf: [schema, { type: 'null' }] });

function object(properties, required = Object.keys(properties), options = {}) {
  return {
    type: 'object',
    additionalProperties: false,
    properties,
    required,
    ...options
  };
}

function contractMap(description) {
  return {
    type: 'object',
    propertyNames: { pattern: '^[A-Za-z][A-Za-z0-9_.-]{0,127}$' },
    patternProperties: {
      '^[A-Za-z][A-Za-z0-9_.-]{0,127}$': { 'x-helix-requires-bound-schema': true }
    },
    additionalProperties: false,
    description
  };
}

function nominal(name, properties, required = Object.keys(properties), options = {}) {
  const { ssotRefs = ['8.6.18'], ...schemaOptions } = options;
  const common = {
    schemaRef: { const: typeId(name) },
    schemaVersion: { const: typeVersion(name) }
  };
  return {
    $schema: DRAFT,
    $id: typeId(name),
    title: `${name}@${typeVersion(name)}`,
    'x-helix-ssotRefs': ssotRefs,
    ...object({ ...common, ...properties }, ['schemaRef', 'schemaVersion', ...required], schemaOptions)
  };
}

function plainSchema(name, properties, required = Object.keys(properties), options = {}) {
  const { ssotRefs = ['8.6.18'], ...schemaOptions } = options;
  return {
    $schema: DRAFT,
    $id: typeId(name),
    title: `${name}@1`,
    'x-helix-ssotRefs': ssotRefs,
    ...object(properties, required, schemaOptions)
  };
}

const ownerScope = () => object({ scopeType: text(), scopeId: opaqueId() });
const objectRef = () => object({ objectType: text(), objectId: opaqueId(), revision: positiveInteger(), digest: digestHex() });
const basisRef = () => object({ basisType: text(), basisId: opaqueId(), revision: positiveInteger(), digest: digestHex() });

function externalOutputSnapshotSchema() {
  const episodeClaim = object({ episodeKey: text(), claimDigest: digestHex() });
  const member = object({ ordinal: nonNegativeInteger(), externalMemberId: opaqueId(), relativePath: text(),
    sizeBytes: nonNegativeInteger(), checksumAlgorithm: { const: 'sha256' }, checksumHex: digestHex(),
    episodeClaims: arrayOf(episodeClaim, 32), memberDigest: digestHex() });
  return object({ integrationId: opaqueId(), configRevision: positiveInteger(), externalObjectRef: opaqueId(), endpointId: opaqueId(),
    location: text(), structureKind: enumText('single', 'season'), members: { ...arrayOf(member, 256), minItems: 1 },
    identityAnchors: arrayOf(domainRef('ResolvedProviderIdentity'), 16), observedTitle: text(), releaseYear: positiveInteger(),
    observedAtMs: nonNegativeInteger(), newestMutationAtMs: nonNegativeInteger(), memberSetDigest: digestHex(),
    manifestDigest: digestHex(), snapshotDigest: digestHex()
  }, ['integrationId', 'configRevision', 'externalObjectRef', 'endpointId', 'location', 'structureKind', 'members',
    'identityAnchors', 'observedAtMs', 'newestMutationAtMs', 'memberSetDigest', 'manifestDigest', 'snapshotDigest']);
}

function providerAcquisitionCandidateSnapshotSchema() {
  return object({ candidateId: digestHex(), integrationId: opaqueId(), configRevision: positiveInteger(),
    providerCandidateRef: object({ objectType: { const: 'acquisition_candidate' }, objectId: opaqueId(),
      revision: positiveInteger(), digest: digestHex() }), providerRank: { type: 'integer', minimum: 0, maximum: 99 },
    identityAnchors: arrayOf(domainRef('ResolvedProviderIdentity'), 16), structureKind: enumText('single', 'season'),
    episodeKeys: arrayOf(text(), 256), availability: enumText('available', 'unavailable'), candidateDigest: digestHex()
  });
}

const definitions = {
  PhysicalMaterialIdentity: () => nominal('PhysicalMaterialIdentity', {
    materialKey: digestHex(), mountScopeId: opaqueId(), inode: text({ pattern: '^(0|[1-9][0-9]*)$' }),
    sizeBytes: nonNegativeInteger(), fingerprintAlgorithm: { const: 'middle-256k-sha256' },
    fingerprintVersion: { const: 1 }, contentFingerprint: digestHex()
  }),
  PhysicalMaterialReadHandle: () => nominal('PhysicalMaterialReadHandle', {
    handleId: opaqueId(), identity: ref('PhysicalMaterialIdentity'), ownerDomain: text(), ownerScope: ownerScope(),
    bindingRevision: positiveInteger(), endpointId: opaqueId(), location: text(), mountScopeRevision: positiveInteger(),
    expectedSizeBytes: nonNegativeInteger(), expectedMtimeNs: nonNegativeInteger(), expectedCtimeNs: nonNegativeInteger(),
    fingerprintVerifiedAtMs: nonNegativeInteger(), readScope: text(), expiresAtMs: nonNegativeInteger(), fenceDigest: digestHex()
  }),
  WorkspaceMaterialHandle: () => nominal('WorkspaceMaterialHandle', {
    handleId: opaqueId(), workspaceId: opaqueId(), ownerDomain: text(), processId: opaqueId(), endpointId: opaqueId(),
    materialKey: digestHex(), physicalIdentity: object({ mountScopeId: opaqueId(),
      inode: text({ pattern: '^(0|[1-9][0-9]*)$' }), sizeBytes: nonNegativeInteger(),
      fingerprintAlgorithm: { const: 'middle-256k-sha256' }, fingerprintVersion: { const: 1 }, contentFingerprint: digestHex() }),
    rootHandleRef: opaqueId(), relativePath: text(),
    digestAlgorithm: digestAlgorithm(), digestHex: digestHex(), sizeBytes: nonNegativeInteger(), referenceRevision: positiveInteger(),
    accessScope: { const: 'workspace_material_read' }, fenceDigest: digestHex()
  }),
  ArtifactHandle: () => nominal('ArtifactHandle', {
    artifactHandleId: opaqueId(), artifactKind: text(), ownerDomain: text(), ownerScope: ownerScope(), storageRef: text(),
    digestAlgorithm: digestAlgorithm(), digestHex: digestHex(), sizeBytes: nonNegativeInteger(), mediaType: text(),
    provenanceRef: objectRef(), referenceRevision: positiveInteger()
  }),
  FieldAccessHandle: () => nominal('FieldAccessHandle', {
    handleId: opaqueId(), fieldId: opaqueId(), accessRevision: positiveInteger(), accessDigest: digestHex(), endpointId: opaqueId(), rootLocation: text(),
    mountScopeId: opaqueId(), mountScopeRevision: positiveInteger(),
    allowedOperations: arrayOf(enumText('read', 'list', 'stat', 'fingerprint'), 4), containmentDigest: digestHex(), expiresAtMs: nonNegativeInteger()
  }),
  FieldObservationPageRequest: () => nominal('FieldObservationPageRequest', {
    fieldObservationWorkId: opaqueId(), observationId: opaqueId(), pageOrdinal: nonNegativeInteger(),
    expectedObservationRevision: nonNegativeInteger(), cursorIn: nullable(text()), pageBudget: boundedPositiveInteger(100),
    profileHintSnapshot: applicationRef('MaterialFieldProfileHintSnapshot'), requestDigest: digestHex()
  }),
  IntegrationHandle: () => nominal('IntegrationHandle', {
    handleId: opaqueId(), integrationId: opaqueId(), integrationType: text(), configRevision: positiveInteger(), secretRef: opaqueId(),
    allowedOperation: text(), expiresAtMs: nonNegativeInteger(), fenceDigest: digestHex()
  }),
  WorkerHandle: () => nominal('WorkerHandle', {
    handleId: opaqueId(), workerId: opaqueId(), workerRevision: positiveInteger(), protocolVersion: text(), secretRef: opaqueId(),
    capabilityDigest: digestHex(), allowedOperation: text(), expiresAtMs: nonNegativeInteger(), fenceDigest: digestHex()
  }),
  CanonicalQueryHandle: () => nominal('CanonicalQueryHandle', {
    handleId: opaqueId(), providerDomain: text(), consumerDomain: text(), queryContract: text(), queryVersion: positiveInteger(),
    typedInputSchemaRef: text(), typedInput: contractMap('Bounded typed query value validated against typedInputSchemaRef.'),
    inputDigest: digestHex(), correlationId: opaqueId(), expiresAtMs: nonNegativeInteger(), fenceDigest: digestHex()
  }),
  DomainFactCommitHandle: () => nominal('DomainFactCommitHandle', {
    handleId: opaqueId(), ownerDomain: text(), aggregateType: text(), aggregateId: opaqueId(), factType: text(), factSchemaRef: text(),
    expectedRevision: nonNegativeInteger(), payloadDigest: digestHex(), resultSchemaRef: text(),
    commitIdempotencyKey: opaqueId(), eventFenceDigest: digestHex()
  }),
  ResponsibilityControlCommitHandle: () => nominal('ResponsibilityControlCommitHandle', {
    handleId: opaqueId(), operationKind: enumText('acquire', 'transfer', 'release', 'replace_control_set'), ownerDomain: text(),
    processType: text(), processId: opaqueId(), basisRef: objectRef(), basisDigest: digestHex(), canonicalFactSetDigest: digestHex(),
    bindingSetDigest: digestHex(), controlScopeDigest: digestHex(),
    expectedControlRevisions: arrayOf(object({ materialKey: digestHex(), revision: nonNegativeInteger() })),
    receiptContract: text(), eventFenceDigest: digestHex(), receivingDomain: text(), transferPoint: text()
  }, [
    'handleId', 'operationKind', 'ownerDomain', 'processType', 'processId', 'basisRef', 'basisDigest', 'canonicalFactSetDigest',
    'bindingSetDigest', 'controlScopeDigest', 'expectedControlRevisions', 'receiptContract', 'eventFenceDigest'
  ], {
    ssotRefs: ['8.6.18', '4.3', '7.5.1'],
    allOf: [{
      if: { properties: { operationKind: { const: 'transfer' } }, required: ['operationKind'] },
      then: { required: ['receivingDomain', 'transferPoint'] },
      else: { not: { anyOf: [{ required: ['receivingDomain'] }, { required: ['transferPoint'] }] } }
    }]
  }),
  ApprovalHandle: () => nominal('ApprovalHandle', {
    approvalId: opaqueId(), ownerDomain: text(), processType: text(), processId: opaqueId(), eventId: opaqueId(),
    exactEffectScopeDigest: digestHex(), approvalRevision: positiveInteger(), actorId: opaqueId(),
    invalidatingFactDigests: arrayOf(digestHex()), approvedAtMs: nonNegativeInteger()
  }),
  AuthorizationHandle: () => nominal('AuthorizationHandle', {
    authorizationId: opaqueId(), authorizationKind: text(), ownerDomain: text(), immutableScopeDigest: digestHex(),
    authorizationRevision: positiveInteger(), actorId: opaqueId(), batchId: nullable(opaqueId()),
    invalidatingFactDigests: arrayOf(digestHex()), authorizedAtMs: nonNegativeInteger()
  }, ['authorizationId', 'authorizationKind', 'ownerDomain', 'immutableScopeDigest', 'authorizationRevision', 'actorId', 'invalidatingFactDigests', 'authorizedAtMs']),
  ExternalJobReceipt: () => nominal('ExternalJobReceipt', {
    receiptId: opaqueId(), integrationId: opaqueId(), externalJobId: opaqueId(), operationKind: text(), idempotencyKey: opaqueId(),
    requestDigest: digestHex(), configRevision: positiveInteger(), createdAtMs: nonNegativeInteger()
  }),
  EffectReceipt: () => nominal('EffectReceipt', {
    effectReceiptId: opaqueId(), effectId: opaqueId(), effectClass: enumText('workspace_write', 'external_request', 'domain_fact_commit', 'responsibility_control_commit', 'material_commit', 'destructive_commit'),
    idempotencyKey: opaqueId(), commitMarker: opaqueId(), externalReceiptRef: nullable(opaqueId()), outputDigest: digestHex(),
    verificationEvidenceDigest: digestHex(), committedAtMs: nonNegativeInteger()
  }, ['effectReceiptId', 'effectId', 'effectClass', 'idempotencyKey', 'commitMarker', 'outputDigest', 'verificationEvidenceDigest', 'committedAtMs']),
  TargetCommitSlotHandle: () => nominal('TargetCommitSlotHandle', {
    slotId: opaqueId(), onDeckRunId: opaqueId(), targetEndpointId: opaqueId(), targetDirectory: text(), slotDirectory: text(),
    finalInventoryDecisionDigest: digestHex(), transactionRevision: positiveInteger(), containmentDigest: digestHex()
  }),
  ExternalMaterialHandle: () => nominal('ExternalMaterialHandle', {
    handleId: opaqueId(), integrationId: opaqueId(), configRevision: positiveInteger(), externalObjectRef: opaqueId(), endpointId: opaqueId(), location: text(),
    structureKind: enumText('single', 'season'), outputSnapshot: externalOutputSnapshotSchema(), manifestDigest: digestHex(),
    observationRevision: positiveInteger(), accessFenceDigest: digestHex()
  }),
  WorkerAssetReceipt: () => nominal('WorkerAssetReceipt', {
    workerAssetId: opaqueId(), workerId: opaqueId(), sourceHandleDigest: digestHex(), registrationReceipt: opaqueId(),
    configRevision: positiveInteger(), createdAtMs: nonNegativeInteger()
  }),
  WorkerUploadReceipt: () => nominal('WorkerUploadReceipt', {
    workerAssetId: opaqueId(), workerId: opaqueId(), uploadReceipt: opaqueId(), uploadedDigest: digestHex(),
    sizeBytes: nonNegativeInteger(), completedAtMs: nonNegativeInteger()
  }),
  FaceEmbeddingSetHandle: () => nominal('FaceEmbeddingSetHandle', {
    artifactHandleId: opaqueId(), artifactHandle: ref('ArtifactHandle'),
    computationMode: enumText('western_frame_set', 'single_reference_face'),
    libraRunId: nullable(opaqueId()), workspaceId: nullable(opaqueId()), faceModelRefDigest: digestHex(),
    sourceArtifactSetDigest: digestHex(), detectedFaceCount: nonNegativeInteger(), vectorCount: nonNegativeInteger(),
    dimension: positiveInteger(), embeddingDigest: digestHex(), handleDigest: digestHex()
  }),
  FaceClusterSetHandle: () => nominal('FaceClusterSetHandle', {
    artifactHandleId: opaqueId(), artifactHandle: ref('ArtifactHandle'), libraRunId: opaqueId(), workspaceId: opaqueId(),
    faceModelRefDigest: digestHex(), clusterParameterDigest: digestHex(), sourceEmbeddingDigest: digestHex(),
    clusterCount: nonNegativeInteger(), clusterDigest: digestHex(), handleDigest: digestHex()
  }),
  EvidenceEnvelope: () => plainSchema('EvidenceEnvelope', {
    evidenceId: opaqueId(), evidenceKind: text(), producerRef: text(), basisDigest: digestHex(), payloadDigest: digestHex(), observedAtMs: nonNegativeInteger()
  }),
  VerificationEnvelope: () => plainSchema('VerificationEnvelope', {
    verificationId: opaqueId(), verificationKind: text(), basisDigest: digestHex(), result: enumText('passed', 'failed', 'not_applicable'),
    reasonCodes: arrayOf(text()), evidenceRefs: arrayOf(opaqueId()), verifiedAtMs: nonNegativeInteger()
  }),
  DomainFactEnvelope: () => plainSchema('DomainFactEnvelope', {
    factId: opaqueId(), ownerDomain: text(), aggregateType: text(), aggregateId: opaqueId(), revision: positiveInteger(),
    factSchemaRef: text(), factDigest: digestHex(), commitMarker: opaqueId(), committedAtMs: nonNegativeInteger()
  }),
  ReceiptEnvelope: () => plainSchema('ReceiptEnvelope', {
    receiptId: opaqueId(), receiptKind: text(), ownerDomain: text(), scopeType: text(), scopeId: opaqueId(), scopeDigest: digestHex(),
    effectReceiptRef: nullable(opaqueId()), committedAtMs: nonNegativeInteger()
  }, ['receiptId', 'receiptKind', 'ownerDomain', 'scopeType', 'scopeId', 'scopeDigest', 'committedAtMs']),
  ManifestEnvelope: () => plainSchema('ManifestEnvelope', {
    manifestId: opaqueId(), manifestKind: text(), schemaVersion: { const: 1 }, ownerDomain: text(), memberCount: nonNegativeInteger(), membersDigest: digestHex(),
    manifestDigest: digestHex(), publishedAtMs: nonNegativeInteger()
  }),
  DraftEnvelope: () => plainSchema('DraftEnvelope', {
    draftId: opaqueId(), draftKind: text(), basisDigest: digestHex(), schemaRef: text(), draftDigest: digestHex(), producedAtMs: nonNegativeInteger()
  }),
  CapabilityExecutionContext: () => plainSchema('CapabilityExecutionContext', {
    executionId: opaqueId(), workId: opaqueId(), workAttemptId: opaqueId(), planId: opaqueId(), eventId: opaqueId(), eventAttemptId: opaqueId(),
    capabilityRef: text({ pattern: '^[a-z][a-z0-9_.-]+@1$' }), contractVersion: { const: 1 }, executorVersion: positiveInteger(),
    ownerScope: object({ domain: text(), processType: text(), processId: opaqueId(), objectRefs: arrayOf(objectRef()) }),
    basisRefs: arrayOf(basisRef()), namedInputs: contractMap('Values are validated by the bound Capability input schemas.'),
    parameters: contractMap('Values are validated by the bound Capability parameters schema.'),
    fenceSnapshot: contractMap('Fence slices are validated by the bound Capability fence schema.'),
    resourceLease: object({ leaseId: opaqueId(), resourceKeys: arrayOf(text()), issuedAtMs: nonNegativeInteger() }),
    approvalHandle: ref('ApprovalHandle'), authorizationHandle: ref('AuthorizationHandle'), idempotencyKey: opaqueId(),
    deadlineAtMs: nonNegativeInteger(),
    traceContext: object({ traceId: text(), spanId: text(), sampled: { type: 'boolean' } }, ['traceId', 'spanId'])
  }, [
    'executionId', 'workId', 'workAttemptId', 'planId', 'eventId', 'eventAttemptId', 'capabilityRef', 'contractVersion',
    'executorVersion', 'ownerScope', 'basisRefs', 'namedInputs', 'parameters', 'fenceSnapshot', 'resourceLease',
    'idempotencyKey', 'traceContext'
  ], { ssotRefs: ['8.6.17'] }),
  CapabilityOutcome: () => ({
    $schema: DRAFT,
    $id: typeId('CapabilityOutcome'),
    title: 'CapabilityOutcome@1',
    'x-helix-ssotRefs': ['8.6.17'],
    oneOf: [
      object({
        kind: { const: 'succeeded' }, resultSchemaRef: text(), result: { 'x-helix-requires-bound-schema': true },
        evidenceSchemaRef: text(), evidence: { 'x-helix-requires-bound-schema': true }, effectReceipt: ref('EffectReceipt')
      }, ['kind', 'resultSchemaRef', 'result', 'evidenceSchemaRef', 'evidence']),
      object({
        kind: { const: 'deferred' }, reasonCode: text(), retryAfterMs: nonNegativeInteger(),
        evidence: { 'x-helix-requires-bound-schema': true }, externalReceipt: ref('ExternalJobReceipt')
      }, ['kind', 'reasonCode', 'retryAfterMs', 'evidence']),
      object({
        kind: { const: 'failed' }, failureClass: text(), code: text(), message: text(),
        retryDirective: enumText('never', 'contract_policy'), evidence: { 'x-helix-requires-bound-schema': true }
      }),
      object({
        kind: { const: 'fence_rejected' }, fenceSlice: contractMap('Rejected fence slice.'), expectedDigest: digestHex(),
        actualDigest: digestHex(), evidence: { 'x-helix-requires-bound-schema': true }
      })
    ]
  })
};

function buildSharedTypeSchemas() {
  return Object.fromEntries(Object.entries(definitions).map(([name, build]) => [name, build()]));
}

function schemaDigest(schema) {
  const canonicalize = (value) => Array.isArray(value)
    ? value.map(canonicalize)
    : value && typeof value === 'object'
      ? Object.keys(value).sort().reduce((result, key) => { result[key] = canonicalize(value[key]); return result; }, {})
      : value;
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(schema))).digest('hex');
}

module.exports = Object.freeze({ buildSharedTypeSchemas, externalOutputSnapshotSchema,
  providerAcquisitionCandidateSnapshotSchema, schemaDigest, typeId });
