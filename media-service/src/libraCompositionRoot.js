'use strict';

const nexoraService = require('./nexoraService');
const { createKairoxService } = require('./kairoxService');
const { createLibraService } = require('./libraService');
const { createLibraRuntime } = require('./libraRuntime');
const configStore = require('./configStore');

let singleton = null;

function createHelixServices(overrides = {}) {
  const resolvedNexora = overrides.nexoraService || nexoraService;
  const resolvedKairox = overrides.kairoxService || createKairoxService(overrides.kairoxDependencies);
  const libraImplementation = overrides.libraImplementation || createLibraRuntime({
    nexoraService: resolvedNexora,
    kairoxService: resolvedKairox,
    store: overrides.libraStore,
    configs: overrides.configStore || configStore,
  });
  const libraService = createLibraService({
    nexoraService: resolvedNexora,
    kairoxService: resolvedKairox,
    implementation: libraImplementation,
  });
  return Object.freeze({
    libraService,
    nexoraService: resolvedNexora,
    kairoxService: resolvedKairox,
  });
}

function getHelixServices() {
  if (!singleton) singleton = createHelixServices();
  return singleton;
}

function resetForTests() {
  singleton = null;
}

module.exports = { createHelixServices, getHelixServices, resetForTests };
