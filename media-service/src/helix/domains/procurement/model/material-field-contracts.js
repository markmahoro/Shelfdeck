'use strict';

const { canonicalDigest } = require('../../../contracts/canonical-json');

const EXTRACTION_POLICY_SCHEMA = 'helix://contracts/domain-types/ExtractionPolicy/v1';
const POLICY_KEYS = ['includedDirectories','excludedDirectories','allowedExtensions','minimumSizeBytes','excludedMaterialKeys'];

class MaterialFieldContractError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'MaterialFieldContractError'; this.code = code; this.details = details; }
}

function fail(code, message, details) { throw new MaterialFieldContractError(code, message, details); }
function text(value, field) { if (typeof value !== 'string' || value.length === 0) fail('P7_FIELD_TEXT_REQUIRED', field + ' is required.', { field }); return value; }
function revision(value, field) { if (!Number.isSafeInteger(value) || value < 1) fail('P7_FIELD_REVISION_INVALID', field + ' must be a positive revision.', { field }); return value; }
function timestamp(value, field) { if (!Number.isSafeInteger(value) || value < 0) fail('P7_FIELD_TIME_INVALID', field + ' must be a non-negative timestamp.', { field }); return value; }
function digest(value, field) { if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) fail('P7_FIELD_DIGEST_INVALID', field + ' must be SHA-256.', { field }); return value; }
function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function sortedUnique(values, maximum, validator, field) {
  if (!Array.isArray(values) || values.length > maximum || values.some((value) => typeof value !== 'string' || !validator(value)) ||
      new Set(values).size !== values.length || values.some((value, index) => index > 0 && Buffer.compare(Buffer.from(values[index - 1]), Buffer.from(value)) >= 0)) {
    fail('P7_EXTRACTION_POLICY_INVALID', field + ' violates its closed sorted-set contract.', { field });
  }
}

function validDirectory(value) {
  return value.length > 0 && !value.startsWith('/') && !value.endsWith('/') && !value.includes('\\') &&
    !/[\0*?\[\]{}()|+^$]/.test(value) && value.split('/').every((segment) => segment && segment !== '.' && segment !== '..');
}

function validateExtractionPolicyValue(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== POLICY_KEYS.length ||
      POLICY_KEYS.some((key) => !Object.hasOwn(value, key))) fail('P7_EXTRACTION_POLICY_INVALID', 'ExtractionPolicy@1 has an invalid shape.');
  sortedUnique(value.includedDirectories, 128, validDirectory, 'includedDirectories');
  sortedUnique(value.excludedDirectories, 128, validDirectory, 'excludedDirectories');
  sortedUnique(value.allowedExtensions, 64, (item) => /^\.[a-z0-9]+$/.test(item), 'allowedExtensions');
  sortedUnique(value.excludedMaterialKeys, 128, (item) => /^[a-f0-9]{64}$/.test(item), 'excludedMaterialKeys');
  if (!Number.isSafeInteger(value.minimumSizeBytes) || value.minimumSizeBytes < 0) fail('P7_EXTRACTION_POLICY_INVALID', 'minimumSizeBytes must be a non-negative safe integer.');
  return value;
}

function createExtractionPolicy(value) {
  if (value.policySchemaRef !== EXTRACTION_POLICY_SCHEMA) fail('P7_EXTRACTION_POLICY_SCHEMA', 'Only ExtractionPolicy@1 is supported.');
  validateExtractionPolicyValue(value.policy);
  const basis = { extractionPolicyId:value.extractionPolicyId, revision:value.revision, ...value.policy };
  if (canonicalDigest(basis) !== value.policyDigest) fail('P7_EXTRACTION_POLICY_DIGEST_MISMATCH', 'Extraction Policy digest does not match its complete typed value.');
  return Object.freeze({
    extractionPolicyId: text(value.extractionPolicyId, 'extractionPolicyId'), revision: revision(value.revision, 'revision'),
    policySchemaRef: text(value.policySchemaRef, 'policySchemaRef'), policy: deepFreeze(value.policy),
    policyDigest: digest(value.policyDigest, 'policyDigest'), effectiveAtMs: timestamp(value.effectiveAtMs, 'effectiveAtMs')
  });
}

function createFieldAccess(value) {
  return Object.freeze({
    fieldId: text(value.fieldId, 'fieldId'), revision: revision(value.revision, 'revision'),
    endpointId: text(value.endpointId, 'endpointId'), rootLocation: text(value.rootLocation, 'rootLocation'),
    mountScopeId: text(value.mountScopeId, 'mountScopeId'), mountScopeRevision: revision(value.mountScopeRevision, 'mountScopeRevision'),
    accessSchemaRef: text(value.accessSchemaRef, 'accessSchemaRef'), accessDigest: digest(value.accessDigest, 'accessDigest'),
    effectiveAtMs: timestamp(value.effectiveAtMs, 'effectiveAtMs')
  });
}

function createMaterialField(value) {
  if (!['active', 'disabled'].includes(value.status)) fail('P7_FIELD_STATUS_INVALID', 'Material Field status is invalid.');
  if (value.currentObservationRevision !== null) revision(value.currentObservationRevision, 'currentObservationRevision');
  return Object.freeze({
    fieldId: text(value.fieldId, 'fieldId'), name: text(value.name, 'name'), status: value.status,
    extractionPolicyId: text(value.extractionPolicyId, 'extractionPolicyId'),
    extractionPolicyRevision: revision(value.extractionPolicyRevision, 'extractionPolicyRevision'),
    currentAccessRevision: revision(value.currentAccessRevision, 'currentAccessRevision'),
    currentObservationRevision: value.currentObservationRevision,
    createdAtMs: timestamp(value.createdAtMs, 'createdAtMs'), updatedAtMs: timestamp(value.updatedAtMs, 'updatedAtMs')
  });
}

module.exports = Object.freeze({
  EXTRACTION_POLICY_SCHEMA, MaterialFieldContractError, createExtractionPolicy, createFieldAccess, createMaterialField,
  validateExtractionPolicyValue
});
