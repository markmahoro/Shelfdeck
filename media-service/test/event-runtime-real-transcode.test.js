'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

test('real transcode is executed as atomic Workflow Events and invalidates Basedata after replace', { timeout: 120000 }, async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shelfdeck-event-transcode-'));
  const mediaDir = path.join(dataDir, 'media');
  const tempDir = path.join(dataDir, 'transcode');
  fs.mkdirSync(mediaDir, { recursive: true }); fs.mkdirSync(tempDir, { recursive: true });
  const previous = process.env.MEDIA_SERVICE_DATA_DIR;
  process.env.MEDIA_SERVICE_DATA_DIR = dataDir;
  const transcodeService = require('../src/services/transcodeService');
  const ffmpeg = transcodeService.resolveFfmpegBin({});
  const input = path.join(mediaDir, 'sample.mkv');
  const generated = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=1000', '-t', '3', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '0', '-c:a', 'aac', '-y', input], { windowsHide: true });
  if (generated.status !== 0 || !fs.existsSync(input)) { t.skip('Local FFmpeg cannot generate the disposable fixture'); return; }
  const configStore = require('../src/configStore');
  const taskStore = require('../src/taskStore');
  const workflowStore = require('../src/workflowStore');
  const kairoxStore = require('../src/kairoxStore');
  const admissionStore = require('../src/kairoxAdmissionStore');
  const builtIns = require('../src/builtInCapabilities');
  const eventRuntime = require('../src/eventRuntime');
  try {
    builtIns.registerBuiltIns();
    const config = configStore.getDefaultConfig();
    config.transcodeTempRoot = tempDir;
    config.transcodeEncodingDevices = [{ stableKey: 'cpu:libx265', inPool: true, priority: 1, maxSlots: 1, encoder: 'libx265' }];
    config.approvalPolicy['transcode.beforeReplace'] = 'auto';
    config.subLibraries = [{ uuid: 'library-1', name: 'Fixture', mediaType: 'movie', libraryAutomationMode: 'manual', maintenanceAutomationMode: 'manual', allowedCapabilities: { metadata: [], optimize: ['media.transcode', 'media.replace'] }, capabilityPolicyRevision: '1' }];
    configStore.saveConfig(config);
    admissionStore.upsertAdmission({ itemId: 'item-1', admissionGeneration: 1, status: 'active', sourceRevision: 'source-1', sourceAccessDescriptor: { sourceType: 'adult_folder', subLibraryId: 'library-1', locator: { path: input } } });
    kairoxStore.publishBasedata({ itemId: 'item-1', sourceRevision: 'source-1', facts: { path: input, codec: 'h264', bitrate: 2000000, resolution: '320x180' } });
    const task = taskStore.createTask({ itemId: 'item-1', itemName: 'Fixture', status: 'queued', source: 'manual', sourceAccessMappingRevision: 'identity', helixAdmission: admissionStore.getAdmission('item-1'), capabilityPolicyRevision: '1', objectiveRevisionSnapshot: 'objective-1', taskTarget: { targetGate: 'optimize', gateObjective: { targetMediaFacts: { targetCodec: 'h265', targetBitrateProfileByBucket: { '1080p': { minMbps: 0.01, targetMbps: 0.3, maxMbps: 100 } } } } }, itemInfo: { itemId: 'item-1', name: 'Fixture', path: input, codec: 'h264', bitrate: 2000000, resolution: '320x180', subLibraryId: 'library-1', optimizeObjectiveStatus: 'ready' } });
    await eventRuntime.driveTask(task.id);
    const finalTask = taskStore.getTask(task.id);
    const events = workflowStore.listEvents(task.id);
    assert.strictEqual(finalTask.status, 'done', JSON.stringify(events));
    assert.deepStrictEqual(events.map((event) => event.capability), ['media.transcode.precheck', 'transcode.tonemap.accept', 'media.transcode', 'output.media.verify', 'media.transcode', 'output.media.verify', 'output.media.select', 'output.media.disposition', 'output.preview.generate', 'media.replace', 'staged.asset.discard', 'workspace.cleanup', 'optimization.outcome.select', 'filesystem.layout.verify', 'optimization.result.publish']);
    assert.ok(events.every((event) => ['succeeded', 'skipped'].includes(event.status)));
    assert.strictEqual(events.find((event) => event.capability === 'staged.asset.discard').status, 'skipped');
    assert.deepStrictEqual(events.filter((event) => event.capability === 'media.transcode').map((event) => event.status), ['succeeded', 'skipped']);
    assert.strictEqual((await transcodeService.probeSummary(config, input)).videoCodec, 'hevc');
    assert.strictEqual(kairoxStore.getBundle('item-1').basedata.status, 'stale');
  } finally {
    taskStore.resetForTests(); workflowStore.resetForTests(); kairoxStore.resetForTests(); admissionStore.resetForTests();
    if (previous === undefined) delete process.env.MEDIA_SERVICE_DATA_DIR; else process.env.MEDIA_SERVICE_DATA_DIR = previous;
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
