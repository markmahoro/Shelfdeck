'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { createFieldIntakeAdmissionAdminService } = require('../../src/helix/domains/libra/application/field-intake-admission-admin-service');
const { createPredeckPipelineAdmissionStore } = require('../../src/helix/domains/libra/persistence/predeck-pipeline-admission-store');
const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const schemaDdl = fs.readFileSync(path.join(__dirname, '../../src/helix/foundation/persistence/generated/clean-schema.sql'), 'utf8');
const schemaManifest = require('../../src/helix/foundation/persistence/generated/clean-schema.manifest.json');
const { createSqliteUnitOfWork } = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');

function runtime() {
  const Database = require('better-sqlite3');
  const databasePath = require('node:os').tmpdir() + '/p16-pipeline-' + Date.now() + '-' + Math.random() + '.db';
  const kernel = openSqliteKernel({ Database, databasePath, schemaDdl, schemaManifest, now: () => 1000 });
  const unitOfWork = createSqliteUnitOfWork({ kernel });
  return Object.freeze({
    admin: createFieldIntakeAdmissionAdminService({ schemaManifest, unitOfWork, now: () => 1000 }),
    store: createPredeckPipelineAdmissionStore({ schemaManifest, unitOfWork, now: () => 1000 }),
    kernel,
    close: () => kernel.close(),
  });
}

test('lazy policy init defaults to three seats', () => {
  const ctx = runtime();
  const policy = ctx.admin.getFieldIntakeAdmission('movie-field-1');
  assert.equal(policy.predeckPipelineSeats, 3);
  assert.equal(policy.pipelineTokensHeld, 0);
  assert.equal(policy.pipelineSeatsFree, 3);
  assert.equal(policy.policyRevision, 1);
  assert.equal(ctx.kernel.runPrimitive(({ prepare }) =>
    prepare('SELECT COUNT(*) AS count FROM libra_field_intake_admission_policies').get().count), 0,
  'GET must not persist a default policy');
  ctx.close();
});

test('replaying the same PATCH is a durable no-op', () => {
  const ctx = runtime();
  const first = ctx.admin.reviseFieldIntakeAdmission('movie-field-idempotent', { predeckPipelineSeats: 4 });
  const second = ctx.admin.reviseFieldIntakeAdmission('movie-field-idempotent', { predeckPipelineSeats: 4 });
  assert.deepEqual(second, first);
  assert.equal(ctx.kernel.runPrimitive(({ prepare }) =>
    prepare('SELECT COUNT(*) AS count FROM libra_field_intake_admission_policies WHERE field_id = ?')
      .get('movie-field-idempotent').count), 1);
  ctx.close();
});

test('admin PATCH revises seats and reports occupancy', () => {
  const ctx = runtime();
  ctx.store.acquire({ fieldId: 'movie-field-2', subjectId: 'subject-1', sourceProcessId: 'process-1' });
  ctx.store.acquire({ fieldId: 'movie-field-2', subjectId: 'subject-2', sourceProcessId: 'process-2' });
  const revised = ctx.admin.reviseFieldIntakeAdmission('movie-field-2', { predeckPipelineSeats: 5 });
  assert.equal(revised.predeckPipelineSeats, 5);
  assert.equal(revised.pipelineTokensHeld, 2);
  assert.equal(revised.pipelineSeatsFree, 3);
  const paused = ctx.admin.reviseFieldIntakeAdmission('movie-field-2', { predeckPipelineSeats: 0 });
  assert.equal(paused.predeckPipelineSeats, 0);
  assert.equal(paused.pipelineSeatsFree, 0);
  ctx.close();
});

test('zero seats blocks new acquire but keeps existing tokens', () => {
  const ctx = runtime();
  ctx.admin.reviseFieldIntakeAdmission('movie-field-3', { predeckPipelineSeats: 0 });
  assert.throws(
    () => ctx.store.acquire({ fieldId: 'movie-field-3', subjectId: 'subject-new', sourceProcessId: 'process-new' }),
    (error) => error?.code === 'PREDECK_PIPELINE_FULL',
  );
  ctx.close();
});
