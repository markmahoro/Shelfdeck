'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { createIntakeProcessCoordinator } = require('../../src/helix/domains/libra/application/intake-process-coordinator');
const { DEFAULT_PREDECK_PIPELINE_SEATS } = require('../../src/helix/domains/libra/application/libra-pipeline-admission');
const { createPredeckPipelineAdmissionStore } = require('../../src/helix/domains/libra/persistence/predeck-pipeline-admission-store');
const { openSqliteKernel } = require('../../src/helix/foundation/persistence/sqlite-kernel');
const schemaDdl = fs.readFileSync(path.join(__dirname, '../../src/helix/foundation/persistence/generated/clean-schema.sql'), 'utf8');
const schemaManifest = require('../../src/helix/foundation/persistence/generated/clean-schema.manifest.json');
const { createSqliteUnitOfWork } = require('../../src/helix/foundation/persistence/sqlite-unit-of-work');

function digest(index) { return index.toString(16).padStart(64, '0'); }
function offer(index, fieldId = `field-${index}`) {
  return Object.freeze({
    offerId: `offer-${String(index).padStart(4, '0')}`,
    candidatePackageId: `candidate-${index}`,
    packageRevision: 1,
    packageDigest: digest(index + 1),
    acceptanceBasisDigest: digest(index + 1001),
    fieldId,
  });
}
function durableOfferReader(offers) {
  const sources = new Map(offers.map((value) => {
    const processId = `process-${value.offerId}`;
    return [processId, Object.freeze({
      processId,
      offer: value,
      snapshot: Object.freeze({
        deliverySnapshotDigest: digest(Number(value.offerId.slice(6)) + 2001),
        candidatePackage: Object.freeze({
          materialFieldContextRef: Object.freeze({ fieldId: value.fieldId }),
        }),
      }),
    })];
  }));
  const ids = [...sources.keys()].sort();
  return Object.freeze({
    decisionId: (offerId) => `process-${offerId}`,
    remember: (value) => sources.get(`process-${value.offerId}`),
    read: (processId) => sources.get(processId) || null,
    listProcessPage(cursor, limit) {
      const start = cursor ? ids.findIndex((id) => id > cursor) : 0;
      const offset = start < 0 ? ids.length : start;
      const items = ids.slice(offset, offset + limit).map((processId) => Object.freeze({ processId }));
      return Object.freeze({ items, nextCursor: offset + items.length < ids.length ? items.at(-1).processId : null });
    },
  });
}
function fakeAdmission() {
  return Object.freeze({
    replay: () => null,
    submit: (work) => Object.freeze({ kind: 'admitted', workId: work.workId, state: 'admitted', replayed: false }),
  });
}
function memoryRuntime() {
  const Database = require('better-sqlite3');
  const databasePath = require('node:os').tmpdir() + '/p14-pipeline-' + Date.now() + '.db';
  const kernel = openSqliteKernel({ Database, databasePath, schemaDdl, schemaManifest, now: () => 1 });
  const unitOfWork = createSqliteUnitOfWork({ kernel });
  const store = createPredeckPipelineAdmissionStore({ schemaManifest, unitOfWork, now: () => 1 });
  return Object.freeze({ store, unitOfWork, close: () => kernel.close() });
}

test('default Pre-deck pipeline seats are three per field', () => {
  assert.equal(DEFAULT_PREDECK_PIPELINE_SEATS, 3);
});

test('Intake waits when a Material Field pipeline is full', () => {
  const runtime = memoryRuntime();
  const fieldId = 'field-a';
  runtime.store.revisePolicy(fieldId, 1);
  runtime.store.acquire({ fieldId, subjectId: 'subject-held', sourceProcessId: 'process-held' });
  const offers = [offer(0, fieldId)];
  const subjectIds = new Map([['process-offer-0000', 'subject-new']]);
  const pipelineAdmission = Object.freeze({
    readPolicy: (id) => runtime.store.readPolicy(id),
    freeSeats: (id) => runtime.store.readPolicy(id).free,
    hasToken: (subjectId) => runtime.store.hasToken(subjectId),
    tryAcquireForProcess: (processId) => {
      const subjectId = subjectIds.get(processId);
      try {
        const result = runtime.store.acquire({ fieldId, subjectId, sourceProcessId: processId });
        return Object.freeze({ kind: 'acquired', processId, fieldId, subjectId, replayed: result.replayed });
      } catch (error) {
        if (error?.code === 'PREDECK_PIPELINE_FULL') {
          return Object.freeze({ kind: 'seat_wait', processId, fieldId, subjectId, reasonCode: error.code });
        }
        throw error;
      }
    },
  });
  const coordinator = createIntakeProcessCoordinator({
    schemaManifest, unitOfWork: runtime.unitOfWork,
    offerReader: durableOfferReader(offers),
    pipelineAdmission,
    subjectIdForProcess: (processId) => subjectIds.get(processId) || null,
    workAdmission: fakeAdmission(),
    workResultReader: { status: () => null, read: () => [] },
  });
  const result = coordinator.admitOffer(offers[0]);
  assert.equal(result.result.kind, 'seat_wait');
  assert.equal(result.result.reasonCode, 'PREDECK_PIPELINE_FULL');
  runtime.close();
});

