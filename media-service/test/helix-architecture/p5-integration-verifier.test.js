'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { BOUNDARIES, REQUIRED_FIXTURES, createNodeFixtureRunner, verifyP5IsolatedIntegration } =
  require('../../scripts/helix-architecture/p5-integration-verifier');

const serviceRoot = path.resolve(__dirname, '../..');

function runtime(overrides = {}) {
  const boundaryScenarios = BOUNDARIES.map((item) => ({ effectClass: item.effectClass, crashPoint: item.crashPoint,
    decision: item.decision, dispatchCount: 1 }));
  return { ok: true, scenarioCount: 31, scenarios: [...boundaryScenarios,
    ...Array.from({ length: 27 }, (_, index) => ({ effectClass: 'fixture', crashPoint: `point-${index}` }))], ...overrides };
}

test('one verifier closes all P5 fixture families and four P4 recovery boundaries', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-p5-verifier-test-'));
  const calls = [];
  try {
    const result = await verifyP5IsolatedIntegration({
      serviceRoot, tempRoot,
      fixtureRunner: { run: (files) => { calls.push(files); return { ok: true, status: 0, files }; } },
      runtimeVerifier: { verify: async (request) => { calls.push(request); return runtime(); } }
    });
    assert.equal(result.ok, true);
    assert.equal(result.fixtureCount, 10);
    assert.equal(result.recoveryScenarioCount, 31);
    assert.deepEqual(result.boundaryScenarios.map((item) => item.boundary),
      ['workspace_staged', 'workspace_observed', 'material_promoted', 'external_receipt']);
    assert.equal(result.boundaryScenarios.every((item) => item.dispatchCount === 1), true);
    assert.deepEqual(result.prohibitedActionsRun, []);
    assert.deepEqual(calls[0], REQUIRED_FIXTURES);
    assert.equal(calls[1].tempRoot, path.join(tempRoot, 'runtime'));
  } finally { fs.rmSync(tempRoot, { recursive: true, force: true }); }
});

test('wrong fixture set, missing crash scenario, duplicate dispatch, and non-temp root fail closed', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-p5-verifier-negative-'));
  const goodFixtures = { run: (files) => ({ ok: true, status: 0, files }) };
  try {
    await assert.rejects(verifyP5IsolatedIntegration({ serviceRoot, tempRoot: serviceRoot,
      fixtureRunner: goodFixtures, runtimeVerifier: { verify: async () => runtime() } }),
    { code: 'P5_INTEGRATION_TEMP_BOUNDARY' });
    await assert.rejects(verifyP5IsolatedIntegration({ serviceRoot, tempRoot,
      fixtureRunner: { run: () => ({ ok: true, status: 0, files: REQUIRED_FIXTURES.slice(1) }) },
      runtimeVerifier: { verify: async () => runtime() } }), { code: 'P5_INTEGRATION_FIXTURES_FAILED' });
    await assert.rejects(verifyP5IsolatedIntegration({ serviceRoot, tempRoot, fixtureRunner: goodFixtures,
      runtimeVerifier: { verify: async () => runtime({ scenarios: runtime().scenarios.filter((item) =>
        !(item.effectClass === 'material_commit' && item.crashPoint === 'after_fake_effect')) }) } }),
    { code: 'P5_INTEGRATION_BOUNDARY_RECOVERY' });
    const duplicated = runtime();
    duplicated.scenarios.find((item) => item.effectClass === 'external_request').dispatchCount = 2;
    await assert.rejects(verifyP5IsolatedIntegration({ serviceRoot, tempRoot, fixtureRunner: goodFixtures,
      runtimeVerifier: { verify: async () => duplicated } }), { code: 'P5_INTEGRATION_BOUNDARY_RECOVERY' });
  } finally { fs.rmSync(tempRoot, { recursive: true, force: true }); }
});

test('concrete fixture runner accepts only the exact isolated P5 files', () => {
  const runner = createNodeFixtureRunner({ serviceRoot });
  assert.throws(() => runner.run(REQUIRED_FIXTURES.slice(1)), { code: 'P5_INTEGRATION_FIXTURE_SET' });
  assert.throws(() => runner.run([...REQUIRED_FIXTURES.slice(0, -1), '..\\server.js']), { code: 'P5_INTEGRATION_FIXTURE_SET' });
});

test('harness cannot start product, bind ports, use ambient credentials, shell, Docker, or real tools', () => {
  const files = [
    'scripts/helix-p5-integration-verify.js',
    'scripts/helix-architecture/p5-integration-verifier.js'
  ];
  const source = files.map((file) => fs.readFileSync(path.join(serviceRoot, file), 'utf8').toLowerCase()).join('\n');
  for (const forbidden of ['src/server', 'listen(', 'x-api-key', 'process.env.emby', 'process.env.tmdb', 'process.env.ffmpeg',
    'kairox', 'taskmanager', 'media-desktop', 'docker', 'shell: true', 'child_process.exec(', 'ffmpeg-static', 'undici']) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});
