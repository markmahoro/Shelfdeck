'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { initializeCleanData } = require('./helix-operational-safety');
const { createCleanServiceHost } = require('../src/clean-service-host');
const { canonicalDigest } = require('../src/helix/contracts/canonical-json');

const TMDB_ENDPOINT = 'https://api.themoviedb.org/3';
const FACT_RESULT_SCHEMA =
  'helix://contracts/capabilities/libra.routing.fact.observe/v1/result';
const SOURCE_ENV = 'HELIX_REAL_ROUTING_MEDIA_SOURCE';
const CREDENTIAL_ENV = 'HELIX_TMDB_API_KEY';
const MOVIE_TITLE = 'The Shawshank Redemption';
const EXPECTED_PROVIDER_KEY = '278';
const EXPECTED_RELEASE_YEAR = 1994;
let activeCanaryRoot = null;

function fail(message) {
  const error = new Error(message);
  error.code = 'HELIX_REAL_ROUTING_E2E_INVALID';
  throw error;
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (typeof value !== 'string' || !value.trim()) {
    fail(`${name} is required.`);
  }
  return value.trim();
}

function assertSafeSource(sourcePath) {
  const resolved = path.resolve(sourcePath);
  const temporaryRoot = path.resolve(os.tmpdir());
  const relative = path.relative(temporaryRoot, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    fail('The real Routing E2E source must be inside the system Temp root.');
  }
  if (!fs.statSync(resolved).isFile()) {
    fail('The real Routing E2E source must be one regular file.');
  }
  if (path.extname(resolved).toLowerCase() !== '.mkv') {
    fail('The real Routing E2E source must be an MKV fixture.');
  }
  return resolved;
}

function digestFile(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function sourceReality(root) {
  const entries = [];
  const pending = [root];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(target);
      else if (entry.isFile()) {
        const stat = fs.statSync(target);
        entries.push(Object.freeze({
          relativeLocation: path.relative(root, target).replaceAll('\\', '/'),
          sizeBytes: stat.size,
          contentDigest: digestFile(target),
        }));
      }
    }
  }
  entries.sort((left, right) =>
    Buffer.from(left.relativeLocation, 'utf8')
      .compare(Buffer.from(right.relativeLocation, 'utf8')));
  return Object.freeze({
    regularFileCount: entries.length,
    digest: canonicalDigest({
      schema: 'helix.real-routing-e2e-source-reality@1',
      entries,
    }),
  });
}

async function adminSession(host, apiKey) {
  const response = await host.inject({
    method: 'POST',
    url: '/v1/admin/session',
    headers: { 'x-api-key': apiKey },
  });
  assert.equal(response.statusCode, 204, response.body);
  return response.headers['set-cookie'];
}

function fieldCommand(fieldId, root) {
  const policyValue = Object.freeze({
    includedDirectories: [],
    excludedDirectories: [],
    allowedExtensions: ['.mkv'],
    minimumSizeBytes: 0,
    excludedMaterialKeys: [],
  });
  const access = Object.freeze({
    fieldId,
    revision: 1,
    endpointId: `${fieldId}-endpoint`,
    rootLocation: root,
    mountScopeId: `${fieldId}-mount`,
    mountScopeRevision: 1,
    accessSchemaRef: 'helix://e2e/real-routing-field-access/v1',
  });
  return Object.freeze({
    idempotencyKey: `${fieldId}-register`,
    fieldId,
    name: 'Real TMDB Routing Field',
    contentProfileHint: 'movie',
    policy: Object.freeze({
      extractionPolicyId: `${fieldId}-policy`,
      revision: 1,
      policySchemaRef: 'helix://contracts/domain-types/ExtractionPolicy/v1',
      policy: policyValue,
      policyDigest: canonicalDigest({
        extractionPolicyId: `${fieldId}-policy`,
        revision: 1,
        ...policyValue,
      }),
    }),
    access: Object.freeze({ ...access, accessDigest: canonicalDigest(access) }),
  });
}

