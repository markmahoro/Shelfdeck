'use strict';

const {
  createIntegrationAdminApplication,
} = require('../application/integration-admin-application');
const {
  createIntegrationRuntime,
} = require('../application/integration-runtime');
const {
  IntegrationHandleResolverPort,
  IntegrationQueryPort,
  SecretLeaseResolverPort,
} = require('./index');

function createPlatformIntegrationRuntime(options) {
  const runtime = createIntegrationRuntime(options);
  return Object.freeze({
    ...runtime,
    integrationHandleResolverPort: IntegrationHandleResolverPort({
      resolve: runtime.integrationHandleResolverPort.resolve,
    }),
    integrationQueryPort: IntegrationQueryPort({
      query: runtime.integrationQueryPort.query,
    }),
    secretLeaseResolverPort: SecretLeaseResolverPort({
      resolve: runtime.secretLeaseResolverPort.resolve,
    }),
  });
}

module.exports = Object.freeze({
  createIntegrationAdminApplication,
  createPlatformIntegrationRuntime,
});
