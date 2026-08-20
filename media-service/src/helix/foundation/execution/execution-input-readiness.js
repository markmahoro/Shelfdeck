'use strict';

class ExecutionInputUnavailableError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'ExecutionInputUnavailableError';
    this.code = 'P4_EXECUTION_INPUT_TEMPORARILY_UNAVAILABLE';
    this.retryAtMs = options.retryAtMs;
    this.details = Object.freeze({
      dependencyKind: options.dependencyKind || 'external_dependency',
      dependencyRef: options.dependencyRef || null,
    });
  }
}

function executionInputUnavailable(message, options) {
  return new ExecutionInputUnavailableError(message, options);
}

function isExecutionInputUnavailable(error) {
  return error instanceof ExecutionInputUnavailableError ||
    error?.code === 'P4_EXECUTION_INPUT_TEMPORARILY_UNAVAILABLE';
}

module.exports = Object.freeze({
  ExecutionInputUnavailableError,
  executionInputUnavailable,
  isExecutionInputUnavailable,
});
