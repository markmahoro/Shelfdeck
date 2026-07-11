'use strict';

const registry = require('./capabilityRegistry');
const catalog = require('./capabilityCatalog');
const { registerBasedataCapabilities } = require('./capabilities/basedataCapabilities');
const { registerMetadataCapabilities, nfoFor } = require('./capabilities/metadataCapabilities');
const { registerWesternAdultCapabilities } = require('./capabilities/westernAdultCapabilities');
const { registerTranscodeCapabilities } = require('./capabilities/transcodeCapabilities');
const { registerMediaAssetCapabilities } = require('./capabilities/mediaAssetCapabilities');
const { registerUpgradeCapabilities } = require('./capabilities/upgradeCapabilities');
const { registerSeriesUpgradeCapabilities } = require('./capabilities/seriesUpgradeCapabilities');
const { registerMaintenanceCapabilities } = require('./capabilities/maintenanceCapabilities');

let registered = false;
function register(definition) { if (!registry.has(definition.capability)) registry.register(catalog.apply(definition)); }
function registerBuiltIns() {
  if (registered && registry.list().length) return registry;
  registered = true;
  register({ capability: 'workflow.blocked', allowedTargetGates: ['basedata', 'metadata', 'optimize'], execute: async ({ parameters }) => { throw Object.assign(new Error(parameters.reason || 'Workflow planning blocked'), { code: 'KAIROX_WORKFLOW_BLOCKED', details: { rejected: parameters.rejected || [] } }); } });
  registerBasedataCapabilities(register);
  registerMetadataCapabilities(register);
  registerWesternAdultCapabilities(register);
  registerTranscodeCapabilities(register);
  registerMediaAssetCapabilities(register);
  registerUpgradeCapabilities(register);
  registerSeriesUpgradeCapabilities(register);
  registerMaintenanceCapabilities(register);
  return registry;
}

module.exports = { registerBuiltIns, nfoFor };
