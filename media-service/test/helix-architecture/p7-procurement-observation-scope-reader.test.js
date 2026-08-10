'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createProcurementRunTriageReader } = require('../../src/helix/domains/procurement/persistence/procurement-run-triage-reader');

const schemaManifest = JSON.parse(fs.readFileSync(path.resolve(__dirname,
  '../../src/helix/foundation/persistence/generated/clean-schema.manifest.json'), 'utf8'));

function row(relativeLocation, observationRevision, ordinal) {
  return {
    field_id:'field-1', field_observation_work_id:'observation-work-1', observation_id:'observation-' + observationRevision,
    observation_revision:observationRevision, page_ordinal:observationRevision - 1, entry_ordinal:ordinal,
    material_observation_id:'material-observation-' + ordinal, material_key:String(ordinal).padStart(64, '0'), mount_scope_id:'mount-1',
    inode:String(ordinal), size_bytes:100, fingerprint_algorithm:'middle-256k-sha256', fingerprint_version:1,
    content_fingerprint:String(ordinal + 10).padStart(64, '0'), endpoint_id:'endpoint-1', access_revision:1, mount_scope_revision:1,
    current_location:'Z:/Film/' + relativeLocation, relative_location:relativeLocation, mtime_ns:'1', ctime_ns:'1',
    fingerprint_verified_at_ms:1, observed_at_ms:1, containment_digest:'a'.repeat(64), reality_digest:'b'.repeat(64),
    provenance_digest:'c'.repeat(64), snapshot_digest:'d'.repeat(64), entry_digest:'e'.repeat(64),
  };
}

test('bounded Observation Scope query reads all pages of the frozen Observation Work', () => {
  const observed = [row('苹果.mkv', 60, 1), row('苹果.nfo', 60, 2)];
  let scopeArguments = null;
  const repository = { invoke(statement, args) {
    if (statement === 'find_run') return { procurement_run_id:'run-1', field_id:'field-1',
      field_observation_work_id:'observation-work-1', terminal_observation_revision:72 };
    if (statement === 'page_observed_scope') {
      scopeArguments = args;
      return observed;
    }
    throw new Error('Unexpected statement: ' + statement);
  } };
  const unitOfWork = { execute(participants) {
    const outputs = {};
    for (const participant of participants) outputs[participant.participantId] = participant.execute({ repository:() => repository });
    return outputs;
  } };
  const reader = createProcurementRunTriageReader({ schemaManifest, unitOfWork, now:() => 1 });
  const materials = reader.listObservedMaterialsInScope('run-1', '.');
  assert.deepEqual(materials.map((item) => item.relativeLocation), ['苹果.mkv', '苹果.nfo']);
  assert.equal(Object.hasOwn(scopeArguments, 'observation_revision'), false);
  assert.equal(scopeArguments.field_observation_work_id, 'observation-work-1');
});
