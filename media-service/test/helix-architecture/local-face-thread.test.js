'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), path = require('node:path');
const { Worker } = require('node:worker_threads');
const { createLocalFaceModel } = require('../../src/helix/integrations/local-face-model');

function fixture(t, workerData = {}) {
  let starts = 0;
  const replies = [], model = createLocalFaceModel({ createWorker(_file, settings) {
    starts++;
    const worker = new Worker(path.join(__dirname, 'fixtures/local-face-thread-worker.js'), { ...settings, workerData });
    worker.on('message', value => replies.push(value.id)); return worker;
  } });
  t.after(() => model.close());
  return { model, starts: () => starts, replies };
}

test('synchronous model work leaves main-thread timers responsive and preserves caller-owned buffers', async t => {
  const h = fixture(t, { busyMs: 250 });
  await h.model.load();
  const bytes = Buffer.from([17, 2, 3]); let ticks = 0;
  const timer = setInterval(() => ticks++, 10);
  try {
    const result = await h.model.analyzeImage(bytes);
    assert.ok(ticks >= 5, 'A blocking Promise wrapper on the main thread cannot pass this check.');
    assert.deepEqual([...bytes], [17, 2, 3]); assert.equal(bytes.length, 3);
    assert.equal(result.width, 17); assert.equal(result.height, 3);
    assert.equal(Object.isFrozen(result), true); assert.equal(Object.isFrozen(result.faces), true);
    await h.model.load(); assert.equal(h.starts(), 1);
  } finally { clearInterval(timer); }
});

test('a full data queue still closes in FIFO order and rejects new work once closing starts', async t => {
  const h = fixture(t, { busyMs: 10 }); await h.model.load();
  const requests = Array.from({ length: 32 }, (_, index) => h.model.analyzeImage(Buffer.from([index + 1])));
  await assert.rejects(h.model.analyzeImage(Buffer.from([99])), { code: 'FACE_MODEL_BUSY' });
  const closing = h.model.close(); assert.equal(h.model.close(), closing);
  await assert.rejects(h.model.analyzeImage(Buffer.from([99])), { code: 'FACE_MODEL_CLOSED' });
  const values = await Promise.all(requests); await closing;
  assert.deepEqual(values.map(v => v.width), Array.from({ length: 32 }, (_, index) => index + 1));
  assert.deepEqual(h.replies, Array.from({ length: 34 }, (_, index) => index + 1));
  await assert.rejects(h.model.load(), { code: 'FACE_MODEL_CLOSED' }); assert.equal(h.starts(), 1);
});

test('queued image bytes are bounded independently from the number of requests', async t => {
  const h = fixture(t, { busyMs: 50 }); await h.model.load();
  const bytes = Buffer.alloc(16 * 1024 * 1024, 1), a = h.model.analyzeImage(bytes), b = h.model.analyzeImage(bytes);
  await assert.rejects(h.model.analyzeImage(Buffer.from([1])), { code: 'FACE_MODEL_BUSY' });
  await Promise.all([a, b]); assert.equal(bytes.length, 16 * 1024 * 1024);
  assert.equal((await h.model.analyzeImage(Buffer.from([7]))).width, 7);
});

test('model validation errors retain structured details and do not poison the next request', async t => {
  const h = fixture(t); await h.model.load();
  await assert.rejects(h.model.analyzeImage(Buffer.from([238])), error => error.code === 'FACE_REFERENCE_SINGLE_FACE_REQUIRED' && error.details.detectedFaceCount === 2);
  assert.equal((await h.model.analyzeImage(Buffer.from([9]))).width, 9); assert.equal(h.starts(), 1);
  await assert.rejects(h.model.analyzeImage(Buffer.alloc(0)), { code: 'FACE_IMAGE_INVALID' });
});

for (const mode of ['crash', 'malformed']) test(mode + ' rejects every pending request and never silently recreates a thread', async t => {
  const h = fixture(t, { mode }); await h.model.load();
  const results = await Promise.allSettled([h.model.analyzeImage(Buffer.from([1])), h.model.analyzeImage(Buffer.from([2]))]);
  const code = mode === 'crash' ? 'FACE_MODEL_WORKER_FAILED' : 'FACE_MODEL_WORKER_PROTOCOL_INVALID';
  assert.ok(results.every(result => result.status === 'rejected' && result.reason.code === code));
  await assert.rejects(h.model.analyzeImage(Buffer.from([3])), { code }); assert.equal(h.starts(), 1);
});

test('thread startup failures remain explicit without an in-process inference fallback', async () => {
  let starts = 0;
  const model = createLocalFaceModel({ createWorker() { starts++; throw new Error('Fixture worker startup failure'); } });
  await assert.rejects(model.load(), { code: 'FACE_MODEL_WORKER_FAILED' });
  await assert.rejects(model.analyzeImage(Buffer.from([1])), { code: 'FACE_MODEL_WORKER_FAILED' });
  await model.close(); assert.equal(starts, 1);
});

test('an authority revoked during threaded inference cannot publish an analysis result', async t => {
  const h = fixture(t, { busyMs: 250 }); await h.model.load(); let active = true;
  const { createUsAdultAnalysisEngine } = require('../../src/helix/integrations/us-adult-analysis-engine');
  const engine = createUsAdultAnalysisEngine({ faceModel: h.model, frameExtractor: { extract() {} },
    referencePort: { readReferenceEmbedding() {}, readReferenceImage() {} },
    context: { assertExecutionActive() { if (!active) throw Object.assign(new Error('Fixture execution stopped'), { code: 'FIXTURE_EXECUTION_STOPPED' }); } } });
  const pending = engine.computeEmbeddings({ faceModelRef: require('../../src/helix/contracts/us-adult-face-model').faceModelReference('western_frame_set'),
    frameComposite: { members: [{ timestampMs: 1 }], memberPayloads: [{ bytesBase64: Buffer.from([1]).toString('base64') }] } });
  setTimeout(() => { active = false; }, 30);
  await assert.rejects(pending, { code: 'FIXTURE_EXECUTION_STOPPED' });
});
