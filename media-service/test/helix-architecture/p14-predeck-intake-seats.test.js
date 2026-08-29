'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createIntakeProcessCoordinator } = require('../../src/helix/domains/libra/application/intake-process-coordinator');
const fs = require('node:fs');
const path = require('node:path');
const { PREDECK_INTAKE_SEATS, occupancyFromFacts } = require('../../src/helix/domains/libra/application/predeck-intake-occupancy');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');

function digest(index) { return index.toString(16).padStart(64, '0'); }
function offer(index) {
  return Object.freeze({
    offerId: `offer-${String(index).padStart(4, '0')}`,
    candidatePackageId: `candidate-${index}`,
    packageRevision: 1,
    packageDigest: digest(index + 1),
    acceptanceBasisDigest: digest(index + 1001),
  });
}
function durableOfferReader(offers) {
  const sources = new Map(offers.map((value) => {
    const processId = `process-${value.offerId}`;
    return [processId, Object.freeze({
      processId,
      offer: value,
      snapshot: Object.freeze({ deliverySnapshotDigest: digest(Number(value.offerId.slice(6)) + 2001) }),
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

test('Pre-deck Intake seats are three', () => {
  assert.equal(PREDECK_INTAKE_SEATS, 3);
});

test('Intake remembers a full-seat Offer without submitting Work or rejecting', () => {
  const offers = [offer(0)];
  const occupancy = {
    snapshot: () => Object.freeze({
      seats: 3, occupiedSubjects: 3, inFlightIntake: 0, occupied: 3, freeSeats: 0,
    }),
  };
  const coordinator = createIntakeProcessCoordinator({
    offerReader: durableOfferReader(offers),
    occupancyProvider: occupancy,
    workAdmission: fakeAdmission(),
    workResultReader: { status: () => null, read: () => [] },
  });
  const result = coordinator.admitOffer(offers[0]);
  assert.equal(result.result.kind, 'seat_wait');
  assert.equal(result.result.reasonCode, 'PREDECK_INTAKE_SEATS_FULL');
  assert.ok(result.work.workId);
  const pending = coordinator.reconcile(result.processId);
  assert.equal(pending.kind, 'seat_wait');
});

test('Intake starts at most as many new processes as free Pre-deck seats', () => {
  const offers = Array.from({ length: 8 }, (_item, index) => offer(index));
  let occupiedSubjects = 1;
  let inFlightIntake = 0;
  const submitted = [];
  const occupancy = {
    snapshot: () => Object.freeze({
      seats: 3,
      occupiedSubjects,
      inFlightIntake,
      occupied: occupiedSubjects + inFlightIntake,
      freeSeats: Math.max(0, 3 - occupiedSubjects - inFlightIntake),
    }),
  };
  const coordinator = createIntakeProcessCoordinator({
    offerReader: durableOfferReader(offers),
    occupancyProvider: occupancy,
    workAdmission: {
      replay: () => null,
      submit: (work) => {
        submitted.push(work.processId);
        inFlightIntake += 1;
        return Object.freeze({ kind: 'admitted', workId: work.workId, state: 'admitted', replayed: false });
      },
    },
    workResultReader: { status: () => null, read: () => [] },
  });
  const batch = coordinator.reconcilePending({ limit: 100, admissionLimit: 32 });
  assert.equal(batch.admittedCount, 2);
  assert.equal(submitted.length, 2);
  assert.equal(inFlightIntake, 2);
});

test('Pre-deck occupancy counts routing and spec Work until a Run exists', () => {
  const snapshot = occupancyFromFacts(
    [{ libra_run_id: 'run-1', subject_id: 'subject-run', state: 'active' }],
    [
      { process_type: 'libra_intake', process_id: 'intake-1', state: 'running' },
      { process_type: 'libra_routing', process_id: 'subject-route', state: 'running' },
      { process_type: 'libra_acceptance_spec', process_id: 'subject-spec', state: 'running' },
    ],
  );
  assert.equal(snapshot.occupiedSubjects, 1);
  assert.equal(snapshot.inFlightIntake, 1);
  assert.equal(snapshot.occupied, 4);
  assert.equal(snapshot.freeSeats, 0);
});

test('Pre-deck occupancy does not double-count a Run Subject that still has routing Work', () => {
  const snapshot = occupancyFromFacts(
    [{ libra_run_id: 'run-1', subject_id: 'subject-1', state: 'active' }],
    [{ process_type: 'libra_routing', process_id: 'subject-1', state: 'running' }],
  );
  assert.equal(snapshot.occupied, 1);
  assert.equal(snapshot.freeSeats, 2);
});

test('Intake terminal refill occupies routing first and admits at most three', () => {
  const source = fs.readFileSync(path.resolve(__dirname,
    '../../src/helix/composition/create-procurement-execution-runtime.js'), 'utf8');
  const intake = source.slice(source.indexOf("request.processType==='libra_intake'"),
    source.indexOf("request.processType==='libra_routing'"));
  assert.match(intake, /routingCoordinator\.reconcile\(receipt\.subjectId\)/);
  assert.match(intake, /admissionLimit:PREDECK_INTAKE_SEATS/);
  assert.ok(intake.indexOf('routingCoordinator.reconcile') < intake.indexOf('reconcilePending'));
  assert.doesNotMatch(intake, /reconcilePending\(\{ignoreAcceptanceProcessId:request\.processId,limit:100\}\)/);
});
