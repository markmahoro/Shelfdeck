'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shelfdeck-kairox-fence-'));
process.env.CONTROL_PLANE_DATA_DIR = dataDir;

const admissionStore = require('../src/kairoxAdmissionStore');
const fence = require('../src/kairoxAdmissionFence');

test.after(() => {
  admissionStore.resetForTests();
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
});

test('current Kairox admission generation passes every commit checkpoint', () => {
  admissionStore.upsertAdmission({ itemId: 'fence-current', admissionGeneration: 2, status: 'active' });
  const result = fence.checkTask({
    itemId: 'fence-current',
    helixAdmission: { admissionGeneration: 2 },
  }, 'transcode_replace');
  assert.strictEqual(result.allowed, true);
});

test('revoked or stale admission generation is fenced before commit', () => {
  admissionStore.upsertAdmission({ itemId: 'fence-stale', admissionGeneration: 3, status: 'suspended', incidentCode: 'source_missing' });
  const task = { itemId: 'fence-stale', helixAdmission: { admissionGeneration: 2 } };
  assert.strictEqual(fence.checkTask(task, 'upgrade_replace').allowed, false);
  assert.throws(() => fence.assertTask(task, 'upgrade_replace'), (error) => error.code === 'KAIROX_ADMISSION_FENCED');
});

test('legacy tasks without a Helix admission remain readable and recoverable', () => {
  assert.deepStrictEqual(fence.checkTask({ itemId: 'legacy-task' }, 'resource_dispatch'), {
    allowed: true,
    legacy: true,
    checkpoint: 'resource_dispatch',
  });
});
