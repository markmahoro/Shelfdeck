'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const compensation = require('../src/workflowCompensation');

test('Runtime compensation only selects evidence-bound internal workspaces', () => {
  const config = { transcodeTempRoot: path.resolve('C:/shelfdeck/transcode'), upgradeStagingLocalPath: path.resolve('C:/shelfdeck/upgrade') };
  const events = [
    { result: { assetId: 'a', producingEventId: 'e', workDir: path.join(config.transcodeTempRoot, 'event-a'), replacementScope: 'file' } },
    { result: { stagedAsset: { assetId: 'b', producingEventId: 'e2', stagedRoot: path.join(config.upgradeStagingLocalPath, 'download-b'), replacementScope: 'folder' }, previewWorkDir: path.join(config.transcodeTempRoot, 'previews', 'b') } },
    { result: { assetId: 'unsafe', producingEventId: 'e3', workDir: path.resolve('C:/media/source'), replacementScope: 'file' } },
  ];
  const failed = compensation.collectCleanupPaths(events, config, 'failed');
  assert.ok(failed.includes(path.join(config.transcodeTempRoot, 'event-a')));
  assert.ok(failed.includes(path.join(config.transcodeTempRoot, 'previews', 'b')));
  assert.ok(!failed.includes(path.join(config.upgradeStagingLocalPath, 'download-b')));
  assert.ok(!failed.includes(path.resolve('C:/media/source')));
  const cancelled = compensation.collectCleanupPaths(events, config, 'cancelled');
  assert.ok(cancelled.includes(path.join(config.upgradeStagingLocalPath, 'download-b')));
});
