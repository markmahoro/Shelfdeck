'use strict';

const findResetBarrier = Object.freeze({ kind: 'select-one', tableId: 'proc_field_reset_barriers',
  columns: ['field_id', 'reset_id', 'minimum_observation_revision', 'created_at_ms'], keyColumns: ['field_id'] });

function observationPrefix(barrier) {
  return 'field-observation-work-' + (barrier ? barrier.reset_id + '-' : '');
}
function observationBelongsToGeneration(workId, barrier) {
  return !barrier || typeof workId === 'string' && workId.startsWith(observationPrefix(barrier));
}
function isFreshObservation(revision, workId, barrier) {
  return !barrier || Number(revision) > Number(barrier.minimum_observation_revision) && observationBelongsToGeneration(workId, barrier);
}

module.exports = Object.freeze({ findResetBarrier, observationPrefix, observationBelongsToGeneration, isFreshObservation });
