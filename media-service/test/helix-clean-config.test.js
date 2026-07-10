'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shelfdeck-clean-config-'));
process.env.CONTROL_PLANE_DATA_DIR = dataDir;

const configStore = require('../src/configStore');
const { HELIX_SCHEMA_VERSION } = require('../src/helixCleanState');

test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

test('default config contains only the two Helix automation controls', () => {
  const config = configStore.getDefaultConfig();
  assert.strictEqual(config.helixSchemaVersion, HELIX_SCHEMA_VERSION);
  assert.strictEqual(config.automaticTaskTargets, undefined);
  assert.strictEqual(config.smartTaskMaxPerRun, undefined);
  assert.strictEqual(config.executionMode, undefined);
  assert.strictEqual(config.deleteGatePolicy, undefined);
  assert.deepStrictEqual(Object.keys(config.taskPriority.targetGateWeights).sort(), ['basedata', 'metadata', 'optimize']);
  assert.deepStrictEqual(configStore.defaultSubLibraryAutomation(), {
    libraryAutomationMode: 'manual',
    maintenanceAutomationMode: 'manual',
  });
});

test('clean config persists independent library and maintenance automation modes', () => {
  const config = configStore.getDefaultConfig();
  config.subLibraries = [{
    uuid: 'library-1',
    name: 'Library',
    libraryAutomationMode: 'auto',
    maintenanceAutomationMode: 'manual',
  }];
  configStore.saveConfig(config, { skipMetadataGateValidation: true });
  const loaded = configStore.loadConfig();
  assert.deepStrictEqual(configStore.resolveSubLibraryAutomation({ subLibraryId: 'library-1' }, loaded), {
    libraryAutomationMode: 'auto',
    maintenanceAutomationMode: 'manual',
    approvalPolicy: {},
  });
});

test('legacy configuration is rejected instead of migrated or defaulted', () => {
  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({
    helixSchemaVersion: HELIX_SCHEMA_VERSION,
    automaticTaskTargets: ['metadata'],
    subLibraries: [],
  }), 'utf8');
  assert.throws(
    () => configStore.loadConfig(),
    (error) => error.code === 'HELIX_CLEAN_INIT_REQUIRED'
      && error.details.violations.includes('automaticTaskTargets'),
  );
});

test('missing two-level modes and legacy target keys are rejected', () => {
  const config = configStore.getDefaultConfig();
  config.subLibraries = [{ uuid: 'invalid' }];
  config.taskAdmission.maxQueuedByTargetGate.archive = 1;
  assert.throws(
    () => configStore.assertCleanConfig(config),
    (error) => error.code === 'HELIX_CLEAN_INIT_REQUIRED'
      && error.details.violations.includes('subLibraries[0].libraryAutomationMode')
      && error.details.violations.includes('taskAdmission.maxQueuedByTargetGate.archive'),
  );
});
