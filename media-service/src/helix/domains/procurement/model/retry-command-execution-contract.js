'use strict';

const { INPUT_SET, REFERENCE_SCHEMA, PLANNER_REF } = require('./retry-command-plan-reference');
const COMMAND_FORMAT = 'helix://foundation/evidence/SynchronousCommandContracts/v1';
const reference = require('../../../contracts/application-types/ProcurementRetryCommandPlanReference/v1/schema.json');
const intentResult = require('../../../contracts/application-types/ProcurementRetryIntentReceipt/v1/schema.json');
const admissionResult = require('../../../contracts/application-types/ProcurementRetryAdmissionResult/v1/schema.json');
const controlReceipt = require('../../../contracts/types/ProcurementControlReceipt/v1/schema.json');

const parametersRef = 'helix://implementation/procurement/retry-parameters/v1';
const fenceRef = 'helix://implementation/procurement/retry-event-fence/v1';
const demandRef = 'helix://implementation/foundation/cpu-demand/v1';
const digest = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const id = { type: 'string', minLength: 1, maxLength: 256 };
const closed = properties => ({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties) });
const bindings = ['intent', 'admission'].map(kind => closed({
  bindingKind: { const: 'projected_owner_facts' }, ownerDomain: { const: 'procurement' }, processType: { const: 'procurement_run' },
  processId: id, portName: { const: kind === 'intent' ? 'retryIntentCommand' : 'retryAdmissionCommand' },
  projectionRef: { const: 'helix://procurement/input-projections/' + (kind === 'intent' ? 'RetryIntentCommand' : 'RetryAdmissionCommand') + '/v1' },
  parameters: { $ref: REFERENCE_SCHEMA },
}));

// This describes the current Owner-managed command protocol, not a release
// exception. Its exact bytes are stored with each newly published retry Plan.
const executionContract = Object.freeze({ schemaRef: COMMAND_FORMAT, schemaVersion: 1, ownerDomain: 'procurement',
  workKind: 'failed_preparation_retry', plannerRef: PLANNER_REF,
  steps: [ ['procurement.retry.intent.create@1', intentResult.$id], ['procurement.retry.admit@1', admissionResult.$id] ].map(([capabilityRef, resultSchemaRef]) => ({
    capabilityRef, contractVersion: 1, effectClass: 'domain_fact_commit', inputSchemaRef: INPUT_SET,
    parametersSchemaRef: parametersRef, fenceSchemaRef: fenceRef, resourceDemandSchemaRef: demandRef, resultSchemaRef,
  })), schemas: [reference, intentResult, admissionResult, controlReceipt,
    { $id: INPUT_SET, ...closed({ schemaRef: { const: INPUT_SET }, schemaVersion: { const: 1 },
      bindings: { type: 'array', minItems: 1, maxItems: 1, items: { oneOf: bindings } } }) },
    { $id: parametersRef, ...closed({}) },
    { $id: fenceRef, ...closed({ basisDigest: digest, inputSetDigest: digest, eventFenceDigest: digest, effectScopeDigest: digest }) },
    { $id: demandRef, ...closed({ resourceKinds: { const: ['cpu'] }, demandDigest: digest }) },
  ].sort((a, b) => a.$id.localeCompare(b.$id, 'en')) });

module.exports = Object.freeze({ executionContract });
