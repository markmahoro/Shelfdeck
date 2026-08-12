'use strict';

const crypto = require('crypto');
const DRAFT = 'https://json-schema.org/draft/2020-12/schema';
const typeId = (name) => `helix://contracts/application-types/${name}/v1`;
const text = (options = {}) => ({ type: 'string', minLength: 1, ...options });
const id = () => text({ maxLength: 256 });
const digest = () => text({ pattern: '^[a-f0-9]{64}$' });
const positive = () => ({ type: 'integer', minimum: 1 });
const nonNegative = () => ({ type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const deviceClass = () => ({ type: 'string', enum: ['software_cpu', 'intel_qsv', 'nvidia_nvenc', 'amd_vaapi', 'remote_worker'] });
const object = (properties, required = Object.keys(properties), options = {}) => ({
  type: 'object', additionalProperties: false, properties, required, ...options
});

function rootQuery() {
  return { $schema: DRAFT, $id: typeId('PlatformWorkspaceRootQuery'), title: 'PlatformWorkspaceRootQuery@1',
    'x-helix-ssotRefs': ['8.6.21'], 'x-helix-maxCanonicalBytes': 4 * 1024,
    ...object({ rootId: id(), expectedConfigRevision: positive(), queryDigest: digest() }, ['rootId', 'queryDigest']) };
}

function rootSnapshot() {
  return { $schema: DRAFT, $id: typeId('PlatformWorkspaceRootSnapshot'), title: 'PlatformWorkspaceRootSnapshot@1',
    'x-helix-ssotRefs': ['8.6.21'], 'x-helix-maxCanonicalBytes': 8 * 1024,
    ...object({ rootId: id(), ownerScope: { const: 'libra' }, rootKind: id(), endpointId: id(), mountScopeId: id(),
      mountScopeRevision: positive(), configRevision: positive(), capabilityDigest: digest(), state: { const: 'active' },
      rootHandleRef: digest(), snapshotDigest: digest() }) };
}

function rootReadResult() {
  const common = { queryDigest: digest(), resultDigest: digest() };
  return { $schema: DRAFT, $id: typeId('PlatformWorkspaceRootReadResult'), title: 'PlatformWorkspaceRootReadResult@1',
    'x-helix-ssotRefs': ['8.6.21'], 'x-helix-maxCanonicalBytes': 16 * 1024,
    oneOf: [
      object({ queryDigest: digest(), resultKind: { const: 'found' }, snapshot: { $ref: typeId('PlatformWorkspaceRootSnapshot') }, resultDigest: digest() }),
      ...['not_found', 'stale', 'inactive', 'integrity_error'].map((kind) => object({ ...common,
        resultKind: { const: kind }, reasonCode: id() }))
    ] };
}

function spaceRequest() {
  return { $schema: DRAFT, $id: typeId('WorkspaceSpaceAdmissionRequest'), title: 'WorkspaceSpaceAdmissionRequest@1',
    'x-helix-ssotRefs': ['8.6.21'], 'x-helix-maxCanonicalBytes': 16 * 1024,
    ...object({ workspaceId: digest(), libraRunId: id(), executionBasisDigest: digest(), rootId: id(),
      rootSnapshotDigest: digest(), inputPrimaryTotalBytes: nonNegative(), requiredFreeBytes: nonNegative(), requestDigest: digest() }) };
}

function spaceEvidence() {
  return { $schema: DRAFT, $id: typeId('WorkspaceSpaceAdmissionEvidence'), title: 'WorkspaceSpaceAdmissionEvidence@1',
    'x-helix-ssotRefs': ['8.6.21'], 'x-helix-maxCanonicalBytes': 16 * 1024,
    ...object({ evidenceId: digest(), authorityRef: { const: 'platform.workspace-space-admission@1' }, requestDigest: digest(),
      workspaceId: digest(), libraRunId: id(), rootId: id(), rootSnapshotDigest: digest(), requiredBytes: nonNegative(),
      availableBytes: nonNegative(), observedAtMs: nonNegative(), expiresAtMs: nonNegative(), result: { type: 'string',
        enum: ['admitted', 'insufficient_space', 'root_unavailable', 'demand_out_of_range'] }, reasonCode: { type: 'string',
        enum: ['insufficient_space', 'root_unavailable', 'demand_out_of_range'] }, evidenceDigest: digest() },
    ['evidenceId', 'authorityRef', 'requestDigest', 'workspaceId', 'libraRunId', 'rootId', 'rootSnapshotDigest', 'requiredBytes',
      'observedAtMs', 'expiresAtMs', 'result', 'evidenceDigest'], { allOf: [{
        if: { properties: { result: { const: 'admitted' } } },
        then: { required: ['availableBytes'], not: { required: ['reasonCode'] } },
        else: { required: ['reasonCode'] }
      }] }) };
}

function computeDeviceListQuery() {
  return { $schema: DRAFT, $id: typeId('PlatformComputeDeviceListQuery'), title: 'PlatformComputeDeviceListQuery@1',
    'x-helix-ssotRefs': ['8.3.8', '8.6.18'], 'x-helix-maxCanonicalBytes': 4 * 1024,
    ...object({ queryContract: { const: 'platform.compute-ready-device-refs@1' }, limit: { type: 'integer', minimum: 1, maximum: 64 },
      queryDigest: digest() }) };
}

function computeDeviceRefSet() {
  const item = object({ deviceId: id(), deviceClass: deviceClass(), probeRevision: positive(), capabilityDigest: digest(), refDigest: digest() });
  const common = { queryDigest: digest(), resultDigest: digest() };
  return { $schema: DRAFT, $id: typeId('PlatformComputeDeviceRefSet'), title: 'PlatformComputeDeviceRefSet@1',
    'x-helix-ssotRefs': ['8.3.8', '8.6.18'], 'x-helix-maxCanonicalBytes': 16 * 1024,
    oneOf: [
      object({ ...common, resultKind: { const: 'available' }, items: { type: 'array', maxItems: 64, items: item } }),
      ...['unavailable', 'integrity_error'].map((kind) => object({ ...common, resultKind: { const: kind },
        items: { type: 'array', maxItems: 0, items: item }, reasonCode: id() }))
    ] };
}

function computeDeviceQuery() {
  return { $schema: DRAFT, $id: typeId('PlatformComputeDeviceQuery'), title: 'PlatformComputeDeviceQuery@1',
    'x-helix-ssotRefs': ['8.3.8', '8.6.18'], 'x-helix-maxCanonicalBytes': 4 * 1024,
    ...object({ deviceId: id(), expectedProbeRevision: positive(), expectedCapabilityDigest: digest(), queryDigest: digest() },
      ['deviceId', 'queryDigest']) };
}

function computeDeviceReadResult() {
  const common = { queryDigest: digest(), resultDigest: digest() };
  return { $schema: DRAFT, $id: typeId('PlatformComputeDeviceReadResult'), title: 'PlatformComputeDeviceReadResult@1',
    'x-helix-ssotRefs': ['8.3.8', '8.6.18'], 'x-helix-maxCanonicalBytes': 16 * 1024,
    oneOf: [
      object({ ...common, resultKind: { const: 'found' }, snapshot: { $ref: 'helix://contracts/domain-types/MediaExecutionDeviceSnapshot/v1' } }),
      ...['not_found', 'stale', 'unavailable', 'integrity_error'].map((kind) => object({ ...common,
        resultKind: { const: kind }, reasonCode: id() }))
    ] };
}

function buildPlatformApplicationSchemas() {
  return Object.freeze({ PlatformWorkspaceRootQuery: rootQuery(), PlatformWorkspaceRootSnapshot: rootSnapshot(),
    PlatformWorkspaceRootReadResult: rootReadResult(), WorkspaceSpaceAdmissionRequest: spaceRequest(),
    WorkspaceSpaceAdmissionEvidence: spaceEvidence(), PlatformComputeDeviceListQuery: computeDeviceListQuery(),
    PlatformComputeDeviceRefSet: computeDeviceRefSet(), PlatformComputeDeviceQuery: computeDeviceQuery(),
    PlatformComputeDeviceReadResult: computeDeviceReadResult() });
}
function canonicalize(value) { if (Array.isArray(value)) return value.map(canonicalize); if (value && typeof value === 'object') return Object.keys(value).sort().reduce((out, key) => { out[key] = canonicalize(value[key]); return out; }, {}); return value; }
function schemaDigest(value) { return crypto.createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex'); }
module.exports = Object.freeze({ buildPlatformApplicationSchemas, schemaDigest, typeId });
