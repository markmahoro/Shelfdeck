'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const deploySource = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'deploy-nas.js'), 'utf8');

test('production deploy owns the Helix clean initialization and dual config backup contract', () => {
  assert.match(deploySource, /--helix-clean-init/);
  assert.match(deploySource, /Helix clean initialization plan/);
  assert.match(deploySource, /Stop current container for Helix clean initialization/);
  assert.match(deploySource, /Verify original production config snapshot/);
  assert.match(deploySource, /Verify Helix clean initialization config backup/);
  assert.match(deploySource, /INITIALIZE_HELIX_CLEAN_STATE/);
  assert.match(deploySource, /Verify Helix clean runtime/);
  assert.doesNotMatch(deploySource, /v3-data-migration|kairox-beta-cutover/);
});
