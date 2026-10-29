'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createFfmpegProcessRegistry } = require('../src/clean-ffmpeg-process-registry');
function processFixture(exits = true) {
  const child = new EventEmitter(); child.exitCode = null; child.signalCode = null;
  child.kill = signal => { child.killedWith = signal; if(exits)queueMicrotask(() => {
    child.signalCode = signal; child.emit('close', null, signal);
  }); return true; }; return child;
}
test('safe stop interrupts encoding, waits for exit and permits a fresh run after resume', async () => {
  const registry = createFfmpegProcessRegistry(), child = processFixture();
  assert.equal(registry.register(child), true);
  await registry.quiesce();
  assert.equal(child.killedWith, 'SIGKILL');
  assert.equal(registry.wasInterrupted(child), true);
  assert.equal(registry.size(), 0);
  registry.resume();
  const next = processFixture(); assert.equal(registry.register(next), true);
  await registry.close();
  assert.throws(() => registry.resume(), { code: 'CLEAN_MEDIA_PROCESS_RESUME_REFUSED' });
});
test('no exit acknowledgement means safe stop fails rather than pretending to drain', async () => {
  const registry = createFfmpegProcessRegistry({ stopTimeoutMs: 20 }), child = processFixture(false);
  registry.register(child);
  await assert.rejects(registry.quiesce(), { code: 'CLEAN_MEDIA_PROCESS_STOP_TIMEOUT' });
  assert.equal(registry.size(), 1);
  assert.throws(() => registry.resume(), { code: 'CLEAN_MEDIA_PROCESS_RESUME_REFUSED' });
  child.signalCode = 'SIGKILL'; child.emit('close');
  await registry.quiesce(); registry.resume();
});
test('a process racing with stop is interrupted and cannot gain write permission', async () => {
  const registry = createFfmpegProcessRegistry();
  await registry.quiesce();
  const late = processFixture(); assert.equal(registry.register(late), false);
  await registry.quiesce();
  assert.equal(registry.wasInterrupted(late), true);
  assert.equal(registry.size(), 0);
});

test('safe stop waits for a real owned writer to close before permitting workspace cleanup', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'owned-process-stop-'));
  const file = path.join(root, 'partial');
  const child = spawn(process.execPath, ['-e',
    'const fs=require("fs");setInterval(()=>fs.appendFileSync(process.argv[1],"frame"),5);process.stdout.write("ready");', file],
  { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const registry = createFfmpegProcessRegistry(); registry.register(child);
  t.after(async () => { await registry.close(); fs.rmSync(root, { recursive: true, force: true }); });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error('Owned test process did not start.')), 5000);
    child.stdout.once('data', () => { clearTimeout(timeout); resolve(); });
    child.once('error', error => { clearTimeout(timeout); reject(error); });
  });
  let closed = false; child.once('close', () => { closed = true; });
  await registry.quiesce();
  assert.equal(closed, true); assert.equal(registry.size(), 0);
  fs.writeFileSync(file, 'after barrier');
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(fs.readFileSync(file, 'utf8'), 'after barrier');
});
