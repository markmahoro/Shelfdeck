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

class ExecutionInputSupersededError extends Error {
  constructor(message) {
    super(message);
    this.name='ExecutionInputSupersededError';
    this.code='P4_EXECUTION_INPUT_BASIS_SUPERSEDED';
  }
}
function executionInputSuperseded(message) { return new ExecutionInputSupersededError(message); }
function isExecutionInputSuperseded(error) { return error instanceof ExecutionInputSupersededError; }

module.exports = Object.freeze({
  ExecutionInputSupersededError, executionInputSuperseded, isExecutionInputSuperseded,
  ExecutionInputUnavailableError,
  executionInputUnavailable,
  isExecutionInputUnavailable,
});
