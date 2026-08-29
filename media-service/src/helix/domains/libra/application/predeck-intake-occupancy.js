'use strict';

const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');

const PREDECK_INTAKE_SEATS = 3;
const OCCUPIED_RUN_STATES = new Set(['active', 'suspended', 'frozen']);
const OPEN_WORK_STATES = new Set(['admitted', 'ready', 'running', 'blocked']);
const PREDECK_IN_FLIGHT_WORKS = Object.freeze([
  Object.freeze({ processType: 'libra_intake', workKind: 'evidence' }),
  Object.freeze({ processType: 'libra_intake', workKind: 'acceptance' }),
  Object.freeze({ processType: 'libra_intake', workKind: 'rejection' }),
  Object.freeze({ processType: 'libra_routing', workKind: 'routing_nfo_facts' }),
  Object.freeze({ processType: 'libra_routing', workKind: 'routing_provider_facts' }),
  Object.freeze({ processType: 'libra_routing', workKind: 'routing_basis' }),
  Object.freeze({ processType: 'libra_acceptance_spec', workKind: 'acceptance_spec_basis' }),
]);

function occupancyFromFacts(runs, works) {
  const occupiedIds = new Set();
  for (const row of runs) {
    if (OCCUPIED_RUN_STATES.has(row.state) && row.subject_id) occupiedIds.add(row.subject_id);
  }
  const occupiedSubjects = occupiedIds.size;
  let inFlightIntake = 0;
  const intakeIds = new Set();
  for (const work of works) {
    if (!OPEN_WORK_STATES.has(work.state) || !work.process_id) continue;
    if (work.process_type === 'libra_intake' && !intakeIds.has(work.process_id)) {
      intakeIds.add(work.process_id);
      inFlightIntake += 1;
    }
    occupiedIds.add(work.process_id);
  }
  const occupied = occupiedIds.size;
  return Object.freeze({
    seats: PREDECK_INTAKE_SEATS,
    occupiedSubjects,
    inFlightIntake,
    occupied,
    freeSeats: Math.max(0, PREDECK_INTAKE_SEATS - occupied),
  });
}

function createPredeckIntakeOccupancy(options) {
  if (!options?.schemaManifest || !options.unitOfWork || !options.workResultReader) {
    throw new TypeError('Pre-deck Intake occupancy requires Owner persistence and Work results.');
  }
  const repository = createRepositoryDefinition({
    repositoryId: 'predeck_intake_occupancy',
    owner: 'libra',
    schemaManifest: options.schemaManifest,
    statements: {
      list_runs: {
        kind: 'select-all',
        tableId: 'libra_runs',
        columns: ['libra_run_id', 'subject_id', 'state'],
        keyColumns: [],
      },
    },
  });
  function snapshot() {
    const runs = options.unitOfWork.execute([{
      participantId: 'predeck_intake_occupancy_read',
      owner: 'libra',
      repositories: [repository],
      execute(context) {
        return context.repository(repository.repositoryId).invoke('list_runs', {});
      },
    }]).predeck_intake_occupancy_read || [];
    const works = [];
    for (const item of PREDECK_IN_FLIGHT_WORKS) {
      for (const work of options.workResultReader.listOwnerWorks({ ownerDomain: 'libra', workKind: item.workKind })) {
        if (work.process_type === item.processType) works.push(work);
      }
    }
    return occupancyFromFacts(runs, works);
  }
  return Object.freeze({ snapshot, seats: PREDECK_INTAKE_SEATS });
}

module.exports = Object.freeze({
  PREDECK_INTAKE_SEATS,
  PREDECK_IN_FLIGHT_WORKS,
  occupancyFromFacts,
  createPredeckIntakeOccupancy,
});
