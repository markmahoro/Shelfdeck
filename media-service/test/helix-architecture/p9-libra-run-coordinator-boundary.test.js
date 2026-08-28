'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const { definitionForReplay } = require(
  '../../src/helix/domains/libra/application/libra-run-coordinator');
const { unresolvedMetadataTerminal } = require(
  '../../src/helix/domains/libra/application/libra-run-coordinator');

const root = path.resolve(__dirname, '../..');

function source(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('Libra Run Coordinator remains a Work issuer and terminal Result reconciler', () => {
  const value = source('src/helix/domains/libra/application/libra-run-coordinator.js');
  assert.doesNotMatch(value, /capability-registrations|capability-ports|capability-dispatcher/);
  assert.doesNotMatch(value, /event-runtime|resource-governor|executeCapability|dispatch\s*\(/);
  assert.doesNotMatch(value, /movie-production-coordinator|movie-formation-coordinator|external-material-coordinator/);
  assert.doesNotMatch(value, /latestAttempt\?\.state\s*===\s*['"](?:succeeded|failed)['"]/);
  assert.match(value, /createWorkAdmission/);
  assert.match(value, /workResultReader/);
  assert.match(value, /globalOpenWorks:1000/);
  assert.match(value, /ownerOpenWorks:1000/);
  assert.match(value, /attachWorkspaceOutputs\(snapshot,workspace,remux\)/);
  assert.match(value, /attachArtifactOutputs\(snapshot,workspace\)/);
  assert.match(value, /productStaging\.ensureWorking/);
  assert.match(value, /sourceRequiresExternalSearch[\s\S]*ensureOriginalMediaThenExternal/);
  assert.match(value, /ensureOriginalMediaThenExternal[\s\S]*directMediaSelectionWork/);
});

test('Libra Run Coordinator replays an admitted Work with its frozen priority only', () => {
  const admitted = Object.freeze({
    schemaRef:'helix://foundation/types/SupportingWorkDefinition/v1', schemaVersion:1,
    workId:'work-1', ownerDomain:'libra', processType:'libra_run', processId:'run-1',
    workKind:'artifact_production', workObjectiveTypeRef:'helix://libra/work/artifact-production/v1',
    workObjectiveVersion:1, executionBasisId:'basis-1', executionBasisDigest:'a'.repeat(64),
    dependencyRefs:Object.freeze([]), priorityClass:'normal_foreground', priorityRevision:1,
    capabilityCatalogScope:'libra', workspaceMaterialScope:Object.freeze([]), idempotencyKey:'key-1',
    concurrencyScope:'run-1/artifact-production',
    outputContractRef:'helix://contracts/capabilities/shared.artifact.manifest.verify/v1/result',
  });
  const existing = Object.freeze({
    definition:admitted,
    definitionDigest:canonicalDigest(admitted),
  });
  const expedited = Object.freeze({
    ...admitted,
    priorityClass:'expedited_formation',
    priorityRevision:2,
  });
  assert.deepEqual(definitionForReplay(expedited,existing),admitted);

  const contractDrift = Object.freeze({
    ...expedited,
    outputContractRef:'helix://contracts/capabilities/changed/v1/result',
  });
  assert.strictEqual(definitionForReplay(contractDrift,existing),contractDrift,
    'Only priority drift may use the frozen admitted Definition.');
});

test('Libra Run Coordinator binds a zero-cast business terminal to the succeeded Provider Work Result', () => {
  const providerResult = Object.freeze({
    sourceWorkId:'metadata-provider-work', eventId:'metadata-provider-event',
    resultDigest:'a'.repeat(64), outcomeKind:'succeeded',
    capabilityRef:'libra.product_metadata.fetch@1',
    result:Object.freeze({ sourceKind:'provider', peopleHints:Object.freeze([]) }),
  });
  const terminal = unresolvedMetadataTerminal(Object.freeze({
    kind:'unresolved', reasonCode:'product_metadata_required_cast_missing',
    results:Object.freeze([Object.freeze({
      sourceWorkId:'metadata-nfo-work', result:Object.freeze({ sourceKind:'related_nfo' }),
    }), providerResult]),
  }));
  assert.equal(terminal.work.workId, 'metadata-provider-work');
  assert.strictEqual(terminal.resultRecord, providerResult);
  assert.equal(terminal.failureCode, 'product_metadata_required_cast_missing');
  assert.equal(terminal.resultRecord.outcomeKind, 'succeeded',
    'A business-unachievable outcome must not rewrite the technical Work as failed.');

  const coordinator = source('src/helix/domains/libra/application/libra-run-coordinator.js');
  assert.match(coordinator,
    /metadataStage\.kind==='unresolved'[\s\S]*unresolvedMetadataTerminal\(metadataStage\)[\s\S]*freezeBusinessTerminal/);
});

test('clean product Composition Root has no legacy Libra coordinator execution path', () => {
  const host = source('src/clean-service-host.js');
  const composition = source('src/helix/composition/create-procurement-execution-runtime.js');
  for (const value of [host, composition]) {
    assert.doesNotMatch(value,
      /createMovieProductionCoordinator|movie-production-coordinator|createMovieFormationCoordinator|movie-formation-coordinator|createExternalMaterialCoordinator|external-material-coordinator/);
  }
  assert.match(composition, /libraRunCoordinator\.reconcile/);
});

test('Arca On-deck Coordinator remains a Work issuer and terminal Result reconciler', () => {
  const value = source('src/helix/domains/arca/application/on-deck-process-coordinator.js');
  assert.doesNotMatch(value, /capability-registrations|capability-ports|capability-dispatcher/);
  assert.doesNotMatch(value, /event-runtime|resource-governor|executeCapability|dispatch\s*\(/);
  assert.doesNotMatch(value, /filesystem|ffmpeg|clean-arca-inventory-port/);
  assert.match(value, /createWorkAdmission/);
  assert.match(value, /workResultReader/);
});

test('Run Discard admin command cannot carry a caller-authored material or path scope', () => {
  const service = source('src/helix/domains/libra/application/libra-run-admin-service.js');
  assert.match(service, /buildRunDiscardCommand/);
  assert.match(service, /discardStore\.inspect/);
  assert.doesNotMatch(service, /body\.(?:materials|members|paths|cleanupScope|controlScope)/);
  const facade = source('src/helix/composition/create-clean-facades.js');
  assert.match(facade, /post_formation_runs_librarunid_actions_discard/);
});
