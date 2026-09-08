'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const deploySource = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'deploy-nas.js'), 'utf8');
const buildSource = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'build-image.js'), 'utf8');

test('production deploy owns the Helix clean initialization contract', () => {
  assert.match(deploySource, /--helix-clean-init/);
  assert.match(deploySource, /Helix clean initialization/);
  assert.match(deploySource, /Helix runtime readiness/);
  assert.match(deploySource, /shelfdeck-readiness-source:ro/);
  assert.match(deploySource, /create-readiness-snapshot\.js/);
  assert.doesNotMatch(deploySource, /cp -a \/run\/shelfdeck-readiness-source\/\./);
  assert.match(deploySource, /grep -q.*state.*ready/);
  assert.match(deploySource, /INITIALIZE_HELIX_CLEAN_V1/);
  assert.match(deploySource, /helix-clean-init\.js/);
  assert.match(deploySource, /persistAdminApiKey/);
  assert.doesNotMatch(deploySource, /v3-data-migration|kairox-beta-cutover/);
});

test('production image build requires a clean, commit-addressed worktree', () => {
  assert.match(buildSource, /git.*status/);
  assert.match(buildSource, /--porcelain/);
  assert.match(buildSource, /rev-parse/);
  assert.match(buildSource, /--short=10/);
  assert.match(buildSource, /dirty worktree/);
});
