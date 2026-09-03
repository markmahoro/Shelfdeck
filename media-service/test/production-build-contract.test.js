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

test('production image includes the bounded PROD-033 residual repair', () => {
  const dockerfile = fs.readFileSync(path.join(root, 'media-service', 'Dockerfile'), 'utf8');
  assert.match(dockerfile,
    /COPY media-service\/scripts\/helix-prod033-execution-residual-repair\.js \.\/scripts\/helix-prod033-execution-residual-repair\.js/);
});

test('production image includes the bounded PROD-034 one-time correction', () => {
  const dockerfile = fs.readFileSync(path.join(root, 'media-service', 'Dockerfile'), 'utf8');
  assert.match(dockerfile,
    /COPY media-service\/scripts\/helix-prod034-one-time-correction\.js \.\/scripts\/helix-prod034-one-time-correction\.js/);
});

test('production image includes the bounded PROD-047 Aftercare reclaim residual correction', () => {
  const dockerfile = fs.readFileSync(path.join(root, 'media-service', 'Dockerfile'), 'utf8');
  assert.match(dockerfile,
    /COPY media-service\/scripts\/helix-prod047-aftercare-reclaim-residual-correction\.js \.\/scripts\/helix-prod047-aftercare-reclaim-residual-correction\.js/);
  const operator = fs.readFileSync(path.join(root, 'scripts',
    'prod047-aftercare-reclaim-correction-nas.js'), 'utf8');
  assert.match(operator, /--expected-work-id/);
  assert.match(operator, /data\.backup-.*-prod047-aftercare-reclaim/);
  assert.match(operator, /docker compose stop shelfdeck/);
  assert.match(operator, /helix-prod047-aftercare-reclaim-residual-correction\.js/);
  assert.match(operator, /deploy-nas\.js/);
});

test('production image includes the guarded PROD-064 Aftercare placement correction', () => {
  const dockerfile = fs.readFileSync(path.join(root, 'media-service', 'Dockerfile'), 'utf8');
  assert.match(dockerfile,
    /COPY media-service\/scripts\/helix-prod064-aftercare-placement-incident-correction\.js \.\/scripts\/helix-prod064-aftercare-placement-incident-correction\.js/);
  const operator = fs.readFileSync(path.join(root, 'scripts',
    'prod064-aftercare-placement-correction-nas.js'), 'utf8');
  assert.match(operator, /INCIDENT_ENTRIES/);
  assert.match(operator, /docker compose stop shelfdeck/);
  assert.match(operator, /prod064-preapply/);
  assert.match(operator, /cp -a \/app\/data-source\/shelfdeck\.db\*/);
  assert.match(operator, /helix-prod064-aftercare-placement-incident-correction\.js/);
  assert.match(operator, /deploy-nas\.js/);
});

test('production image includes the unified Formation Reset and excludes the obsolete full Libra reset', () => {
  const dockerfile = fs.readFileSync(path.join(root, 'media-service', 'Dockerfile'), 'utf8');
  assert.match(dockerfile,
    /COPY media-service\/scripts\/helix-formation-reset\.js \.\/scripts\/helix-formation-reset\.js/);
  assert.doesNotMatch(dockerfile, /helix-full-libra-reset/);
});
