'use strict';

const assert = require('node:assert');
const test = require('node:test');

const approvalPolicy = require('../src/approvalPolicy');

test('full-auto maintenance does not grant replace approval', () => {
  const config = {
    subLibraries: [{
      uuid: 'auto-library',
      libraryAutomationMode: 'auto',
      maintenanceAutomationMode: 'auto',
      approvalPolicy: {},
    }],
  };
  const options = { itemInfo: { subLibraryId: 'auto-library' }, config };
  assert.strictEqual(approvalPolicy.requiresConfirmation('transcode.beforeReplace', options), true);
  assert.strictEqual(approvalPolicy.requiresConfirmation('upgrade.beforeReplace', options), true);
});

test('force confirmation cannot be lowered by a library policy', () => {
  const config = {
    subLibraries: [{
      uuid: 'auto-library',
      approvalPolicy: { 'upgrade.identityMismatch': 'auto' },
    }],
  };
  assert.strictEqual(approvalPolicy.resolveGate('upgrade.identityMismatch', {
    itemInfo: { subLibraryId: 'auto-library' }, config,
  }), 'forceConfirm');
});
