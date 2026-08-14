'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

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
