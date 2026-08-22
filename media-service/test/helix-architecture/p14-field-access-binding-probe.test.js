'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const {
  CleanFieldAccessProbeError,
  createCleanFieldAccessBindingProbe,
} = require('../../src/clean-field-access-binding-probe');
const {
  createCleanFieldObservationEnumerator,
} = require('../../src/clean-field-observation-enumerator');
const { createFieldObservationPlanner } = require('../../src/helix/domains/procurement/planning/field-observation-planner');
const { createProcurementAdminApplication } = require('../../src/helix/domains/procurement/application/admin-facade');
const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');

const generatedRoot = path.resolve(__dirname, '../../src/helix/foundation/persistence/generated');
const schemaDdl = fs.readFileSync(path.join(generatedRoot, 'clean-schema.sql'), 'utf8');
const schemaManifest = JSON.parse(fs.readFileSync(path.join(generatedRoot, 'clean-schema.manifest.json'), 'utf8'));

function policyValue(overrides = {}) {
  return {
    includedDirectories: [],
    excludedDirectories: [],
    allowedExtensions: ['.mkv'],
    minimumSizeBytes: 0,
    excludedMaterialKeys: [],
    ...overrides,
  };
}

function registration(rootLocation, overrides = {}) {
  const value = policyValue(overrides.policyValue);
  const accessBasis = {
    fieldId: overrides.fieldId || 'field-1',
    revision: 1,
    endpointId: 'endpoint-1',
    rootLocation,
    mountScopeId: 'mount-1',
    mountScopeRevision: 1,
    accessSchemaRef: 'helix://fixtures/field-access/v1',
  };
  return {
    idempotencyKey: overrides.idempotencyKey || 'field-register-1',
    fieldId: accessBasis.fieldId,
    name: 'Movie Field',
    contentProfileHint: 'movie',
    policy: {
      extractionPolicyId: 'policy-1',
      revision: 1,
      policySchemaRef: 'helix://contracts/domain-types/ExtractionPolicy/v1',
      policy: value,
      policyDigest: canonicalDigest({ extractionPolicyId: 'policy-1', revision: 1, ...value }),
    },
    access: { ...accessBasis, accessDigest: canonicalDigest(accessBasis) },
  };
}

test('Field Access Binding probe requires an absolute reachable readable directory and containment', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-field-probe-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const directory = path.join(root, 'movies');
  const filePath = path.join(root, 'not-a-dir.mkv');
  fs.mkdirSync(directory);
  fs.writeFileSync(filePath, 'bytes');
  const probe = createCleanFieldAccessBindingProbe();
  assert.equal(probe.inspect({
    fieldId: 'field-1',
    rootLocation: directory,
    includedDirectories: [],
    excludedDirectories: [],
  }).directoryReadable, true);
  assert.throws(
    () => probe.inspect({ fieldId: 'field-1', rootLocation: 'relative-movies' }),
    (error) => error instanceof CleanFieldAccessProbeError && error.code === 'FIELD_ACCESS_ROOT_ABSOLUTE',
  );
  assert.throws(
    () => probe.inspect({ fieldId: 'field-1', rootLocation: path.join(root, 'missing') }),
    (error) => error.code === 'FIELD_ACCESS_ROOT_UNAVAILABLE',
  );
  assert.throws(
    () => probe.inspect({ fieldId: 'field-1', rootLocation: filePath }),
    (error) => error.code === 'FIELD_ACCESS_ROOT_NOT_DIRECTORY',
  );
  assert.throws(
    () => probe.inspect({
      fieldId: 'field-1',
      rootLocation: directory,
      includedDirectories: ['../escape'],
    }),
    (error) => error.code === 'FIELD_ACCESS_PATH_CONTAINMENT',
  );
});

test('Field enumerator enumeratePage fail-closes a missing Observation root', async (t) => {
  const missing = path.join(os.tmpdir(), 'helix-field-missing-root-' + process.pid);
  assert.equal(fs.existsSync(missing), false);
  const enumerator = createCleanFieldObservationEnumerator({ now: () => 1000 });
  await assert.rejects(
    enumerator.enumeratePage({
      fieldAccessHandle: {
        handleId: 'handle-1',
        accessDigest: 'a'.repeat(64),
        rootLocation: missing,
        mountScopeId: 'mount-1',
      },
      pageRequest: { cursorIn: null, pageBudget: 8 },
    }),
    (error) => error.code === 'FIELD_OBSERVATION_ROOT_UNAVAILABLE',
  );
});

test('Procurement Admin rejects an unreachable Field root before Access Binding save', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-field-admin-probe-'));
  const reachable = path.join(root, 'movies');
  fs.mkdirSync(reachable);
  const kernel = openSqliteKernel({
    Database,
    databasePath: path.join(root, 'shelfdeck.db'),
    schemaDdl,
    schemaManifest,
    now: () => 1_700_040_000_000,
  });
  t.after(() => {
    kernel.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const probe = createCleanFieldAccessBindingProbe();
  const admin = createProcurementAdminApplication({
    schemaManifest,
    unitOfWork: createSqliteUnitOfWork({ kernel }),
    executionRuntimeHost: { wake() {} },
    probeFieldAccess: (request) => probe.inspect(request),
  });
  const actor = { credentialRevision: 1 };
  assert.throws(
    () => admin.registerMaterialField(registration(path.join(root, 'missing')), actor),
    (error) => error.code === 'ADMIN_FIELD_COMMAND_REJECTED' &&
      error.details.reasonCode === 'FIELD_ACCESS_ROOT_UNAVAILABLE' &&
      /不存在或当前不可读取/.test(error.message),
  );
  const created = admin.registerMaterialField(registration(reachable), actor);
  assert.equal(created.materialField.status, 'active');
  assert.equal(created.materialField.access.rootLocation, reachable);
});

test('Field Observation Planner fail-closes a missing root as contract_unplannable', () => {
  const planner = createFieldObservationPlanner({
    registry: { snapshot: [] },
    policyRegistry: { digest: 'a'.repeat(64) },
    progressReader: { read: () => ({ completed: false, nextPageOrdinal: 0, cursorIn: null, expectedObservationRevision: null }) },
    materialFieldStore: {
      getMaterialField: () => ({
        fieldId: 'field-1',
        status: 'active',
        access: { revision: 1, accessDigest: 'b'.repeat(64), endpointId: 'e', rootLocation: '/missing', mountScopeId: 'm', mountScopeRevision: 1 },
        currentProfileHintSnapshot: { fieldId: 'field-1', revision: 1, contentProfileHint: 'movie', hintDigest: 'c'.repeat(64) },
        currentObservationRevision: 0,
      }),
    },
    now: () => 1,
    inspectFieldRoot() {
      const error = new Error('Material Field当前物理访问位置不可读。');
      error.code = 'FIELD_OBSERVATION_ROOT_UNAVAILABLE';
      throw error;
    },
  });
  const plan = planner.plan({
    processId: 'field-1',
    workId: 'work-1',
    workAttemptId: 'attempt-1',
    executionBasisDigest: 'd'.repeat(64),
  });
  assert.equal(plan.resolution, 'contract_unplannable');
  assert.equal(plan.diagnosticClassification, 'FIELD_OBSERVATION_ROOT_UNAVAILABLE');
  assert.deepEqual(plan.nodes, []);
});
