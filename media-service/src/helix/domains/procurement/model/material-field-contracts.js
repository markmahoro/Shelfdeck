'use strict';

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

function createExtractionPolicy(value) {
  if (!value.policy || typeof value.policy !== 'object' || Array.isArray(value.policy)) fail('P7_EXTRACTION_POLICY_INVALID', 'Extraction Policy must be a JSON object.');
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
  return Object.freeze({
    fieldId: text(value.fieldId, 'fieldId'), name: text(value.name, 'name'), status: value.status,
    extractionPolicyId: text(value.extractionPolicyId, 'extractionPolicyId'),
    extractionPolicyRevision: revision(value.extractionPolicyRevision, 'extractionPolicyRevision'),
    currentAccessRevision: revision(value.currentAccessRevision, 'currentAccessRevision'),
    createdAtMs: timestamp(value.createdAtMs, 'createdAtMs'), updatedAtMs: timestamp(value.updatedAtMs, 'updatedAtMs')
  });
}

module.exports = Object.freeze({
  MaterialFieldContractError, createExtractionPolicy, createFieldAccess, createMaterialField
});
