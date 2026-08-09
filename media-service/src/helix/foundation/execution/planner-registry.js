'use strict';

class PlannerRegistryError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'PlannerRegistryError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new PlannerRegistryError(code, message, details);
}

function key(ownerDomain, workKind) {
  return ownerDomain + '\0' + workKind;
}

function createPlannerRegistry(options = {}) {
  if (!Array.isArray(options.registrations) || options.registrations.length < 1) {
    fail('P4_PLANNER_REGISTRY_REQUIRED', 'Planner Registry requires at least one typed registration.');
  }
  const registrations = new Map();
  for (const registration of options.registrations) {
    if (!registration || typeof registration.ownerDomain !== 'string' || !registration.ownerDomain ||
        typeof registration.workKind !== 'string' || !registration.workKind ||
        typeof registration.plannerContractRef !== 'string' || !registration.plannerContractRef ||
        !Number.isSafeInteger(registration.plannerVersion) || registration.plannerVersion < 1 ||
        !registration.planner || typeof registration.planner.plan !== 'function') {
      fail('P4_PLANNER_REGISTRATION_INVALID', 'Planner registration is incomplete or invalid.');
    }
    const registrationKey = key(registration.ownerDomain, registration.workKind);
    if (registrations.has(registrationKey)) {
      fail('P4_PLANNER_REGISTRATION_DUPLICATE', 'A Work kind can resolve to exactly one Planner.', {
        ownerDomain: registration.ownerDomain,
        workKind: registration.workKind,
      });
    }
    registrations.set(registrationKey, Object.freeze({ ...registration }));
  }
  return Object.freeze({
    snapshot: Object.freeze([...registrations.values()].map((registration) => Object.freeze({
      ownerDomain: registration.ownerDomain,
      workKind: registration.workKind,
      plannerContractRef: registration.plannerContractRef,
      plannerVersion: registration.plannerVersion,
    })).sort((left, right) => key(left.ownerDomain, left.workKind).localeCompare(key(right.ownerDomain, right.workKind)))),
    resolve(ownerDomain, workKind) {
      const registration = registrations.get(key(ownerDomain, workKind));
      if (!registration) {
        fail('P4_PLANNER_NOT_REGISTERED', 'Supporting Work has no registered typed Planner.', { ownerDomain, workKind });
      }
      return registration;
    },
  });
}

module.exports = Object.freeze({ PlannerRegistryError, createPlannerRegistry });
