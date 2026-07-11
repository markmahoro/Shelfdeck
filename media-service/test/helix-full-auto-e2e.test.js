'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const cleanState = require('../src/helixCleanState');
const configStore = require('../src/configStore');
const { buildApp } = require('../src/app');
const libraStore = require('../src/libraStore');
const nexoraStore = require('../src/nexoraStore');
const kairoxStore = require('../src/kairoxStore');
const kairoxAdmissionStore = require('../src/kairoxAdmissionStore');
const taskStore = require('../src/taskStore');
const workflowStore = require('../src/workflowStore');

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function embyItem() {
  return {
    Id: 'emby-auto-1',
    Name: 'Automatic Movie',
    Type: 'Movie',
    Path: '/readonly/Automatic Movie.mkv',
    PremiereDate: '2026-01-01T00:00:00.000Z',
    Genres: ['Drama'],
    ProviderIds: { Tmdb: '4242' },
    UserData: { Played: false, PlayCount: 0 },
    MediaSources: [{
      Path: '/readonly/Automatic Movie.mkv',
      Size: 4000000000,
      RunTimeTicks: 8000000000,
      Bitrate: 4000000,
      MediaStreams: [
        { Type: 'Video', Codec: 'hevc', Width: 1920, Height: 1080 },
        { Type: 'Audio', Codec: 'aac', DisplayTitle: 'AAC' },
      ],
    }],
  };
}

test('auto/auto Emby library converges through Basedata and Metadata to maintenanceComplete', { timeout: 45000 }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shelfdeck-full-auto-'));
  process.env.CONTROL_PLANE_DATA_DIR = dataDir;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    res.setHeader('content-type', 'application/json');
    if (url.pathname === '/Users/user/Items') {
      res.end(JSON.stringify({ Items: [embyItem()], TotalRecordCount: 1 }));
      return;
    }
    if (url.pathname === '/Users/user/Items/emby-auto-1') {
      res.end(JSON.stringify(embyItem()));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'not found' }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  cleanState.applyCleanInit({ dataDir, confirmation: cleanState.APPLY_CONFIRMATION });
  const config = configStore.loadConfig();
  config.embyServers = {
    stub: { serverName: 'Stub', baseUrl: `http://127.0.0.1:${address.port}`, accessToken: 'stub-token', userId: 'user' },
  };
  configStore.saveConfig(config);

  let app = await buildApp({ logger: false, dataDir, apiKey: '' });
  try {
    const created = await app.inject({
      method: 'POST',
      url: '/v1/admin/sublibraries',
      payload: {
        name: 'Full Auto', source: 'emby', mediaType: 'movie', embyServerId: 'stub', sectionId: 'section',
        ruleTemplateId: 'default', libraryAutomationMode: 'auto', maintenanceAutomationMode: 'auto',
      },
    });
    assert.strictEqual(created.statusCode, 201, created.body);

    const onboardingDeadline = Date.now() + 5000;
    while (Date.now() < onboardingDeadline) {
      const library = await app.inject({ method: 'GET', url: '/v1/library' });
      if (library.json().items[0]?.helix.phase === 'maintenance') break;
      await wait(50);
    }
    await app.close();
    libraStore.resetForTests();
    nexoraStore.resetForTests();
    kairoxStore.resetForTests();
    kairoxAdmissionStore.resetForTests();
    taskStore.resetForTests();
    app = await buildApp({ logger: false, dataDir, apiKey: '' });

    let item = null;
    const deadline = Date.now() + 35000;
    while (Date.now() < deadline) {
      const library = await app.inject({ method: 'GET', url: '/v1/library' });
      item = library.json().items[0] || null;
      if (item && item.maintenanceComplete) break;
      await wait(250);
    }
    const automation = await app.inject({ method: 'GET', url: '/v1/admin/automation' });
    const diagnosticTasks = (await app.inject({ method: 'GET', url: '/v1/tasks?includeHistory=true' })).json().tasks || [];
    assert.ok(item, `Libra did not onboard the Emby observation: ${automation.body}`);
    assert.strictEqual(item.helix.phase, 'maintenance');
    assert.strictEqual(item.helix.source.readiness, 'ready');
    const maintenanceDiagnostic = JSON.stringify({
      helix: item.helix,
      maintenanceComplete: item.maintenanceComplete,
      lifecycleStage: item.lifecycleStage,
      lifecycleReason: item.lifecycleReason,
      workflows: diagnosticTasks.map((task) => ({ task, events: workflowStore.listEvents(task.id) })),
    });
    assert.strictEqual(item.helix.maintenance.basedataPassed, true, maintenanceDiagnostic);
    assert.strictEqual(item.helix.maintenance.metadataPassed, true, maintenanceDiagnostic);
    assert.strictEqual(item.helix.maintenance.optimizePassed, true, maintenanceDiagnostic);
    assert.strictEqual(item.maintenanceComplete, true, maintenanceDiagnostic);

    const tasks = (await app.inject({ method: 'GET', url: '/v1/tasks?includeHistory=true' })).json().tasks;
    const targets = tasks.map((task) => task.taskTarget && task.taskTarget.targetGate).sort();
    assert.deepStrictEqual(targets, ['basedata', 'metadata']);
    assert.ok(tasks.every((task) => task.status === 'done'));
    for (const task of tasks) {
      const taskEvents = taskStore.queryTaskEvents({ taskId: task.id }, { pageSize: 50 }).events;
      assert.ok(taskEvents.some((event) => event.eventType === 'task.created'), `task.created missing for ${task.id}`);
      const plan = workflowStore.getPlanForTask(task.id);
      assert.ok(plan && plan.schemaVersion === 'kairox-workflow-v1');
      assert.strictEqual(plan.taskId, task.id);
      assert.ok(plan.nodes.length > 0);
      assert.ok(workflowStore.listEvents(task.id).every((event) => ['succeeded', 'skipped'].includes(event.status)));
    }
  } finally {
    await app.close();
    await new Promise((resolve) => server.close(resolve));
    libraStore.resetForTests();
    nexoraStore.resetForTests();
    kairoxStore.resetForTests();
    kairoxAdmissionStore.resetForTests();
    taskStore.resetForTests();
    workflowStore.resetForTests();
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (_) { /* Windows may retain a SQLite handle until process exit. */ }
  }
});
