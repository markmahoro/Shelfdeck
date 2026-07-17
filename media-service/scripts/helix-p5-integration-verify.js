'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const { createNodeFixtureRunner, verifyP5IsolatedIntegration } = require('./helix-architecture/p5-integration-verifier');
const { verifyP4RuntimeCrossProcess } = require('./helix-architecture/p4-runtime-verifier');

const serviceRoot = path.resolve(__dirname, '..');
const generatedRoot = path.join(serviceRoot, 'src', 'helix', 'foundation', 'persistence', 'generated');

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-p5-integration-'));
  let integration;
  let failure;
  try {
    const schemaDdl = fs.readFileSync(path.join(generatedRoot, 'clean-schema.sql'), 'utf8');
    const schemaManifest = JSON.parse(fs.readFileSync(path.join(generatedRoot, 'clean-schema.manifest.json'), 'utf8'));
    integration = await verifyP5IsolatedIntegration({
      serviceRoot,
      tempRoot,
      fixtureRunner: createNodeFixtureRunner({ serviceRoot }),
      runtimeVerifier: { verify: ({ tempRoot: runtimeRoot }) => {
        fs.mkdirSync(runtimeRoot, { recursive: true });
        return verifyP4RuntimeCrossProcess({
          Database, tempRoot: runtimeRoot, serviceRoot, schemaDdl, schemaManifest,
          workerPath: path.join(serviceRoot, 'scripts', 'helix-architecture', 'p4-crash-worker.js')
        });
      } }
    });
  } catch (error) {
    failure = { code: error.code || 'P5_INTEGRATION_UNEXPECTED_FAILURE', message: error.message, details: error.details };
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
  const result = {
    ok: !failure && integration && integration.ok,
    scope: 'P5_LOCAL_CROSS_PLATFORM_ISOLATED_INTEGRATION',
    integration,
    prohibitedActionsRun: [],
    failure
  };
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  if (!result.ok) process.exitCode = 1;
}

main();
