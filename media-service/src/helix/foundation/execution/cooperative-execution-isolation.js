'use strict';

class IsolationDeadlineError extends Error {
  constructor(details = {}) {
    super('Cooperative execution isolation deadline was exceeded.');
    this.name = 'IsolationDeadlineError';
    this.code = 'P4_ISOLATION_DEADLINE_EXCEEDED';
    this.details = details;
  }
}

function createCooperativeExecutionIsolation(options = {}) {
  const now = options.now || Date.now;
  const setTimer = options.setTimeout || setTimeout;
  const clearTimer = options.clearTimeout || clearTimeout;
  const active = new Map();
  function abort(handle, reason) {
    const current = active.get(handle);
    if (!current || current.signal.aborted) return false;
    current.abort(reason);
    return true;
  }
  return Object.freeze({
    async run(request) {
      if (!request || typeof request.executionHandleId !== 'string' || !request.executionHandleId ||
          !Number.isSafeInteger(request.deadlineAtMs) || request.deadlineAtMs < 0 ||
          typeof request.operation !== 'function') throw new TypeError('Cooperative execution isolation request is invalid.');
      if (active.has(request.executionHandleId)) throw new Error('Execution isolation handle is already active.');
      const controller = new AbortController();
      active.set(request.executionHandleId, controller);
      const deadlineError = new IsolationDeadlineError(Object.freeze({
        executionHandleId:request.executionHandleId,
        deadlineAtMs:request.deadlineAtMs,
      }));
      const timer = setTimer(() => controller.abort(deadlineError), Math.max(0, request.deadlineAtMs - now()));
      try {
        return await request.operation(controller.signal);
      } catch (error) {
        if (controller.signal.aborted && controller.signal.reason instanceof IsolationDeadlineError) {
          throw controller.signal.reason;
        }
        throw error;
      } finally {
        clearTimer(timer);
        active.delete(request.executionHandleId);
      }
    },
    async terminateAndIsolate(executionHandleId) {
      abort(executionHandleId, new IsolationDeadlineError(Object.freeze({ executionHandleId, terminated:true })));
    },
  });
}

module.exports = Object.freeze({ IsolationDeadlineError, createCooperativeExecutionIsolation });
