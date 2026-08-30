'use strict';

class CooperativeDeadlineError extends Error {
  constructor(details = {}) {
    super('Cooperative execution deadline was exceeded.');
    this.name = 'CooperativeDeadlineError';
    this.code = 'P4_COOPERATIVE_DEADLINE_EXCEEDED';
    this.details = details;
  }
}

function assertRequest(options) {
  if (!options || typeof options !== 'object' ||
      (options.deadlineAtMs !== undefined && (!Number.isSafeInteger(options.deadlineAtMs) || options.deadlineAtMs < 0)) ||
      (options.signal !== undefined && (!options.signal || typeof options.signal.addEventListener !== 'function')) ||
      (options.now !== undefined && typeof options.now !== 'function')) {
    throw new TypeError('Cooperative deadline options are invalid.');
  }
}

function deadlineError(options, reason) {
  return new CooperativeDeadlineError(Object.freeze({
    deadlineAtMs: options.deadlineAtMs ?? null,
    stage: options.stage || null,
    location: options.location || null,
    reason,
  }));
}

function assertWithinDeadline(options = {}) {
  assertRequest(options);
  if (options.signal?.aborted) throw deadlineError(options, 'aborted');
  if (options.deadlineAtMs !== undefined && (options.now || Date.now)() >= options.deadlineAtMs) {
    throw deadlineError(options, 'deadline_elapsed');
  }
}

async function awaitWithinDeadline(operation, options = {}) {
  if (typeof operation !== 'function') throw new TypeError('Cooperative deadline operation is required.');
  assertWithinDeadline(options);
  const now = options.now || Date.now;
  const setTimer = options.setTimeout || setTimeout;
  const clearTimer = options.clearTimeout || clearTimeout;
  let timer = null;
  let onAbort = null;
  const guards = [];
  if (options.signal) guards.push(new Promise((resolve, reject) => {
    onAbort = () => reject(deadlineError(options, 'aborted'));
    options.signal.addEventListener('abort', onAbort, { once:true });
  }));
  if (options.deadlineAtMs !== undefined) guards.push(new Promise((resolve, reject) => {
    const remaining = Math.max(0, options.deadlineAtMs - now());
    timer = setTimer(() => reject(deadlineError(options, 'deadline_elapsed')), remaining);
  }));
  const pending = Promise.resolve().then(operation);
  try {
    return guards.length === 0 ? await pending : await Promise.race([pending, ...guards]);
  } finally {
    if (timer !== null) clearTimer(timer);
    if (onAbort) options.signal.removeEventListener('abort', onAbort);
  }
}

module.exports = Object.freeze({
  CooperativeDeadlineError,
  assertWithinDeadline,
  awaitWithinDeadline,
});
