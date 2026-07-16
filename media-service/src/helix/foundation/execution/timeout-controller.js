'use strict';

class ExecutionTimeoutError extends Error {
  constructor(details = {}) {
    super('Capability execution exceeded its frozen timeout policy.');
    this.name = 'ExecutionTimeoutError';
    this.code = 'P4_EXECUTION_TIMEOUT';
    this.details = details;
  }
}

function fail(code, message) {
  const error = new Error(message); error.name = 'TimeoutControllerError'; error.code = code; throw error;
}

function createTimeoutController(options) {
  if (!options || !options.isolation || typeof options.isolation.run !== 'function' ||
      typeof options.isolation.terminateAndIsolate !== 'function' || typeof options.now !== 'function') fail(
    'P4_TIMEOUT_DEPENDENCIES_REQUIRED', 'Timeout Controller requires an execution isolator and clock.'
  );
  return Object.freeze({
    async execute(request) {
      if (!request || typeof request !== 'object' || Array.isArray(request) ||
          JSON.stringify(Object.keys(request).sort()) !== JSON.stringify(['deadlineAtMs', 'executionHandleId', 'operation']) ||
          !Number.isSafeInteger(request.deadlineAtMs) || request.deadlineAtMs < 0 ||
          typeof request.executionHandleId !== 'string' || !request.executionHandleId || typeof request.operation !== 'function') fail(
        'P4_TIMEOUT_REQUEST_INVALID', 'Timeout execution request is invalid.'
      );
      if (options.now() >= request.deadlineAtMs) {
        await options.isolation.terminateAndIsolate(request.executionHandleId);
        throw new ExecutionTimeoutError({ executionHandleId: request.executionHandleId, deadlineAtMs: request.deadlineAtMs });
      }
      try {
        return await options.isolation.run(Object.freeze({
          executionHandleId: request.executionHandleId, deadlineAtMs: request.deadlineAtMs, operation: request.operation
        }));
      } catch (error) {
        if (!error || error.code !== 'P4_ISOLATION_DEADLINE_EXCEEDED') throw error;
        await options.isolation.terminateAndIsolate(request.executionHandleId);
        throw new ExecutionTimeoutError({ executionHandleId: request.executionHandleId, deadlineAtMs: request.deadlineAtMs });
      }
    }
  });
}

module.exports = Object.freeze({ ExecutionTimeoutError, createTimeoutController });
