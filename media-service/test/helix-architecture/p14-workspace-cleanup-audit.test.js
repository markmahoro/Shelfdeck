'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { canonicalDigest } = require(
  '../../src/helix/contracts/canonical-json'
);
const {
  CYCLE_MS,
  DAY_MS,
  buildObservation,
  buildOffloadAdmission,
} = require(
  '../../src/helix/domains/libra/model/workspace-cleanup-contracts'
);
const {
  assertAdmissionAudit,
} = require(
  '../../src/helix/domains/libra/persistence/workspace-cleanup-store'
);

const NOW = 1_700_000_000_000;
const hash = (value) => canonicalDigest({ value });

function fixture() {
  const reference = Object.freeze({
    referenceId: 'reference-1',
    materialHandleId: 'material-handle-1',
    materialKey: hash('material-1'),
    referenceRevision: 2,
    referenceDigest: hash('reference-1'),
  });
  const control = Object.freeze({
    materialKey: reference.materialKey,
    controlDisposition: 'libra_owned',
    controlRevision: 3,
    controlProjectionDigest: hash('control-3'),
    ownerDomain: 'libra',
    ownerScopeType: 'on_deck_package',
    ownerScopeId: 'package-1',
  });
  const triggerSnapshot = Object.freeze({
    resultKind: 'found',
    onDeckPackageId: 'package-1',
    packageDigest: hash('package-1'),
    projectionRevision: 1,
    projectionDigest: hash('offload-projection-1'),
    offloadCompletionFact: Object.freeze({
      factId: 'offload-fact-1',
      committedAtMs: NOW - DAY_MS,
    }),
  });
  const run = Object.freeze({
    libraRunId: 'run-1',
    stateRevision: 4,
    stateDigest: hash('run-4'),
    executionBasisDigest: hash('run-basis'),
  });
  const workspace = Object.freeze({
    workspaceId: 'workspace-1',
    workspaceRevision: 7,
    workspaceStateDigest: hash('workspace-7'),
    materialReferenceSetDigest: hash('reference-set-7'),
  });
  return { reference, control, triggerSnapshot, run, workspace };
}

function admission(value, firstOther = [], secondOther = []) {
  const observation1 = buildObservation({
    workspaceId: value.workspace.workspaceId,
    observedAtMs: NOW,
    otherReferences: firstOther,
    controls: [value.control],
  });
  const observation2 = buildObservation({
    workspaceId: value.workspace.workspaceId,
    observedAtMs: NOW + CYCLE_MS,
    otherReferences: secondOther,
    controls: [value.control],
  });
  return buildOffloadAdmission({
    triggerSnapshot: value.triggerSnapshot,
    onDeckPackageId: value.triggerSnapshot.onDeckPackageId,
    packageDigest: value.triggerSnapshot.packageDigest,
    nowMs: NOW + CYCLE_MS,
    libraRunRef: value.run,
    workspaceRef: value.workspace,
    references: [value.reference],
    controls: [value.control],
    observation1,
    observation2,
  });
}

test('a reference introduced between real observations rejects admission', () => {
  const value = fixture();
  assert.throws(() => admission(value, [], [{
    workspaceId: 'other-workspace',
    referenceId: 'other-reference',
    referenceRevision: 1,
    referenceDigest: hash('other-reference'),
  }]), (error) => error.code === 'P14_CLEANUP_REFERENCE_AUDIT');
});

test('admission UoW recheck rejects Control drift after observation two', () => {
  const value = fixture();
  const decision = admission(value);
  const snapshot = {
    workspace: value.workspace,
    references: [value.reference],
    otherReferences: [],
  };
  assert.doesNotThrow(() =>
    assertAdmissionAudit(decision, snapshot, [value.control]));
  assert.throws(() => assertAdmissionAudit(decision, snapshot, [{
    ...value.control,
    controlRevision: 4,
    controlProjectionDigest: hash('control-4'),
  }]), (error) => error.code === 'P14_CLEANUP_ADMISSION_AUDIT_STALE');
});

test('cleanup source uses two invocations, optional wake, and in-UoW fences', () => {
  const coordinator = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/helix/domains/libra/application/movie-responsibility-closure-coordinator.js',
  ), 'utf8');
  const store = fs.readFileSync(path.resolve(
    __dirname,
    '../../src/helix/domains/libra/persistence/workspace-cleanup-store.js',
  ), 'utf8');
  assert.doesNotMatch(coordinator, /nowMs\s*-\s*CYCLE_MS/);
  assert.doesNotMatch(coordinator, /offloadCompletionFact\.committedAtMs \+ DAY_MS/);
  assert.match(coordinator, /workspace_cleanup_audit_pending/);
  assert.match(coordinator, /offloadWakeVisible === false/);
  const cleanupBody = coordinator.slice(
    coordinator.indexOf('function cleanupWorkspace'));
  assert.ok(
    cleanupBody.indexOf('offloadCompletionPort.readCompletion') <
      cleanupBody.indexOf('findOffloadWake(packageValue)'),
  );
  const referenceAudit = store.indexOf(
    "participantId: 'cleanup_admission_reference_audit'");
  const controlAudit = store.indexOf(
    "participantId: 'cleanup_admission_control_audit'");
  const write = store.indexOf(
    "participantId: 'cleanup_admission_libra'");
  assert.ok(referenceAudit > 0 && controlAudit > referenceAudit &&
    write > controlAudit);
  assert.match(store,
    /assertAdmissionAudit\(decision, admissionSnapshot, admissionControls\)/);
  const drainBody = coordinator.slice(
    coordinator.indexOf('function drainCleanupScope'),
    coordinator.indexOf('function cleanupWorkspace'));
  assert.match(drainBody, /cleanup\.commit\(/);
  assert.match(drainBody, /reclaimLeftoverWorkspace/);
  assert.ok(
    drainBody.indexOf('cleanup.commit') <
      drainBody.indexOf('reclaimLeftoverWorkspace'),
    'Drain must commit the Libra member before leftover Foundation reclaim.',
  );
  assert.ok(
    drainBody.lastIndexOf('reclaimLeftoverWorkspace') >
      drainBody.lastIndexOf('while (scope.state === \'active\''),
    'Already-completed cleanup Scopes must still leftover unreferenced materials.',
  );
  assert.doesNotMatch(
    drainBody.slice(0, drainBody.indexOf('cleanup.commit')),
    /reclaimEmptyWorkspace/,
  );
  const noOpSlice = cleanupBody.slice(
    cleanupBody.indexOf('inspected.references.length === 0'),
    cleanupBody.indexOf('if (!firstAudit)'),
  );
  assert.match(noOpSlice, /reclaimLeftoverWorkspace/,
    'Completed Workspace with no remaining Libra refs must leftover Foundation materials.');
});
