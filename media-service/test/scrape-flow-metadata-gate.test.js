'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('standard scrape completes when custom/default TV metadata gate matches strategy inputs', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  process.env.CONTROL_PLANE_DATA_DIR = dir;

  const configStore = require('../src/configStore');
  const taskStore = require('../src/taskStore');
  const mediaLibraryService = require('../src/mediaLibraryService');
  const scrapeFlow = require('../src/scrapeFlowExecutor');

  const subLibraryId = 'cn-series-lib';
  configStore.patchConfig({
    subLibraries: [{
      uuid: subLibraryId,
      name: 'CN Series',
      source: 'emby',
      mediaType: 'tv',
      enabled: true,
      embyServerId: 'test-emby',
      ruleTemplateId: 'chn_series',
    }],
    ruleTemplates: [{
      id: 'chn_series',
      rules: [{
        priority: 1,
        groupsConnector: 'and',
        groups: [{ connector: 'and', conditions: [['watched', '=', true], ['bucket', '=', '1080p'], ['equivalentBitrate', '>', 3]] }],
        action: 'transcode',
        actionParams: { targetBitrate: 3, targetCodec: 'h265' },
      }],
    }],
  });

  mediaLibraryService.upsertItems(subLibraryId, [{
    itemId: 'cn-series-season',
    sourceId: 'cn-series-season',
    name: 'Season 1',
    type: 'season',
    seriesName: '国产剧',
    seasonNumber: 1,
    path: '/media/cn-series/Season 1',
    size: 1024 * 1024,
    duration: 3600,
    bitrate: 5_000_000,
    equivalentBitrate: 5,
    resolution: '1920x1080',
    codec: 'h264',
    watched: true,
  }], { fullSync: true });

  const item = mediaLibraryService.getLibrary().items.find((it) => it.subLibraryId === subLibraryId);
  const originalComplete = mediaLibraryService.completeEmbyItemMetadata;
  mediaLibraryService.completeEmbyItemMetadata = async () => mediaLibraryService.getLibraryItem(item.itemId);

  const task = taskStore.createTask({
    itemId: item.itemId,
    itemName: item.name,
    actionType: 'scrape',
    status: 'executing',
    itemInfo: { ...item },
    resumePoint: 'scrape_executing',
  });

  scrapeFlow.setScheduler({
    reportStatus: (tid, status, progress) => {
      taskStore.updateTask(tid, { status, progress });
    },
  });

  try {
    await scrapeFlow.driveTask(task.id);
  } finally {
    mediaLibraryService.completeEmbyItemMetadata = originalComplete;
  }

  const afterTask = taskStore.getTask(task.id);
  assert.strictEqual(afterTask.status, 'done');
  assert.strictEqual(afterTask.phase, 'done');
  assert.strictEqual(afterTask.metadataGateFailure, undefined);
  assert.ok(afterTask.logs.some((log) => log.level === 'info' && log.msg.includes('Standard metadata repair verified')));

  delete process.env.CONTROL_PLANE_DATA_DIR;
});
