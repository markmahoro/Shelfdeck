'use strict';

const childProcess = require('node:child_process');
const os = require('node:os');
const path = require('node:path');

const REQUIRED_FIXTURES = Object.freeze([
  'p5-artifact-registry.test.js',
  'p5-location-registry.test.js',
  'p5-material-access-authority.test.js',
  'p5-material-identity.test.js',
  'p5-media-tool-protocol.test.js',
  'p5-provider-protocol.test.js',
  'p5-public-ports.test.js',
  'p5-resource-worker-registry.test.js',
  'p5-secret-lease.test.js',
  'p5-worker-protocol.test.js'
]);

const BOUNDARIES = Object.freeze([
  Object.freeze({ boundary: 'workspace_staged', effectClass: 'workspace_write', crashPoint: 'after_fake_effect', decision: 'continue_forward' }),
  Object.freeze({ boundary: 'workspace_observed', effectClass: 'workspace_write', crashPoint: 'after_observation', decision: 'continue_forward' }),
  Object.freeze({ boundary: 'material_promoted', effectClass: 'material_commit', crashPoint: 'after_fake_effect', decision: 'already_committed' }),
  Object.freeze({ boundary: 'external_receipt', effectClass: 'external_request', crashPoint: 'after_fake_effect', decision: 'already_committed' })
]);

class P5IntegrationVerificationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'P5IntegrationVerificationError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) { throw new P5IntegrationVerificationError(code, message, details); }

function contained(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

function createNodeFixtureRunner(options) {
  if (!options || typeof options.serviceRoot !== 'string') fail('P5_INTEGRATION_FIXTURE_RUNNER_OPTIONS', 'Fixture runner requires service root.');
  const fixtureRoot = path.join(options.serviceRoot, 'test', 'helix-architecture');
  return Object.freeze({
    run(fixtureNames) {
      if (!Array.isArray(fixtureNames) || fixtureNames.length !== REQUIRED_FIXTURES.length ||
          JSON.stringify([...fixtureNames].sort()) !== JSON.stringify([...REQUIRED_FIXTURES].sort())) {
        fail('P5_INTEGRATION_FIXTURE_SET', 'Fixture runner requires the exact P5 coverage set.');
      }
      const files = fixtureNames.map((name) => path.join(fixtureRoot, name));
      if (files.some((file) => !contained(fixtureRoot, file) || path.extname(file) !== '.js')) {
        fail('P5_INTEGRATION_FIXTURE_BOUNDARY', 'P5 fixture escaped its isolated test root.');
      }
      const result = childProcess.spawnSync(process.execPath, ['--test', ...files], {
        cwd: options.serviceRoot, encoding: 'utf8', timeout: 120000, maxBuffer: 10 * 1024 * 1024,
        env: { NODE_ENV: 'test', NODE_PATH: process.env.NODE_PATH || '' }
      });
      return Object.freeze({ ok: result.status === 0, status: result.status, files: Object.freeze([...fixtureNames]),
        output: result.status === 0 ? undefined : String(result.stdout || '') + String(result.stderr || '') });
    }
  });
}

async function verifyP5IsolatedIntegration(options) {
  if (!options || typeof options.serviceRoot !== 'string' || typeof options.tempRoot !== 'string' ||
      !options.fixtureRunner || typeof options.fixtureRunner.run !== 'function' ||
      !options.runtimeVerifier || typeof options.runtimeVerifier.verify !== 'function') {
    fail('P5_INTEGRATION_OPTIONS', 'P5 integration verifier dependencies are incomplete.');
  }
  if (!path.isAbsolute(options.serviceRoot) || !path.isAbsolute(options.tempRoot) ||
      !contained(os.tmpdir(), options.tempRoot) || path.resolve(options.tempRoot).startsWith(path.resolve(options.serviceRoot) + path.sep)) {
    fail('P5_INTEGRATION_TEMP_BOUNDARY', 'P5 integration verifier requires an owned OS temporary root outside the service.');
  }
  const fixtures = options.fixtureRunner.run(REQUIRED_FIXTURES);
  if (!fixtures || fixtures.ok !== true || fixtures.status !== 0 ||
      JSON.stringify(fixtures.files) !== JSON.stringify(REQUIRED_FIXTURES)) {
    fail('P5_INTEGRATION_FIXTURES_FAILED', 'P5 isolated fixture coverage failed.', { fixtures });
  }
  const runtime = await options.runtimeVerifier.verify(Object.freeze({ tempRoot: path.join(options.tempRoot, 'runtime') }));
  if (!runtime || runtime.ok !== true || runtime.scenarioCount !== 31 || !Array.isArray(runtime.scenarios)) {
    fail('P5_INTEGRATION_RUNTIME_FAILED', 'P4 recovery verifier did not return the complete accepted matrix.');
  }
  const boundaryScenarios = BOUNDARIES.map((expected) => {
    const actual = runtime.scenarios.find((item) => item.effectClass === expected.effectClass && item.crashPoint === expected.crashPoint);
    if (!actual || actual.decision !== expected.decision || actual.dispatchCount !== 1) {
      fail('P5_INTEGRATION_BOUNDARY_RECOVERY', 'P5 boundary did not converge through the accepted P4 recovery contract.', { expected, actual });
    }
    return Object.freeze({ ...expected, dispatchCount: actual.dispatchCount });
  });
  return Object.freeze({
    ok: true,
    fixtureCount: REQUIRED_FIXTURES.length,
    fixtures: Object.freeze([...REQUIRED_FIXTURES]),
    recoveryScenarioCount: runtime.scenarioCount,
    boundaryScenarios: Object.freeze(boundaryScenarios),
    prohibitedActionsRun: Object.freeze([])
  });
}

module.exports = Object.freeze({
  BOUNDARIES,
  P5IntegrationVerificationError,
  REQUIRED_FIXTURES,
  createNodeFixtureRunner,
  verifyP5IsolatedIntegration
});
