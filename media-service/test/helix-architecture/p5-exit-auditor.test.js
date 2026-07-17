'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { classifyChangedPath, collectDirtyPaths, prohibitedProductionFindings } = require('../../scripts/helix-architecture/p5-exit-auditor');

test('P5 Exit Audit allows only authorized propagation, Platform/Integration implementation, bounded Foundation, tooling, fixtures, and docs', () => {
  for (const file of [
    'docs/helix/TOP_DOWN_ARCHITECTURE_CONFIRMATION.md',
    'docs/helix/implementation/evidence/P5_10_X.md',
    'docs/helix/implementation/archive/P5_PLATFORM_AND_INTEGRATIONS.md',
    'media-service/src/helix/contracts/ports/p5-public-port-contracts.json',
    'media-service/src/helix/platform/application/location-registry.js',
    'media-service/src/helix/integrations/provider-protocol.js',
    'media-service/src/helix/foundation/effects/artifact-registry.js',
    'media-service/scripts/helix-p5-integration-verify.js',
    'media-service/test/helix-architecture/p5-provider-protocol.test.js'
  ]) assert.equal(classifyChangedPath(file).allowed, true, file);
  for (const file of [
    'media-service/src/server.js', 'media-service/src/helix/domains/libra/index.js',
    'media-service/web/src/App.jsx', 'media-desktop/src/main.js', 'tests/runner.sh', 'Dockerfile'
  ]) assert.equal(classifyChangedPath(file).allowed, false, file);
});

test('P5 production audit rejects legacy/dual paths, startup, Domain internals, credentials, direct external effects, and internal HTTP', () => {
  const file = 'media-service/src/helix/integrations/example.js';
  for (const [source, code] of [
    ['const runtime = "kairox";', 'LEGACY_RUNTIME_REFERENCE'],
    ['const mode = "dual-write";', 'DUAL_OR_FALLBACK_PATH'],
    ['app.listen(8080);', 'PRODUCT_STARTUP_WIRING'],
    ["require('../domains/libra')", 'DOMAIN_INTERNAL_DEPENDENCY'],
    ['const token = process.env.TMDB_TOKEN;', 'AMBIENT_CREDENTIAL_ACCESS'],
    ["require('node:http')", 'DIRECT_EXTERNAL_EFFECT_IMPORT'],
    ["const endpoint = 'http://internal';", 'INTERNAL_HTTP_BOUNDARY']
  ]) assert.equal(prohibitedProductionFindings(file, source)[0].code, code);
});

test('P5 production audit does not treat scripts and negative fixtures as production adapters', () => {
  assert.deepEqual(prohibitedProductionFindings('media-service/scripts/helix-architecture/p5-example.js', "require('node:http')"), []);
  assert.deepEqual(prohibitedProductionFindings('media-service/test/helix-architecture/p5-example.test.js', 'kairox fallback'), []);
});

test('P5 clean-tree audit uses authoritative content and untracked scopes instead of porcelain stat noise', () => {
  const outputs = new Map([
    ['diff --name-only', 'tracked.js\nshared.js'],
    ['diff --cached --name-only', 'staged.js\nshared.js'],
    ['ls-files --others --exclude-standard', 'untracked.js']
  ]);
  const fakeGit = (_root, args) => ({ stdout: outputs.get(args.join(' ')) || '' });
  assert.deepEqual(collectDirtyPaths('ignored', fakeGit), ['shared.js', 'staged.js', 'tracked.js', 'untracked.js']);
});
