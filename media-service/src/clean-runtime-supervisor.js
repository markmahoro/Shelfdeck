'use strict';

const fs = require('node:fs'), path = require('node:path');
const { createCleanServiceHost } = require('./clean-service-host');
const { createResetManagementHost } = require('./clean-reset-management-host');
const { createAdminCredentialSecretStore } = require('./admin-credential-secret-store');
const { createResetManagementCredentialReader, captureResetManagementCredential } = require('./helix/platform/public/admin-credential-runtime');
const { createFreshFormationResetPort } = require('../scripts/formation-reset-runtime-port');
const { runFreshResetProcess } = require('../scripts/formation-reset-process');
const { readColdResetState, finalizeCompletedColdReset, createColdResetFence } = require('./clean-reset-generation-fence');
const { acquireGenerationLease } = require('./clean-generation-lease');
const { prepareResetWorkflow, loadResetWorkflow, assertResetWorkflow, assertResetRetry } = require('./clean-reset-workflow');

function fail(code) { throw Object.assign(new Error(code), { code, statusCode: 409 }); }
function resetConfiguration(options) {
  let configuration = options.resetConfiguration;
  if (!configuration && options.resetConfigFile) {
    const file = options.resetConfigFile;
    if (!path.isAbsolute(file) || fs.lstatSync(file).isSymbolicLink() || !fs.statSync(file).isFile()) fail('RESET_CONFIGURATION_PATH_UNSAFE');
    configuration = JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  if (!configuration) fail('RESET_CONFIGURATION_REQUIRED');
  if (configuration.schema !== 'shelfdeck.reset-configuration@1' ||
      Object.keys(configuration).some(key => !['schema', 'operationRoot', 'backupParent', 'backupSourceOptions', 'storage'].includes(key)))
    fail('RESET_CONFIGURATION_INVALID');
  const { schema, ...spec } = configuration;
  // All paths and archive exclusions are explicit operator configuration. The
  // child independently verifies real paths, Owner roots, mounts and budgets.
  return JSON.parse(JSON.stringify({ ...spec, dataDir: options.dataDir }));
}

// Owns process/transport lifetimes, never business decisions or SQL. A fresh
// Host is constructed only after the cold Operator and Runtime receipt agree.
function createRuntimeSupervisor(options, { createHost = createCleanServiceHost, runOperator = runFreshResetProcess } = {}) {
  let service, business, workflow, liveRuntime, lease, coldOperations, error = null, closed = false, stopping = false, transition = null;
  let address = { host: options.host || '127.0.0.1', port: options.port ?? 18080 };
  function report(cause) {
    const code = /^[A-Z][A-Z0-9_]{1,100}$/.test(cause?.code || '') ? cause.code : 'RESET_SUPERVISOR_FAILED';
    error = { code, message: require('./clean-reset-error-copy').resetErrorMessage(code) };
    options.onExecutionRuntimeError?.({ code, message: error.message });
  }
  async function listen(host) {
    const bound = await host.listen({ ...address });
    if (address.port === 0) address = { ...address, port: Number(new URL(bound).port) };
  }
  function status() {
    const state = assertResetWorkflow(workflow);
    const active = transition !== null || liveRuntime?.().mode === 'resetting';
    return { mode: error ? 'error' : active ? 'resetting' : state.operation.state === 'completed' ? 'stopped' : 'error',
      desiredMode: 'stopped', normalSupplyAllowed: false, revision: state.intent.revision,
      activity: { state: 'quiesced', inFlightEvents: 0, inFlightPlanning: 0, inFlightRecoveries: 0,
        inFlightOwnerReconciliations: 0, inFlightAdminCommands: 0 }, operation: state.operation,
      recoveryBackup: state.intent.pendingReset?.backupId || null, error,
      resetStage: state.fence?.phase || 'awaiting_close_proof', generationId: workflow.spec.generationId,
      resetRetry: error && state.fence?.phase === 'closed' ? workflow.request : null };
  }
  async function openManagement() {
    const reader = createResetManagementCredentialReader({ descriptor: workflow.credential,
      secretStore: createAdminCredentialSecretStore({ dataDir: options.dataDir, secretRoot: options.secretRoot }),
      assertStoppedGeneration(generationId) {
        if (generationId !== workflow.spec.generationId) fail('RESET_WORKFLOW_AUTHORITY_CHANGED');
        assertResetWorkflow(workflow);
      } });
    service = await createResetManagementHost({ readCredential: reader, readStatus: status, adminDistDir: options.adminDistDir,
      retryReset(body, actor) {
        const state = assertResetRetry(workflow, body, actor);
        if (!transition && liveRuntime?.().mode !== 'resetting') launchRecovery();
        return state.operation;
      } });
    await listen(service);
  }
  async function openBootstrap() {
    const configuration = resetConfiguration(options);
    const authority = require('./clean-reset-bootstrap').loadColdResetBootstrap({ file: options.resetBootstrapFile,
      dataDir: options.dataDir, secretRoot: options.secretRoot, configuration });
    let operations;
    const port = createFreshFormationResetPort({ readRuntime: () => operations.snapshot(),
      buildSpec: () => ({ ...configuration, bootstrapId: authority.bootstrapId }), runOperator,
      assertWorkspaceAvailable() { lease.assertHeld(); authority.assertSourceUnchanged(); return authority.drainReceipt(); },
      prepareWorkflow({ spec, drainReceipt, intent }) {
        return prepareResetWorkflow({ spec, drainReceipt, intent,
          credential: captureResetManagementCredential(authority.readCredential(), spec.generationId) });
      },
      beforeClose() { workflow = loadResetWorkflow(options.dataDir); },
      async closeGeneration({ generationId }) {
        lease.assertHeld(); authority.drainReceipt();
        await service.close(); closed = true;
        return { generationId, allBusinessConnectionsClosed: true, deploymentBootstrapId: authority.bootstrapId };
      },
      afterClose: () => openManagement(),
    });
    operations = require('./clean-runtime-operations').createRuntimeOperations({ dataDir: options.dataDir,
      activity: () => ({ state: 'quiesced', inFlightEvents: 0, inFlightPlanning: 0, inFlightRecoveries: 0, inFlightOwnerReconciliations: 0 }),
      previewReset: port.preview, reset: port.apply, normalSupplyAllowed: () => false,
      async onOperationSettled(event) {
        if (event.kind !== 'reset' || !closed || stopping) return;
        if (event.receipt.state !== 'completed') { report(event.receipt.error); return; }
        try { await reopen(event.receipt); } catch (cause) { report(cause); }
      }, onError: report });
    if (!operations.shouldStartStopped()) fail('RESET_BOOTSTRAP_PROOF_INVALID');
    operations.started(); liveRuntime = operations.snapshot; coldOperations = operations;
    business = { async close() {}, wait: operations.wait };
    service = await createResetManagementHost({ readCredential: authority.readCredential,
      readStatus: () => ({ ...operations.snapshot(), resetStage: 'awaiting_confirmation' }),
      previewReset: operations.previewReset, retryReset: operations.reset, adminDistDir: options.adminDistDir });
    await listen(service);
  }
  async function openBusiness(initialOperation) {
    const next = await createHost({ ...options, runtimeInitialOperation: initialOperation,
      onRuntimeOperationSettled: async event => {
        if (event.kind !== 'reset' || !closed || stopping) return;
        if (event.receipt.state !== 'completed') { report(event.receipt.error); return; }
        try { await reopen(event.receipt); } catch (cause) { report(cause); }
      },
      createFormationResetPort(hostPorts) {
        liveRuntime = hostPorts.readRuntime;
        return createFreshFormationResetPort({ ...hostPorts, buildSpec: () => resetConfiguration(options), runOperator,
          prepareWorkflow({ spec, drainReceipt, intent }) {
            lease.assertHeld();
            return prepareResetWorkflow({ spec, drainReceipt, intent, credential: hostPorts.captureResetManagementCredential(spec.generationId) });
          },
          beforeClose() { workflow = loadResetWorkflow(options.dataDir); },
          async closeGeneration(request) {
            const receipt = await business.closeDatabaseGeneration(request);
            closed = true;
            return receipt;
          },
          afterClose: () => openManagement(),
        });
      } });
    try { await listen(next); } catch (cause) { await next.close(); throw cause; }
    business = next; service = next; closed = false; error = null;
  }
  async function reopen(receipt) {
    // Runtime has already persisted its result in the live path. On recovery,
    // finalization below supplies exactly the same stopped completion boundary.
    if (stopping) return;
    const management = service;
    await management.close();
    try { await openBusiness(receipt); }
    catch (cause) { report(cause); await openManagement(); throw cause; }
  }
  function launchRecovery() {
    if (transition || stopping) return;
    transition = Promise.resolve().then(async () => {
      const state = assertResetWorkflow(workflow);
      if (!['closed', 'complete'].includes(state.fence?.phase)) fail('RESET_FENCE_CLOSE_NOT_PROVEN');
      error = null;
      if (state.intent.pendingReset) {
        await runOperator({ spec: workflow.spec, action: 'run', request: { idempotencyKey: workflow.spec.generationId } });
        finalizeCompletedColdReset(options.dataDir);
      }
      const receipt = assertResetWorkflow(workflow).operation;
      await reopen(receipt);
    }).catch(report).finally(() => { transition = null; });
  }
  return Object.freeze({
    async start() {
      lease = acquireGenerationLease({ dataDir: options.dataDir });
      try {
      const state = readColdResetState(options.dataDir);
      if (!state || state.fence.phase === 'complete') {
        if (!state?.intent.pendingReset || state.intent.pendingReset.resetId === state.fence.generationId)
          finalizeCompletedColdReset(options.dataDir);
        // A pending intent without a fence may have crashed immediately before
        // close. It must not enter the ordinary Host's old recovery machinery.
        const intentFile = path.join(options.dataDir, 'operator-runtime', 'intent.json');
        const pending = fs.existsSync(intentFile) && JSON.parse(fs.readFileSync(intentFile, 'utf8')).pendingReset;
        if (!pending) {
          if (options.resetBootstrapFile) {
            // The explicit bootstrap option can survive a restart only after
            // its own completed workflow proves that it was consumed.
            const bootstrap = require('./clean-reset-bootstrap').readBootstrapIdentity(options.resetBootstrapFile);
            const consumed = state?.fence.phase === 'complete' &&
              loadResetWorkflow(options.dataDir).spec.bootstrapId === bootstrap.bootstrapId;
            if (!consumed) { await openBootstrap(); return; }
          }
          await openBusiness(); return;
        }
      }
      workflow = loadResetWorkflow(options.dataDir); closed = true;
      let current = assertResetWorkflow(workflow);
      if (!['closed', 'complete'].includes(current.fence?.phase) && workflow.drainReceipt?.allFileWritersStopped === true &&
          workflow.drainReceipt.runtimeRevision === workflow.spec.expectedRuntimeRevision - 1) {
        lease.assertHeld();
        const fence = createColdResetFence(workflow.spec); fence.begin();
        fence.markClosed({ generationId: workflow.spec.generationId, allBusinessConnectionsClosed: true });
        current = assertResetWorkflow(workflow);
      }
      if (!['closed', 'complete'].includes(current.fence?.phase)) report({ code: 'RESET_FENCE_CLOSE_NOT_PROVEN' });
      await openManagement();
      if (!error) launchRecovery();
      } catch (cause) { lease.close(); throw cause; }
    },
    inject: request => service.inject(request),
    address: () => ({ ...address }),
    async wait() { if (transition) await transition; },
    async close() {
      stopping = true;
      if (transition) await transition;
      await coldOperations?.waitForShutdown(options.shutdownTimeoutMs || 60000);
      // A live Reset's owning Runtime waits for its cold child to close before
      // the parent exits. Normal shutdown retains the existing bounded barrier.
      if (closed && business && liveRuntime?.().mode === 'resetting') {
        const deadline = Date.now() + (options.shutdownTimeoutMs || 60000);
        while (liveRuntime().mode === 'resetting') {
          if (Date.now() >= deadline) fail('P4_SHUTDOWN_CHECKPOINT_TIMEOUT');
          await new Promise(resolve => setTimeout(resolve, 20));
        }
      }
      await service?.close();
      lease?.close();
    },
  });
}

module.exports = Object.freeze({ createRuntimeSupervisor, resetConfiguration });