test('Intake admits only as many new processes as each field has free seats', () => {
  const runtime = memoryRuntime();
  const fieldId = 'field-b';
  runtime.store.revisePolicy(fieldId, 2);
  const offers = Array.from({ length: 4 }, (_item, index) => offer(index, fieldId));
  const subjectIds = new Map(offers.map((value) => [`process-${value.offerId}`, `subject-${value.offerId}`]));
  const submitted = [];
  const pipelineAdmission = Object.freeze({
    readPolicy: (id) => runtime.store.readPolicy(id),
    freeSeats: (id) => runtime.store.readPolicy(id).free,
    hasToken: (subjectId) => runtime.store.hasToken(subjectId),
    tryAcquireForProcess: (processId) => {
      const subjectId = subjectIds.get(processId);
      const result = runtime.store.acquire({ fieldId, subjectId, sourceProcessId: processId });
      return Object.freeze({ kind: 'acquired', processId, fieldId, subjectId, replayed: result.replayed });
    },
  });
  const coordinator = createIntakeProcessCoordinator({
    schemaManifest, unitOfWork: runtime.unitOfWork,
    offerReader: durableOfferReader(offers),
    pipelineAdmission,
    subjectIdForProcess: (processId) => subjectIds.get(processId) || null,
    workAdmission: {
      replay: () => null,
      submit: (work) => {
        submitted.push(work.processId);
        return Object.freeze({ kind: 'admitted', workId: work.workId, state: 'admitted', replayed: false });
      },
    },
    workResultReader: { status: () => null, read: () => [] },
  });
  const batch = coordinator.reconcilePending({ limit: 100, admissionLimit: 8 });
  assert.equal(batch.admittedCount, 2);
  assert.equal(submitted.length, 2);
  assert.equal(runtime.store.readPolicy(fieldId).held, 2);
  runtime.close();
});

test('succeeded historical Intake evidence must reacquire a pipeline seat before replay', () => {
  const runtime = memoryRuntime();
  const fieldId = 'field-replay';
  runtime.store.revisePolicy(fieldId, 1);
  runtime.store.acquire({ fieldId, subjectId: 'subject-held', sourceProcessId: 'process-held' });
  const offers = [offer(7, fieldId)];
  const processId = 'process-offer-0007';
  const subjectId = 'subject-replayed';
  const pipelineAdmission = Object.freeze({
    readPolicy: (id) => runtime.store.readPolicy(id),
    freeSeats: (id) => runtime.store.readPolicy(id).free,
    hasToken: (id) => runtime.store.hasToken(id),
    tryAcquireForProcess: () => {
      try {
        runtime.store.acquire({ fieldId, subjectId, sourceProcessId: processId });
        return Object.freeze({ kind:'acquired', processId, fieldId, subjectId, replayed:false });
      } catch (error) {
        return Object.freeze({ kind:'seat_wait', processId, fieldId, subjectId, reasonCode:error.code });
      }
    },
  });
  const coordinator = createIntakeProcessCoordinator({
    schemaManifest, unitOfWork: runtime.unitOfWork,
    offerReader: durableOfferReader(offers), pipelineAdmission,
    subjectIdForProcess: () => subjectId, workAdmission: fakeAdmission(),
    workResultReader: { status: () => Object.freeze({ state:'succeeded' }), read: () => [] },
  });
  const result = coordinator.reconcile(processId);
  assert.equal(result.kind, 'seat_wait');
  assert.equal(runtime.store.hasToken(subjectId), false);
  runtime.close();
});

test('Intake terminal refill uses per-field admission limit', () => {
  const source = fs.readFileSync(path.resolve(__dirname,
    '../../src/helix/composition/create-procurement-execution-runtime.js'), 'utf8');
  const intake = source.slice(source.indexOf("request.processType==='libra_intake'"),
    source.indexOf("request.processType==='libra_routing'"));
  assert.match(intake, /routingCoordinator\.reconcile\(receipt\.subjectId\)/);
  assert.match(intake, /admissionLimit:DEFAULT_PREDECK_PIPELINE_SEATS/);
  assert.ok(intake.indexOf('routingCoordinator.reconcile') < intake.indexOf('reconcilePending'));
});
