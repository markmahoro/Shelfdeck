'use strict';

const { canonicalDigest, canonicalJson } = require('../../../contracts/canonical-json');

const INPUT_SET = 'helix://foundation/types/EventInputBindingSet/v1';
const REFERENCE_SCHEMA = 'helix://contracts/application-types/ProcurementRetryCommandPlanReference/v1';
const PLANNER_REF = 'procurement.failed-preparation-retry-planner@2';
const SHA256 = /^[a-f0-9]{64}$/;
const REQUEST_KEYS = ['actorId', 'expectedFailedRunBasisDigest', 'expectedFailedRunStateRevision',
  'failedProcurementRunId', 'fieldId', 'idempotencyKey'];
const REFERENCE_KEYS = ['schemaRef', 'schemaVersion', 'intentDigest', 'newRunBasisDigest', 'newRunId', 'request', 'retryIntentId', 'retryScopeDigest'];

function fail() {
  const error = new Error('Retry Work must contain exact, bounded Procurement command references.');
  error.code = 'FAILED_PREPARATION_RETRY_PLAN_REFERENCE_INVALID';
  throw error;
}

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort());
}

function validateReference(value) {
  if (!exactKeys(value, REFERENCE_KEYS) || value.schemaRef !== REFERENCE_SCHEMA || value.schemaVersion !== 1 ||
      !exactKeys(value.request, REQUEST_KEYS)) fail();
  const request = value.request;
  if (!Number.isSafeInteger(request.expectedFailedRunStateRevision) || request.expectedFailedRunStateRevision < 1 ||
      !SHA256.test(request.expectedFailedRunBasisDigest) ||
      ['actorId', 'failedProcurementRunId', 'fieldId', 'idempotencyKey'].some((key) =>
        typeof request[key] !== 'string' || !request[key] || request[key].length > 256) ||
      ['intentDigest', 'retryScopeDigest'].some((key) => !SHA256.test(value[key])) ||
      value.newRunBasisDigest !== null && !SHA256.test(value.newRunBasisDigest) ||
      ['retryIntentId', 'newRunId'].some((key) => typeof value[key] !== 'string' || !value[key] || value[key].length > 256)) fail();
  return value;
}

function bindingSet(kind, reference) {
  validateReference(reference);
  if (!['intent', 'admission'].includes(kind)) fail();
  const result = Object.freeze({ schemaRef: INPUT_SET, schemaVersion: 1, bindings: Object.freeze([
    Object.freeze({ bindingKind: 'projected_owner_facts', ownerDomain: 'procurement',
      processType: 'procurement_run', processId: reference.request.failedProcurementRunId,
      portName: kind === 'intent' ? 'retryIntentCommand' : 'retryAdmissionCommand',
      projectionRef: kind === 'intent'
        ? 'helix://procurement/input-projections/RetryIntentCommand/v1'
        : 'helix://procurement/input-projections/RetryAdmissionCommand/v1',
      parameters: reference }),
  ]) });
  if (Buffer.byteLength(canonicalJson(result), 'utf8') > 16384) fail();
  return result;
}

function readReference(pages) {
  if (!Array.isArray(pages) || pages.length !== 2) fail();
  const reference = validateReference(pages[0]?.bindings?.[0]?.parameters);
  if (canonicalJson(pages[0]) !== canonicalJson(bindingSet('intent', reference)) ||
      canonicalJson(pages[1]) !== canonicalJson(bindingSet('admission', reference))) fail();
  return reference;
}

function requestBasisDigest(request) {
  const { idempotencyKey: _idempotencyKey, ...basis } = request;
  return canonicalDigest({ schema: 'procurement.admin-failed-preparation-retry-basis@1', ...basis });
}

module.exports = Object.freeze({ INPUT_SET, PLANNER_REF, REFERENCE_SCHEMA, bindingSet, readReference, requestBasisDigest });
