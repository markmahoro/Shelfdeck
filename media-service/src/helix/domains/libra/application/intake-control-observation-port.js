'use strict';

const { assertIntakeControlReadHandle, controlObservationDigest, assertIntakeControlObservation } = require('../model/intake-control-contracts');

function createIntakeControlObservationPort({ materialControlProjectionPort, now = Date.now }) {
  if (typeof materialControlProjectionPort?.getMaterialControlProjections !== 'function') {
    throw new TypeError('Intake Control observation requires the bounded Foundation projection port.');
  }
  return Object.freeze({ observe(handle, context) {
    const snapshot = context.namedInputs.candidateDeliverySnapshot;
    assertIntakeControlReadHandle(handle, snapshot, context.ownerScope);
    const projections = [];
    for (let offset = 0; offset < handle.materialKeys.length; offset += 500) {
      projections.push(...materialControlProjectionPort.getMaterialControlProjections(handle.materialKeys.slice(offset, offset + 500)));
    }
    const capturedAtMs = now();
    const observation = Object.freeze({ capturedAtMs, projections:Object.freeze(projections),
      observationDigest:controlObservationDigest(handle, capturedAtMs, projections) });
    // Query corruption/unavailability stays technical; this port never emits a rejection Decision.
    assertIntakeControlObservation(handle, observation);
    return observation;
  } });
}

module.exports = Object.freeze({ createIntakeControlObservationPort });
