'use strict';

const { createRepositoryDefinition } = require('../../../foundation/persistence/owner-repository');

const PREDECK_INTAKE_SEATS = 3;
const OCCUPIED_RUN_STATES = new Set(['active', 'suspended', 'frozen']);
const OPEN_WORK_STATES = new Set(['admitted', 'ready', 'running', 'blocked']);
const INTAKE_WORK_KINDS = Object.freeze(['evidence', 'acceptance', 'rejection']);

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
    const occupiedSubjects = new Set(
      runs.filter((row) => OCCUPIED_RUN_STATES.has(row.state)).map((row) => row.subject_id),
    ).size;
    const inFlightProcessIds = new Set();
    for (const workKind of INTAKE_WORK_KINDS) {
      for (const work of options.workResultReader.listOwnerWorks({ ownerDomain: 'libra', workKind })) {
        if (work.process_type === 'libra_intake' && OPEN_WORK_STATES.has(work.state)) {
          inFlightProcessIds.add(work.process_id);
        }
      }
    }
    const inFlightIntake = inFlightProcessIds.size;
    const occupied = occupiedSubjects + inFlightIntake;
    return Object.freeze({
      seats: PREDECK_INTAKE_SEATS,
      occupiedSubjects,
      inFlightIntake,
      occupied,
      freeSeats: Math.max(0, PREDECK_INTAKE_SEATS - occupied),
    });
  }
  return Object.freeze({ snapshot, seats: PREDECK_INTAKE_SEATS });
}

module.exports = Object.freeze({
  PREDECK_INTAKE_SEATS,
  createPredeckIntakeOccupancy,
});
