'use strict';

class LibraRunExecutionDeferred extends Error {
  constructor(reasonCode) {
    super('Libra Run execution is waiting for its current Owner view.');
    this.code = 'LIBRA_RUN_EXECUTION_DEFERRED';
    this.reasonCode = reasonCode;
  }
}

function guardedRunWrite(guard, run, write, {purpose} = {}) {
  if (!guard) return write(null);
  if (typeof guard.check !== 'function' || typeof run?.libraRunId !== 'string' || !run.libraRunId ||
      !/^[a-f0-9]{64}$/.test(run.executionBasisDigest || ''))
    throw new TypeError('Guarded Libra writes require the exact Run and its Basis.');
  try {
    const decision = guard.check(Object.freeze({ownerDomain:'libra',processType:'libra_run',
      processId:run.libraRunId,executionBasisDigest:run.executionBasisDigest,...(purpose?{purpose}:{})}));
    if (decision?.kind === 'pending' && typeof decision.reasonCode === 'string' && decision.reasonCode)
      throw new LibraRunExecutionDeferred(decision.reasonCode);
    if (decision?.kind !== 'ready' || !decision.readFence || typeof decision.readFence !== 'object')
      throw new TypeError('Libra Run execution guard returned an invalid decision.');
    return write(decision.readFence);
  } catch (error) {
    if (error?.code === 'P3_UOW_READ_FENCE_CHANGED') throw new LibraRunExecutionDeferred('owner_view_changed');
    throw error;
  }
}

module.exports = Object.freeze({LibraRunExecutionDeferred,guardedRunWrite});
