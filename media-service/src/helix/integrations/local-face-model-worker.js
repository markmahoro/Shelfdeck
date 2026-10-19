'use strict';

const { parentPort, workerData } = require('node:worker_threads');
const { createNativeLocalFaceModel } = require('./local-face-model-native');

const model = createNativeLocalFaceModel({ modelRoot: workerData.modelRoot });
let queue = Promise.resolve();
parentPort.on('message', request => {
  queue = queue.then(async () => {
    try {
      let value = null;
      if (request.kind === 'load') await model.load();
      else if (request.kind === 'analyze') value = await model.analyzeImage(Buffer.from(request.bytes.buffer, request.bytes.byteOffset, request.bytes.byteLength), { requireSingleFace: request.requireSingleFace });
      else if (request.kind === 'close') await model.close();
      else throw Object.assign(new Error('The local CPU model request is invalid.'), { code: 'FACE_MODEL_WORKER_PROTOCOL_INVALID' });
      parentPort.postMessage({ id: request.id, ok: true, value });
    } catch (error) {
      parentPort.postMessage({ id: request.id, ok: false, error: {
        code: error.code || 'FACE_MODEL_INFERENCE_FAILED', message: String(error.message || 'The local CPU model failed.').slice(0, 4096),
        ...(error.details === undefined ? {} : { details: error.details }),
      } });
    }
  });
  // A transport failure must terminate the thread, not poison a queue with pending promises forever.
  queue.catch(error => setImmediate(() => { throw error; }));
});
