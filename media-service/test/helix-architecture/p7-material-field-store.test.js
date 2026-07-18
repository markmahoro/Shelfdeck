'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const { createMaterialFieldStore } = require('../../src/helix/domains/procurement/persistence/material-field-store');

const generatedRoot = path.resolve(__dirname, '../../src/helix/foundation/persistence/generated');
const schemaDdl = fs.readFileSync(path.join(generatedRoot, 'clean-schema.sql'), 'utf8');
const schemaManifest = JSON.parse(fs.readFileSync(path.join(generatedRoot, 'clean-schema.manifest.json'), 'utf8'));

function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-proc-field-')); let now = 1_700_030_000_000;
  const kernel = openSqliteKernel({ Database, databasePath: path.join(root, 'shelfdeck.db'), schemaDdl, schemaManifest, now: () => now++ });
  const store = createMaterialFieldStore({ schemaManifest, unitOfWork: createSqliteUnitOfWork({ kernel }) });
  try { return run({ store, kernel }); } finally { kernel.close(); fs.rmSync(root, { recursive: true, force: true }); }
}
function policy(revision, value = revision) { const body = { includedDirectories:[`title-${value}`], excludedDirectories:[], allowedExtensions:[], minimumSizeBytes:0, excludedMaterialKeys:[] }; return {
  extractionPolicyId: 'policy-1', revision, policySchemaRef: 'helix://contracts/domain-types/ExtractionPolicy/v1', policy: body,
  policyDigest: canonicalDigest({ extractionPolicyId:'policy-1', revision, ...body })
}; }
function access(revision, root = `/field/${revision}`) { const basis = { fieldId: 'field-1', revision, endpointId: 'endpoint-1', rootLocation: root,
  mountScopeId: 'mount-1', mountScopeRevision: revision, accessSchemaRef: 'helix://fixtures/field-access/v1' }; return { ...basis, accessDigest: canonicalDigest(basis) }; }
function registration(overrides = {}) { return { fieldId: 'field-1', name: 'Incoming', policy: policy(1), access: access(1), ...overrides }; }

test('binds MaterialFieldRepository to exactly the three P7-02 tables', () => fixture(({ store }) => {
  assert.equal(store.repositoryManifest.component, 'MaterialFieldRepository');
  assert.deepEqual(store.repositoryManifest.tableIds, ['proc_extraction_policy_revisions','proc_field_access_revisions','proc_material_fields']);
}));

test('registers Policy, Field and Access atomically with resolved non-null heads', () => fixture(({ store }) => {
  const result = store.registerMaterialField(registration());
  assert.equal(result.status, 'active'); assert.equal(result.currentAccessRevision, 1); assert.equal(result.access.rootLocation, '/field/1');
  assert.equal(result.extractionPolicyRevision, 1); assert.deepEqual(store.listMaterialFields().map((item) => item.fieldId), ['field-1']);
  assert.equal(Object.isFrozen(result.policy.policy), true); assert.equal(Object.isFrozen(result.policy.policy.includedDirectories), true);
}));

test('advances Access and Policy only by exact current revision CAS', () => fixture(({ store }) => {
  store.registerMaterialField(registration());
  const withAccess = store.reviseFieldAccess({ fieldId: 'field-1', expectedAccessRevision: 1, access: access(2) });
  assert.equal(withAccess.currentAccessRevision, 2);
  const withPolicy = store.publishExtractionPolicy({ fieldId: 'field-1', expectedPolicyId: 'policy-1', expectedPolicyRevision: 1, policy: policy(2) });
  assert.equal(withPolicy.extractionPolicyRevision, 2);
  assert.throws(() => store.reviseFieldAccess({ fieldId: 'field-1', expectedAccessRevision: 1, access: access(2, '/stale') }), (error) => error.code === 'P7_FIELD_ACCESS_REVISION_CONFLICT');
  assert.throws(() => store.publishExtractionPolicy({ fieldId: 'field-1', expectedPolicyId: 'policy-1', expectedPolicyRevision: 1, policy: policy(2, 'stale') }), (error) => error.code === 'P7_EXTRACTION_POLICY_REVISION_CONFLICT');
}));

test('rejects digest tamper and rolls back the entire registration', () => fixture(({ store }) => {
  const bad = access(1); bad.accessDigest = '0'.repeat(64);
  assert.throws(() => store.registerMaterialField(registration({ access: bad })), (error) => error.code === 'P7_FIELD_ACCESS_DIGEST_MISMATCH');
  assert.equal(store.getMaterialField('field-1'), null);
  const oversized = { includedDirectories:Array.from({ length:129 }, (_, index) => `title-${String(index).padStart(3,'0')}`), excludedDirectories:[], allowedExtensions:[], minimumSizeBytes:0, excludedMaterialKeys:[] };
  assert.throws(() => store.registerMaterialField(registration({ policy: { ...policy(1), policy: oversized,
    policyDigest: canonicalDigest({ extractionPolicyId:'policy-1', revision:1, ...oversized }) } })),
    (error) => error.code === 'P7_EXTRACTION_POLICY_INVALID');
  assert.equal(store.getMaterialField('field-1'), null);
}));

test('disables non-destructively and rejects later revisions', () => fixture(({ store }) => {
  store.registerMaterialField(registration());
  const disabled = store.disableMaterialField({ fieldId: 'field-1', expectedAccessRevision: 1, expectedPolicyRevision: 1 });
  assert.equal(disabled.status, 'disabled'); assert.equal(disabled.access.revision, 1); assert.equal(disabled.policy.revision, 1);
  assert.throws(() => store.reviseFieldAccess({ fieldId: 'field-1', expectedAccessRevision: 1, access: access(2) }), (error) => error.code === 'P7_MATERIAL_FIELD_DISABLED');
}));

test('duplicate Field and skipped initial revisions fail closed', () => fixture(({ store }) => {
  store.registerMaterialField(registration());
  assert.throws(() => store.registerMaterialField(registration()), (error) => error.code === 'P7_MATERIAL_FIELD_EXISTS');
  const otherBasis = { fieldId: 'field-2', revision: 2, endpointId: 'endpoint-1', rootLocation: '/field/2',
    mountScopeId: 'mount-1', mountScopeRevision: 2, accessSchemaRef: 'helix://fixtures/field-access/v1' };
  const otherAccess = { ...otherBasis, accessDigest: canonicalDigest(otherBasis) };
  assert.throws(() => store.registerMaterialField({ fieldId: 'field-2', name: 'Other', policy: { ...policy(1), extractionPolicyId: 'policy-2' }, access: otherAccess }),
    (error) => ['P7_EXTRACTION_POLICY_DIGEST_MISMATCH','P7_FIELD_ACCESS_DIGEST_MISMATCH','P7_MATERIAL_FIELD_INITIAL_BASIS'].includes(error.code));
}));
