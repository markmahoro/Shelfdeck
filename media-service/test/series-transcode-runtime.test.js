'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

test('one Series Optimize Task executes independent Episode transcodes and one Subject join', { timeout: 120000 }, async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shelfdeck-series-transcode-'));
  const mediaDir = path.join(dataDir, 'Season 01');
  const tempDir = path.join(dataDir, 'transcode');
  fs.mkdirSync(mediaDir, { recursive: true }); fs.mkdirSync(tempDir, { recursive: true });
  const previous = process.env.MEDIA_SERVICE_DATA_DIR;
  process.env.MEDIA_SERVICE_DATA_DIR = dataDir;
  const transcodeService = require('../src/services/transcodeService');
  const ffmpeg = transcodeService.resolveFfmpegBin({});
  const inputs = ['S01E01', 'S01E02'].map((key) => path.join(mediaDir, `Show.${key}.mkv`));
  for (const input of inputs) {
    const generated = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24', '-t', '1', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '0', '-an', '-y', input], { windowsHide: true });
    if (generated.status !== 0 || !fs.existsSync(input)) { t.skip('Local FFmpeg cannot generate Series fixtures'); return; }
  }
  const configStore = require('../src/configStore');
    const taskStore = require('../src/taskStore');
    const workflowStore = require('../src/workflowStore');
    const admissionStore = require('../src/kairoxAdmissionStore');
    const kairoxStore = require('../src/kairoxStore');
  const builtIns = require('../src/builtInCapabilities');
  const eventRuntime = require('../src/eventRuntime');
  try {
    builtIns.registerBuiltIns();
    const config = configStore.getDefaultConfig();
    config.transcodeTempRoot = tempDir;
    config.transcodeEncodingDevices = [{ stableKey: 'cpu:libx265', inPool: true, priority: 1, maxSlots: 1, encoder: 'libx265' }];
    config.approvalPolicy['transcode.beforeReplace'] = 'auto';
    config.subLibraries = [{ uuid: 'series-library', mediaType: 'tv', libraryAutomationMode: 'manual', maintenanceAutomationMode: 'manual', allowedCapabilities: { metadata: [], optimize: ['media.transcode', 'media.file.replace'] }, capabilityPolicyRevision: '1' }];
    configStore.saveConfig(config);
    const assets = inputs.map((filePath, index) => ({ assetId: `episode-${index + 1}`, assetKind: 'episode', seasonKey: '1', episodeKey: String(index + 1), partKey: '', assetRevision: 1, canonicalLocator: { path: filePath } }));
    admissionStore.upsertAdmission({ subjectId: 'series', admissionGeneration: 1, status: 'active', sourceRevision: 'source-1', assets, sourceAccessDescriptor: { sourceType: 'emby', subLibraryId: 'series-library', subjectKind: 'series' } });
    const task = taskStore.createTask({ subjectId: 'series', subjectName: 'Show', status: 'queued', source: 'manual', sourceAccessMappingRevision: 'identity', helixAdmission: admissionStore.getAdmission('series'), capabilityPolicyRevision: '1', objectiveRevisionSnapshot: 'objective-1', taskTarget: { targetGate: 'optimize', gateObjective: { targetMediaFacts: { targetCodec: 'h265', targetBitrateProfileByBucket: { '1080p': { minMbps: 0.01, targetMbps: 0.3, maxMbps: 100 } } } } }, subjectInfo: { subjectId: 'series', subjectKind: 'series', type: 'series', codec: 'h264', bitrate: 2, resolution: '320x180', subLibraryId: 'series-library', optimizeObjectiveStatus: 'ready' } });
    await eventRuntime.driveTask(task.id);
    const events = workflowStore.listEvents(task.id);
    assert.equal(taskStore.getTask(task.id).status, 'done', JSON.stringify(events));
    assert.equal(events.filter((event) => event.capability === 'media.transcode.precheck').length, 2);
    assert.equal(events.filter((event) => event.capability === 'media.file.replace' && event.status === 'succeeded').length, 2);
    assert.equal(events.filter((event) => event.capability === 'series.optimization.result.publish').length, 1);
    for (const input of inputs) assert.equal((await transcodeService.probeSummary(config, input)).videoCodec, 'hevc');
  } finally {
    taskStore.resetForTests(); workflowStore.resetForTests(); admissionStore.resetForTests(); kairoxStore.resetForTests();
    if (previous === undefined) delete process.env.MEDIA_SERVICE_DATA_DIR; else process.env.MEDIA_SERVICE_DATA_DIR = previous;
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (_) {}
  }
});
