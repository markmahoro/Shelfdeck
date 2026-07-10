'use strict';

const fs = require('fs');
const path = require('path');
const configStore = require('./configStore');
const cleanState = require('./helixCleanState');

function assertRuntimeReady(options = {}) {
  const dataDir = path.resolve(options.dataDir || configStore.resolveDataDir());
  const inspection = cleanState.assertCleanState({ dataDir });
  const configPath = path.join(dataDir, 'config.json');
  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (error) {
    const failure = new cleanState.HelixCleanInitRequiredError({
      ...inspection,
      configError: error.message,
    });
    throw failure;
  }
  configStore.assertCleanConfig(config);
  return { dataDir, inspection, config };
}

module.exports = { assertRuntimeReady };