async function createShelf(host, cookie, root, shelfId, name) {
  fs.mkdirSync(root, { recursive: true });
  const response = await host.inject({
    method: 'POST',
    url: '/v1/admin/shelves',
    headers: { cookie },
    payload: {
      idempotencyKey: `${shelfId}-create`,
      shelfId,
      name,
      targetRootLocation: root,
      ruleTemplateId: 'system-beta-recommended',
      expectedTemplateRevision: 1,
      placementPolicy: {
        folderTemplate: '{title} ({year})',
        collisionPolicy: 'reject',
      },
    },
  });
  assert.equal(response.statusCode, 201, response.body);
}

async function configureTmdb(host, cookie, credential) {
  const tested = await host.inject({
    method: 'POST',
    url: '/v1/admin/settings/integrations/tmdb/actions/test',
    headers: { cookie },
    payload: {
      kind: 'tmdb',
      idempotencyKey: 'real-routing-tmdb-test',
      endpoint: TMDB_ENDPOINT,
      credential: { kind: 'api_key', value: credential },
      timeoutMs: 10_000,
    },
  });
  assert.equal(tested.statusCode, 200, tested.body);
  const proof = tested.json();
  assert.equal(proof.result, 'passed');
  assert.equal(proof.persisted, false);
  assert.equal(typeof proof.connectionProofId, 'string');

  const configured = await host.inject({
    method: 'PATCH',
    url: '/v1/admin/settings/integrations/tmdb',
    headers: { cookie },
    payload: {
      kind: 'tmdb',
      idempotencyKey: 'real-routing-tmdb-save',
      expectedConfigRevision: 0,
      connectionProofId: proof.connectionProofId,
    },
  });
  assert.equal(configured.statusCode, 200, configured.body);
  assert.equal(configured.json().state, 'active');
  assert.equal(configured.json().configRevision, 1);
  return Object.freeze({
    capabilityCodes: proof.capabilityCodes,
    configRevision: configured.json().configRevision,
    state: configured.json().state,
  });
}

async function createField(host, cookie, fieldId, fieldRoot) {
  const response = await host.inject({
    method: 'POST',
    url: '/v1/admin/material-fields',
    headers: { cookie },
    payload: fieldCommand(fieldId, fieldRoot),
  });
  assert.equal(response.statusCode, 201, response.body);
}

async function publishPolicy(host, cookie, fieldId) {
  const response = await host.inject({
    method: 'PATCH',
    url: `/v1/admin/routing/material-fields/${fieldId}`,
    headers: { cookie },
    payload: {
      idempotencyKey: 'real-routing-policy-publish',
      fieldId,
      expectedPolicyId: null,
      expectedRevision: 0,
      policy: {
        routingPolicyId: 'real-routing-policy',
        mode: 'sorting',
        targets: [
          {
            shelfId: 'real-routing-classics',
            rank: 1,
            matchExpression: {
              nodeKind: 'predicate',
              factKind: 'release_year',
              operator: 'lte',
              expectedValue: 1999,
            },
          },
          {
            shelfId: 'real-routing-general',
            rank: 2,
            matchExpression: { nodeKind: 'always' },
          },
        ],
      },
    },
  });
  assert.equal(response.statusCode, 200, response.body);
}

async function observe(host, cookie, fieldId) {
  const response = await host.inject({
    method: 'POST',
    url: `/v1/admin/material-fields/${fieldId}/actions/observe`,
    headers: { cookie },
    payload: {
      idempotencyKey: 'real-routing-observe',
      fieldId,
      expectedAccessRevision: 1,
      expectedObservationRevision: 0,
      pageBudget: 8,
    },
  });
  assert.equal(response.statusCode, 202, response.body);
}

