'use strict';

class InputBindingProjectionRegistryError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'InputBindingProjectionRegistryError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new InputBindingProjectionRegistryError(code, message, details);
}

function createInputBindingProjectionRegistry(options = {}) {
  if (!Array.isArray(options.registrations)) {
    fail('P4_INPUT_PROJECTION_REGISTRY_REQUIRED', 'Input binding projection registrations are required.');
  }
  const registrations = new Map();
  for (const registration of options.registrations) {
    if (!registration || typeof registration.projectionRef !== 'string' || !registration.projectionRef ||
        !registration.projection || typeof registration.projection.project !== 'function' ||
        registrations.has(registration.projectionRef)) {
      fail('P4_INPUT_PROJECTION_REGISTRATION_INVALID', 'Input binding projection registration is invalid or duplicated.');
    }
    registrations.set(registration.projectionRef, Object.freeze(registration.projection));
  }
  return Object.freeze({
    resolve(projectionRef) {
      const projection = registrations.get(projectionRef);
      if (!projection) fail('P4_INPUT_PROJECTION_NOT_REGISTERED', 'Input binding projection is not registered.', { projectionRef });
      return projection;
    },
  });
}

module.exports = Object.freeze({ InputBindingProjectionRegistryError, createInputBindingProjectionRegistry });
