'use strict';
const { parentPort, workerData } = require('node:worker_threads');
const pack = require('../../../src/helix/contracts/us-adult-face-model-pack.json');
let queue = Promise.resolve();
parentPort.on('message', request => {
  queue = queue.then(async () => {
    if (request.kind === 'load' || request.kind === 'close') {
      parentPort.postMessage({ id: request.id, ok: true, value: null }); return;
    }
    if (workerData.mode === 'crash') process.exit(23);
    if (workerData.mode === 'malformed') { parentPort.postMessage({ id: request.id + 1000, ok: true, value: null }); return; }
    if (request.bytes[0] === 238) {
      parentPort.postMessage({ id: request.id, ok: false, error: { code: 'FACE_REFERENCE_SINGLE_FACE_REQUIRED', message: 'Fixture multiple faces', details: { detectedFaceCount: 2 } } }); return;
    }
    const until = Date.now() + (workerData.busyMs || 0);
    while (Date.now() < until) { /* Deliberately synchronous CPU work in the isolated test thread. */ }
    parentPort.postMessage({ id: request.id, ok: true, value: { modelRef: pack.modelRef,
      width: request.bytes[0] || 1, height: Math.min(1600, request.bytes.length), detectedFaceCount: 0, faces: [] } });
  });
});
