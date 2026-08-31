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
  const settlementGraceMs = options.settlementGraceMs === undefined ? 1000 : options.settlementGraceMs;
  if (!Number.isSafeInteger(settlementGraceMs) || settlementGraceMs < 0 || settlementGraceMs > 30000) {
    throw new TypeError('Cooperative execution isolation settlement grace is invalid.');
  }
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
          typeof request.cooperativeAbortSafe !== 'boolean' ||
          typeof request.operation !== 'function') throw new TypeError('Cooperative execution isolation request is invalid.');
      if (active.has(request.executionHandleId)) throw new Error('Execution isolation handle is already active.');
      const controller = new AbortController();
      active.set(request.executionHandleId, controller);
      const deadlineError = new IsolationDeadlineError(Object.freeze({
        executionHandleId:request.executionHandleId,
        deadlineAtMs:request.deadlineAtMs,
      }));
      let graceTimer = null;
      let rejectDeadline;
      const forcedDeadline = new Promise((resolve, reject) => { rejectDeadline=reject; });
      const timer = setTimer(() => {
        controller.abort(deadlineError);
        if (request.cooperativeAbortSafe) {
          graceTimer=setTimer(() => rejectDeadline(deadlineError), settlementGraceMs);
        }
      }, Math.max(0, request.deadlineAtMs - now()));
      try {
        const operation=Promise.resolve().then(()=>request.operation(controller.signal));
        return await (request.cooperativeAbortSafe ? Promise.race([operation,forcedDeadline]) : operation);
      } catch (error) {
        if (controller.signal.aborted && controller.signal.reason instanceof IsolationDeadlineError) {
          throw controller.signal.reason;
        }
        throw error;
      } finally {
        clearTimer(timer);
        if(graceTimer!==null)clearTimer(graceTimer);
        active.delete(request.executionHandleId);
      }
    },
    async terminateAndIsolate(executionHandleId) {
      abort(executionHandleId, new IsolationDeadlineError(Object.freeze({ executionHandleId, terminated:true })));
    },
  });
}

module.exports = Object.freeze({ IsolationDeadlineError, createCooperativeExecutionIsolation });