async function waitForResolved(host, cookie, runtimeFailure) {
  const deadline = Date.now() + 120_000;
  let formation = null;
  while (Date.now() < deadline) {
    if (runtimeFailure()) throw runtimeFailure();
    const response = await host.inject({
      method: 'GET',
      url: '/v1/admin/formation',
      headers: { cookie },
    });
    assert.equal(response.statusCode, 200, response.body);
    formation = response.json();
    if (formation.summary.subjectCount === 1 &&
        formation.summary.resolvedCount === 1) {
      return formation;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  fail(`Routing did not resolve within 120 seconds: ${JSON.stringify(formation?.summary || null)}`);
}

function inspectDatabase(databasePath) {
  const database = new Database(databasePath, { readonly: true });
  try {
    const resultRows = database.prepare(
      'SELECT result_id,event_id,result_json,result_digest ' +
      'FROM fx_event_result_bindings WHERE result_schema_ref=?',
    ).all(FACT_RESULT_SCHEMA);
    assert.equal(resultRows.length, 1);
    const observation = JSON.parse(resultRows[0].result_json);
    assert.equal(canonicalDigest(observation), resultRows[0].result_digest);
    assert.equal(observation.result, 'observed');
    assert.equal(observation.sourceKind, 'provider');
    const yearFact = observation.facts.find((fact) =>
      fact.factKind === 'release_year');
    assert.ok(yearFact);
    assert.equal(yearFact.year, EXPECTED_RELEASE_YEAR);
    assert.equal(yearFact.sourceObjectId, EXPECTED_PROVIDER_KEY);

    const scalar = (sql, ...parameters) =>
      database.prepare(sql).get(...parameters).count;
    return Object.freeze({
      integrityCheck: database.pragma('integrity_check', { simple: true }),
      providerObservation: Object.freeze({
        result: observation.result,
        sourceKind: observation.sourceKind,
        sourceRef: observation.sourceRef,
        candidateMatchCount: observation.candidateMatchCount,
        providerKey: yearFact.sourceObjectId,
        releaseYear: yearFact.year,
        observationDigest: observation.observationDigest,
      }),
      counts: Object.freeze({
        subjects: scalar('SELECT COUNT(*) count FROM libra_subjects'),
        resolvedDecisions: scalar(
          "SELECT COUNT(*) count FROM libra_routing_decisions WHERE decision='resolved'",
        ),
        routingWorks: scalar(
          "SELECT COUNT(*) count FROM fx_supporting_works WHERE process_type='libra_routing'",
        ),
        workflowPlans: scalar(
          'SELECT COUNT(*) count FROM fx_workflow_plans plan ' +
          'JOIN fx_work_attempts attempt ON attempt.attempt_id=plan.attempt_id ' +
          'WHERE attempt.work_id IN ' +
          "(SELECT work_id FROM fx_supporting_works WHERE process_type='libra_routing')",
        ),
        providerEvents: scalar(
          "SELECT COUNT(*) count FROM fx_workflow_events WHERE capability_ref='libra.routing.fact.observe@1'",
        ),
        providerAttempts: scalar(
          'SELECT COUNT(*) count FROM fx_event_attempts WHERE event_id IN ' +
          "(SELECT event_id FROM fx_workflow_events WHERE capability_ref='libra.routing.fact.observe@1')",
        ),
        providerResults: resultRows.length,
        acceptanceSpecs: scalar('SELECT COUNT(*) count FROM libra_acceptance_specs'),
        libraRuns: scalar('SELECT COUNT(*) count FROM libra_runs'),
        workspaces: scalar('SELECT COUNT(*) count FROM libra_workspaces'),
        arcaShelfEntries: scalar('SELECT COUNT(*) count FROM arca_shelf_entries'),
      }),
    });
  } finally {
    database.close();
  }
}

async function main() {
  const startedAtMs = Date.now();
  const mediaSource = assertSafeSource(requiredEnvironment(SOURCE_ENV));
  const credential = requiredEnvironment(CREDENTIAL_ENV);
  const canaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-real-routing-e2e-'));
  activeCanaryRoot = canaryRoot;
  const dataDir = path.join(canaryRoot, 'data');
  const adminDistDir = path.join(canaryRoot, 'admin');
  const fieldRoot = path.join(canaryRoot, 'material-field');
  const movieRoot = path.join(fieldRoot, MOVIE_TITLE);
  const shelfRoot = path.join(canaryRoot, 'shelves');
  const databasePath = path.join(dataDir, 'shelfdeck.db');
  fs.mkdirSync(adminDistDir, { recursive: true });
  fs.mkdirSync(movieRoot, { recursive: true });
  fs.writeFileSync(path.join(adminDistDir, 'index.html'), '<div id="root"></div>');
  fs.copyFileSync(mediaSource, path.join(movieRoot, `${MOVIE_TITLE}.mkv`));
  const sourceBefore = sourceReality(fieldRoot);
  const secretRoot = `real-routing-e2e-${crypto.randomUUID()}`;
  const initialized = initializeCleanData({
    dataDir,
    confirmation: 'INITIALIZE_HELIX_CLEAN_V1',
    secretRoot,
  });
  let runtimeError = null;
  const hostOptions = {
    dataDir,
    adminDistDir,
    secretRoot,
    onExecutionRuntimeError(error) { runtimeError = error; },
  };
  let host = await createCleanServiceHost(hostOptions);
  let targetSubject;
  let integrationEvidence;
  let beforeRestart;
  try {
    let cookie = await adminSession(host, initialized.adminApiKey);
    integrationEvidence = await configureTmdb(host, cookie, credential);
    await createField(host, cookie, 'real-routing-field', fieldRoot);
    await createShelf(
      host,
      cookie,
      path.join(shelfRoot, 'classics'),
      'real-routing-classics',
      'Real Routing Classics',
    );
    await createShelf(
      host,
      cookie,
      path.join(shelfRoot, 'general'),
      'real-routing-general',
      'Real Routing General',
    );
    await publishPolicy(host, cookie, 'real-routing-field');
    await observe(host, cookie, 'real-routing-field');
    const formation = await waitForResolved(host, cookie, () => runtimeError);
    targetSubject = formation.items[0];
    assert.equal(targetSubject.displayIdentity, MOVIE_TITLE);
    assert.equal(targetSubject.routingState, 'resolved');
    assert.equal(targetSubject.targetShelfId, 'real-routing-classics');
    beforeRestart = inspectDatabase(databasePath);
    assert.equal(beforeRestart.integrityCheck, 'ok');
    assert.deepEqual(beforeRestart.counts, {
      subjects: 1,
      resolvedDecisions: 1,
      routingWorks: 2,
      workflowPlans: 2,
      providerEvents: 1,
      providerAttempts: 1,
      providerResults: 1,
      acceptanceSpecs: 0,
      libraRuns: 0,
      workspaces: 0,
      arcaShelfEntries: 0,
    });

    await host.close();
    host = await createCleanServiceHost(hostOptions);
    cookie = await adminSession(host, initialized.adminApiKey);
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.ifError(runtimeError);
    const recovered = await host.inject({
      method: 'GET',
      url: '/v1/admin/formation',
      headers: { cookie },
    });
    assert.equal(recovered.statusCode, 200, recovered.body);
    assert.deepEqual(recovered.json().summary, {
      subjectCount: 1,
      preparingCount: 0,
      unresolvedCount: 0,
      resolvedCount: 1,
    });
    const afterRestart = inspectDatabase(databasePath);
    assert.deepEqual(afterRestart, beforeRestart);
    const sourceAfter = sourceReality(fieldRoot);
    assert.deepEqual(sourceAfter, sourceBefore);

    const report = Object.freeze({
      schema: 'helix.real-routing-e2e-report@1',
      result: 'passed',
      realExternalProvider: true,
      provider: 'tmdb',
      endpoint: TMDB_ENDPOINT,
      integration: integrationEvidence,
      source: Object.freeze({
        before: sourceBefore,
        after: sourceAfter,
        unchanged: true,
      }),
      routing: Object.freeze({
        displayIdentity: targetSubject.displayIdentity,
        decision: targetSubject.routingState,
        targetShelfId: targetSubject.targetShelfId,
        providerObservation: beforeRestart.providerObservation,
      }),
      execution: beforeRestart.counts,
      recovery: Object.freeze({
        restarted: true,
        duplicateFactsAfterRestart: false,
      }),
      safety: Object.freeze({
        acceptanceSpecs: 0,
        libraRuns: 0,
        workspaces: 0,
        arcaShelfEntries: 0,
      }),
      elapsedMs: Date.now() - startedAtMs,
      canaryRoot,
      databasePath,
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    await host.close();
  }
}

main().catch((error) => {
  process.stderr.write(JSON.stringify({
    result: 'failed',
    code: error.code || 'HELIX_REAL_ROUTING_E2E_FAILED',
    message: error.message,
    canaryRoot: activeCanaryRoot,
  }) + '\n');
  process.exitCode = 1;
});
