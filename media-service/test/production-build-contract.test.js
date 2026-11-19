'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..', '..');

test('production image build has a cross-platform Node entry and a thin shell wrapper', () => {
  const nodeSource = fs.readFileSync(path.join(root, 'scripts', 'build-image.js'), 'utf8');
  const shellSource = fs.readFileSync(path.join(root, 'scripts', 'build-image.sh'), 'utf8');
  assert.match(nodeSource, /docker[\s\S]*build/);
  assert.match(nodeSource, /docker[\s\S]*save/);
  assert.match(nodeSource, /Refusing to reuse an existing production tarball/);
  assert.match(nodeSource, /SHA-256/);
  assert.match(shellSource, /exec node .*build-image\.js/);
  assert.doesNotMatch(shellSource, /docker build|docker save/);
});

test('production image includes all canonical scripts via directory copy', () => {
  const dockerfile = fs.readFileSync(path.join(root, 'media-service', 'Dockerfile'), 'utf8');
  assert.match(dockerfile, /COPY media-service\/src\/ \.\/src\//);
  assert.match(dockerfile, /COPY media-service\/scripts\/ \.\/scripts\//);
  for (const scriptName of [
    'helix-prod033-execution-residual-repair.js',
    'helix-prod034-one-time-correction.js',
    'helix-prod047-aftercare-reclaim-residual-correction.js',
    'helix-prod064-aftercare-placement-incident-correction.js',
    'helix-prod064-aftercare-settlement-residual-correction.js',
    'helix-formation-reset.js',
    'helix-workspace-disk-migration.js',
    'workspace-disk-migration.js',
    'helix-platform-proxy-migration.js',
  ]) {
    assert.ok(
      fs.existsSync(path.join(root, 'media-service', 'scripts', scriptName)),
      `missing canonical script ${scriptName}`,
    );
  }
  assert.ok(!fs.existsSync(path.join(root, 'media-service', 'scripts', 'helix-full-libra-reset.js')));
});

test('operator incident wrappers bind the canonical deploy entry and safeguards', () => {
  const prod047 = fs.readFileSync(path.join(root, 'scripts', 'prod047-aftercare-reclaim-correction-nas.js'), 'utf8');
  assert.match(prod047, /--expected-work-id/);
  assert.match(prod047, /data\.backup-.*-prod047-aftercare-reclaim/);
  assert.match(prod047, /docker compose stop shelfdeck/);
  assert.match(prod047, /helix-prod047-aftercare-reclaim-residual-correction\.js/);
  assert.match(prod047, /deploy-nas\.js/);

  const prod064 = fs.readFileSync(path.join(root, 'scripts', 'prod064-aftercare-placement-correction-nas.js'), 'utf8');
  assert.match(prod064, /INCIDENT_ENTRIES/);
  assert.match(prod064, /docker compose stop shelfdeck/);
  assert.match(prod064, /prod064-preapply/);
  assert.match(prod064, /cp -a \/app\/data-source\/shelfdeck\.db\*/);
  assert.match(prod064, /helix-prod064-aftercare-placement-incident-correction\.js/);
  assert.match(prod064, /deploy-nas\.js/);
});

test('production image packages CUDA runtime libraries for ONNX Runtime CUDA EP', () => {
  const dockerfile = fs.readFileSync(path.join(root, 'media-service', 'Dockerfile'), 'utf8');
  assert.match(dockerfile, /FROM nvidia\/cuda:13\.5\.0-cudnn-runtime-ubuntu24\.04 AS cuda-runtime/);
  assert.match(dockerfile, /ARG ONNXRUNTIME_NODE_INSTALL=cuda12/);
  assert.match(dockerfile, /\/etc\/ld\.so\.conf\.d\/onnxruntime-cuda\.conf/);
  assert.match(dockerfile, /libonnxruntime_providers_cuda\.so/);
  assert.match(dockerfile, /ldd \/app\/node_modules\/onnxruntime-node\/bin\/napi-v6\/linux\/x64\/libonnxruntime_providers_cuda\.so/);
});
