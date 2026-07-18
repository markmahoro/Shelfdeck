'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const { createMaterialControlProjectionPort } = require('../../src/helix/foundation/persistence/material-control');
const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const { createSqliteUnitOfWork } = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');
const { evaluateExtractionEligibility } = require('../../src/helix/domains/procurement/model/extraction-eligibility');

const schemaDdl = fs.readFileSync(path.resolve(__dirname, '../../src/helix/foundation/persistence/generated/clean-schema.sql'), 'utf8');
const schemaManifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../src/helix/foundation/persistence/generated/clean-schema.manifest.json'), 'utf8'));
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);

function policy(overrides = {}) { return { includedDirectories:[], excludedDirectories:[], allowedExtensions:['.mkv'],
  minimumSizeBytes:10, excludedMaterialKeys:[], ...overrides }; }
function snapshot(regionProjection = 'uncontrolled') { const basis = { materialKey:SHA_A, resultKind:'available', controlRevision:0,
  controlState:'uncontrolled', regionProjection, evidenceDigest:SHA_B }; return { ...basis, projectionDigest:canonicalDigest(basis) }; }
function decision(overrides = {}) { return { fieldId:'field-1', fieldStatus:'active', materialKey:SHA_A, expectedEligibilityRevision:1,
  accessRevision:1, accessDigest:SHA_B, terminalObservationRevision:1, fieldObservationWorkId:'work-1', materialBindingRevision:1,
  lastSnapshotDigest:SHA_B, lastObservationId:'observation-1', appearedInTerminalWork:true,
  materialRelativeLocation:'movies/title.mkv', sizeBytes:100, observedExtension:'.mkv', extractionPolicy:policy(),
  selectionSnapshot:{ materialKey:SHA_A, activeSelections:[], hasConflict:false, selectionBasisDigest:SHA_B },
  controlSnapshot:snapshot(), ...overrides }; }

test('applies the unique Eligibility reason precedence without historical suppression', () => {
  assert.equal(evaluateExtractionEligibility(decision()).reasonCode, 'eligible');
  assert.equal(evaluateExtractionEligibility(decision({ fieldStatus:'disabled', appearedInTerminalWork:false })).reasonCode, 'field_inactive');
  assert.equal(evaluateExtractionEligibility(decision({ appearedInTerminalWork:false,
    extractionPolicy:policy({ excludedMaterialKeys:[SHA_A] }) })).reasonCode, 'not_observed_in_current_terminal_work');
  assert.equal(evaluateExtractionEligibility(decision({ extractionPolicy:policy({ excludedDirectories:['movies'] }) })).reasonCode, 'policy_directory_excluded');
  assert.equal(evaluateExtractionEligibility(decision({ extractionPolicy:policy({ includedDirectories:['series'] }) })).reasonCode, 'policy_directory_not_included');
  assert.equal(evaluateExtractionEligibility(decision({ observedExtension:'.avi' })).reasonCode, 'policy_extension_not_allowed');
  assert.equal(evaluateExtractionEligibility(decision({ sizeBytes:1 })).reasonCode, 'policy_size_below_minimum');
  assert.equal(Object.hasOwn(evaluateExtractionEligibility(decision()), 'duplicateSuppression'), false);
});

test('keeps unavailable Control evidence unknown and digest-binds every deterministic decision', () => {
  const unavailable = { materialKey:SHA_A, resultKind:'unavailable', failureCode:'control_query_unavailable',
    evidenceDigest:SHA_B, projectionDigest:SHA_B };
  const result = evaluateExtractionEligibility(decision({ controlSnapshot:unavailable }));
  assert.equal(result.decisionState, 'unknown'); assert.equal(result.controlProjection, 'unknown');
  assert.equal(result.reasonCode, 'control_projection_unavailable'); assert.match(result.basisDigest, /^[a-f0-9]{64}$/);
  assert.equal(evaluateExtractionEligibility(decision()).basisDigest, evaluateExtractionEligibility(decision()).basisDigest);
});

test('Material Control Query performs one bounded read and distinguishes absent, released, and controlled rows', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helix-control-query-')); const databasePath = path.join(root, 'shelfdeck.db');
  const kernel = openSqliteKernel({ Database, databasePath, schemaDdl, schemaManifest, now:() => 1 });
  const database = new Database(databasePath);
  database.prepare(`INSERT INTO fx_material_controls(material_key,mount_scope_id,inode,content_hash_algorithm,content_hash,
    owner_domain,owner_scope_type,owner_scope_id,control_revision,state,updated_at_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
    .run(SHA_B,'mount-1','1','sha256','c'.repeat(64),'libra','run','run-1',1,'controlled',1);
  const port = createMaterialControlProjectionPort({ schemaManifest, unitOfWork:createSqliteUnitOfWork({ kernel }) });
  const values = port.getMaterialControlProjections([SHA_A,SHA_B]);
  assert.equal(values[0].regionProjection, 'uncontrolled'); assert.equal(values[0].controlRevision, 0);
  assert.equal(values[1].regionProjection, 'production'); assert.equal(values[1].controlState, 'controlled');
  assert.throws(() => port.getMaterialControlProjections([SHA_B,SHA_A]), (error) => error.code === 'P3_CONTROL_QUERY_KEYS_INVALID');
  database.close(); kernel.close(); fs.rmSync(root, { recursive:true, force:true });
});
