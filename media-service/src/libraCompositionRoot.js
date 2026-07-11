'use strict';

const nexoraService = require('./nexoraService');
const { createKairoxService } = require('./kairoxService');
const { createLibraService } = require('./libraService');
const { createLibraRuntime } = require('./libraRuntime');
const configStore = require('./configStore');
const doubanService = require('./services/doubanService');
const kairoxSignalBus = require('./kairoxSignalBus');

let singleton = null;
let unsubscribeKairox = null;

function createHelixServices(overrides = {}) {
  const resolvedNexora = overrides.nexoraService || nexoraService;
  const resolvedKairox = overrides.kairoxService || createKairoxService(overrides.kairoxDependencies);
  const libraImplementation = overrides.libraImplementation || createLibraRuntime({
    nexoraService: resolvedNexora,
    kairoxService: resolvedKairox,
    store: overrides.libraStore,
    configs: overrides.configStore || configStore,
    doubanService: overrides.doubanService || doubanService,
  });
  const libraService = createLibraService({
    nexoraService: resolvedNexora,
    kairoxService: resolvedKairox,
    implementation: libraImplementation,
  });
  if (!overrides.disableSignalSubscription) {
    if (unsubscribeKairox) unsubscribeKairox();
    unsubscribeKairox = kairoxSignalBus.subscribe((signal) => {
      if (signal.kind === 'source_mutation' && signal.itemId) libraService.reconcileItem(signal.itemId);
    });
  }
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
  if (unsubscribeKairox) unsubscribeKairox();
  unsubscribeKairox = null;
  singleton = null;
}

module.exports = { createHelixServices, getHelixServices, resetForTests };
