'use strict';

const { canonicalDigest } = require('../src/helix/contracts/canonical-json');
const { createColdResetFence } = require('../src/clean-reset-generation-fence');
const { runFreshResetProcess } = require('./formation-reset-process');
function fail(code) { throw Object.assign(new Error(code), { code }); }
function drained(state) {
  const activity = state?.activity;
  return state?.desiredMode === 'stopped' && activity?.state === 'quiesced' &&
    !activity.inFlightEvents && !activity.inFlightPlanning && !activity.inFlightRecoveries &&
    !activity.inFlightOwnerReconciliations && !activity.inFlightAdminCommands;
}

// This Operator adapter is supplied by the process Supervisor. It never owns
// a business Kernel: it freezes configuration while the Host is available,
// asks that Host to close, then runs the cold child under the durable fence.
function createFreshFormationResetPort({ readRuntime, buildSpec, closeGeneration, assertWorkspaceAvailable,
  prepareWorkflow, beforeClose, afterClose, runOperator = runFreshResetProcess }) {
  if ([readRuntime, buildSpec, closeGeneration].some(fn => typeof fn !== 'function')) fail('RESET_RUNTIME_PORT_INVALID');
  let checking = null, selected = null, applying = false;
  async function inspect() {
    const state = readRuntime();
    if (!drained(state) || state.mode !== 'stopped' || applying) fail('RUNTIME_RESET_REQUIRES_STOPPED');
    assertWorkspaceAvailable?.();
    const configuration = await buildSpec();
    const generationId = canonicalDigest({ contract: 'shelfdeck.fresh-formation-reset@1', configuration, runtimeRevision: state.revision });
    const spec = { ...configuration, generationId, expectedRuntimeRevision: state.revision };
    const preview = await runOperator({ spec, action: 'inspect' });
    const current = readRuntime();
    if (!drained(current) || current.mode !== 'stopped' || current.revision !== state.revision) fail('RUNTIME_RESET_PREVIEW_STALE');
    selected = { spec, preview };
    return preview;
  }
  return Object.freeze({
    preview() {
      if (!checking) checking = inspect().finally(() => { checking = null; });
      return checking;
    },
    async apply(preview, beforeApply) {
      if (applying || checking || typeof beforeApply !== 'function') fail('RESET_OPERATOR_BUSY');
      if (!selected || selected.preview.previewDigest !== preview.previewDigest || canonicalDigest(selected.preview) !== canonicalDigest(preview))
        fail('RUNTIME_RESET_PREVIEW_STALE');
      const state = readRuntime();
      if (!drained(state) || state.mode !== 'resetting' || state.revision !== selected.spec.expectedRuntimeRevision)
        fail('RUNTIME_RESET_PREVIEW_STALE');
      const approved = selected;
      if (!preview.ready) fail('RUNTIME_RESET_BLOCKED');
      applying = true;
      try {
        const drainReceipt=assertWorkspaceAvailable?.();
        const spec = { ...approved.spec, expectedRuntimeRevision: state.revision + 1, storage: preview.storage, approvedPreflight: preview };
        await beforeApply({ backupId: 'reset-' + approved.spec.generationId, resetId: approved.spec.generationId },
          prepareWorkflow && (intent => prepareWorkflow({ spec, drainReceipt, intent })));
        const pending = readRuntime();
        if (!drained(pending) || pending.mode !== 'resetting' || pending.revision !== state.revision + 1)
          fail('RESET_FENCE_RUNTIME_CHANGED');
        await beforeClose?.({ spec, drainReceipt });
        const fence = createColdResetFence(spec); fence.begin();
        const receipt = await closeGeneration({ generationId: spec.generationId, expectedRuntimeRevision: spec.expectedRuntimeRevision });
        fence.markClosed(receipt);
        await afterClose?.({ spec });
        return await runOperator({ spec, action: 'run', request: { idempotencyKey: spec.generationId } });
      } finally { applying = false; }
    },
    recover() { fail('RESET_COLD_RECOVERY_REQUIRED'); },
  });
}

module.exports = Object.freeze({ createFreshFormationResetPort });
