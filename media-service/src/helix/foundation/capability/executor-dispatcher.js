'use strict';

class ExecutorDispatcherError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ExecutorDispatcherError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new ExecutorDispatcherError(code, message, details);
}

function exactRequest(request) {
  const expected = ['capabilityRef', 'context', 'ownerDomain'];
  if (!request || typeof request !== 'object' || Array.isArray(request) ||
      JSON.stringify(Object.keys(request).sort()) !== JSON.stringify(expected)) {
    fail('P4_DISPATCH_REQUEST_SHAPE_MISMATCH', 'Dispatcher accepts only exact owner, Capability ref, and typed context.');
  }
}

function createExecutorDispatcher(options) {
  if (!options || !options.registry || typeof options.registry.resolve !== 'function' ||
      !options.contractValidator || typeof options.contractValidator.validate !== 'function') {
    fail('P4_DISPATCH_DEPENDENCIES_REQUIRED', 'Exact Capability Registry and Contract Validator are required.');
  }
  return Object.freeze({
    async dispatch(request) {
      exactRequest(request);
      const entry = options.registry.resolve(request.capabilityRef, request.ownerDomain);
      const manifest = entry.manifest;
      const context = request.context;
      options.contractValidator.validate('helix://contracts/types/CapabilityExecutionContext/v1', context);
      if (context.capabilityRef !== manifest.capabilityRef || context.contractVersion !== manifest.contractVersion ||
          context.executorVersion !== entry.executor.version || context.ownerScope.domain !== request.ownerDomain) {
        fail('P4_DISPATCH_CONTEXT_BINDING_MISMATCH', 'Execution Context does not bind the resolved Capability, executor, and Owner exactly.');
      }
      options.contractValidator.validate(manifest.parametersSchemaRef, context.parameters);
      options.contractValidator.validate(manifest.fenceSchemaRef, context.fenceSnapshot);
      const inputSchemaRef = manifest.parametersSchemaRef.replace(/\/parameters$/, '/inputs');
      options.contractValidator.validate(inputSchemaRef, context.namedInputs);
      entry.semantic.validateInputs(context);
      const outcome = await entry.executor.execute(context);
      options.contractValidator.validate('helix://contracts/types/CapabilityOutcome/v1', outcome);
      if (outcome.kind === 'succeeded') {
        if (outcome.resultSchemaRef !== manifest.resultSchemaRef || outcome.evidenceSchemaRef !== manifest.evidenceSchemaRef) fail(
          'P4_DISPATCH_OUTPUT_SCHEMA_MISMATCH', 'Succeeded Outcome schema refs must match the frozen Capability contract.'
        );
        options.contractValidator.validate(manifest.resultSchemaRef, outcome.result);
        options.contractValidator.validate(manifest.evidenceSchemaRef, outcome.evidence);
        entry.semantic.validateResult(context, outcome);
        if (manifest.effectClass !== 'pure_observation' && !outcome.effectReceipt) fail(
          'P4_DISPATCH_EFFECT_RECEIPT_REQUIRED', 'Non-pure succeeded Outcome requires an Effect Receipt or later journal-bound dispatch path.'
        );
      }
      return outcome;
    }
  });
}

module.exports = Object.freeze({ ExecutorDispatcherError, createExecutorDispatcher });
