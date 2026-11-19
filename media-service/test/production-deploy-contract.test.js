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

test('production dry run mounts the heavy SSD/HDD split, verifies mount UUIDs, and enables NVIDIA runtime', () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, '../../scripts/deploy-nas.js'),
    '/srv/apps/shelfdeck/releases/shelfdeck-contract-check.tar',
    '--preserve-remote-reset-config', '--expect-stopped'], {
    encoding: 'utf8', timeout: 10000,
    env: { ...process.env, SHELFDECK_SECRET_ROOT: 'deployment-contract-fixture-secret-root' },
  });
  assert.equal(result.status, 0, result.stderr);
  const compose = result.stdout.slice(result.stdout.indexOf('services:'),
    result.stdout.indexOf('\nCheck image tarball'));
  const lines = compose.split('\n').map(line => line.trim());
  for (const binding of [
    '/srv/apps/shelfdeck/data:/app/data',
    '/srv/shelfdeck/operator-backups:/app/data/operator-backups',
    '/srv/shelfdeck/operator-backups:/operator-backups',
    '/srv/apps/shelfdeck/reset-config.json:/run/shelfdeck-reset/config.json:ro',
    '/srv/shelfdeck/transcode:/transcode',
    '/mnt/shelfdeck_upgrade:/upgrade',
    '/media:/media',
    '/adult:/adult_media',
    '/adult:/adult',
  ]) assert.equal(lines.filter(line => line === '- ' + binding).length, 1, binding);
  assert.ok(lines.includes('runtime: nvidia'));
  assert.ok(lines.includes('- NVIDIA_VISIBLE_DEVICES=all'));
  assert.ok(lines.includes('- NVIDIA_DRIVER_CAPABILITIES=compute,video,utility'));
  assert.ok(lines.includes('- SHELFDECK_RESET_CONFIG_FILE=/run/shelfdeck-reset/config.json'));
  assert.ok(!compose.includes('/dev/dri'));
  assert.ok(!compose.includes('LIBVA_DRIVER_NAME'));
  assert.ok(result.stdout.includes('2e4fda48-ccbd-40cd-9b6b-1b66c4eb2dda'));
  assert.ok(result.stdout.includes('11cf7e64-e7fa-4573-8588-5afb97ce3854'));
  assert.ok(result.stdout.includes('findmnt -rn -T'));
  assert.ok(result.stdout.includes('stat -c %d:%i /adult_media'));
  assert.ok(result.stdout.includes('hevc_nvenc'));
  assert.ok(result.stdout.includes('"normalSupplyAllowed":false'));
  assert.ok(result.stdout.includes('Prepare dedicated operator backup volume'));
  assert.ok(result.stdout.includes('Existing in-data operator backups must be preserved'));
  assert.ok(result.stdout.includes('Dry run only.'));
  assert.ok(!result.stdout.includes('deployment-contract-fixture-secret-root'));
});
