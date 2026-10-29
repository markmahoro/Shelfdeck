'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');

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

test('production dry run mounts the requested adult path and preserves existing bindings', () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, '../../scripts/deploy-nas.js'),
    '/vol1/1000/docker/shelfdeck/shelfdeck-contract-check.tar'], {
    encoding: 'utf8', timeout: 10000,
    env: { ...process.env, SHELFDECK_SECRET_ROOT: 'deployment-contract-fixture-secret-root' },
  });
  assert.equal(result.status, 0, result.stderr);
  const compose = result.stdout.slice(result.stdout.indexOf('services:'),
    result.stdout.indexOf('\nCheck image tarball'));
  const mounts = compose.split('\n').map(line => line.trim());
  for (const binding of [
    '/vol02/1000-0-24018892:/adult', '/vol02/1000-0-24018892:/adult_media',
    '/vol02/1000-0-c5b736af:/media', '/vol2/1000/shelfdeck_transcode:/transcode',
    '/vol2/1000/shelfdeck_upgrade:/upgrade', '/dev/dri:/dev/dri',
    '/vol2/1000/shelfdeck_backups:/app/data/operator-backups',
  ]) assert.equal(mounts.filter(line => line === '- ' + binding).length, 1, binding);
  assert.ok(result.stdout.includes('stat -c %d:%i /adult_media'));
  assert.ok(result.stdout.includes('Prepare dedicated operator backup volume'));
  assert.ok(result.stdout.includes('Existing in-data operator backups must be preserved'));
  assert.ok(result.stdout.includes('Dry run only.'));
  assert.ok(!result.stdout.includes('deployment-contract-fixture-secret-root'));
});
