'use strict';

const path = require('node:path');
const { Worker } = require('node:worker_threads');
const manifest = require('../contracts/us-adult-face-model-pack.json');
const { verifyModelPack } = require('./local-face-model-pack');
const MAX_PENDING = 32;
const MAX_PENDING_BYTES = 32 * 1024 * 1024;

function failure(code, message, details) { return Object.assign(new Error(message), { code, ...(details === undefined ? {} : { details }) }); }
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

// ONNX's Node backend calls synchronous native inference inside setImmediate.
// Its Promise alone does not keep the Service HTTP/event loop responsive.
// This thread owns only image math and pinned model sessions, never Work or Domain facts.
function createLocalFaceModel(options = {}) {
  const modelRoot = options.modelRoot || path.resolve(__dirname, '../../../resources/face-models');
  const pending = new Map();
  let worker = null, sequence = 0, loading = null, closing = null, closed = false, fatal = null, pendingBytes = 0;

  function rejectPending(error) {
    fatal = fatal || error;
    for (const request of pending.values()) request.reject(fatal);
    pending.clear();
    pendingBytes = 0;
  }

  function ensureWorker() {
    if (fatal) throw fatal;
    if (!worker) {
      const createWorker = options.createWorker || ((file, settings) => new Worker(file, settings));
      try {
        worker = createWorker(path.join(__dirname, 'local-face-model-worker.js'), { workerData: { modelRoot } });
      } catch (error) {
        fatal = failure('FACE_MODEL_WORKER_FAILED', 'The local CPU model thread could not start.', { causeCode: error.code || 'WORKER_START_FAILED' });
        throw fatal;
      }
      worker.on('message', reply => {
        const request = pending.get(reply?.id);
        if (!Number.isSafeInteger(reply?.id) || !request || typeof reply.ok !== 'boolean' ||
            !reply.ok && (typeof reply.error?.code !== 'string' || typeof reply.error?.message !== 'string')) {
          rejectPending(failure('FACE_MODEL_WORKER_PROTOCOL_INVALID', 'The local CPU model returned an invalid response.'));
          void worker.terminate().catch(() => {}); return;
        }
        pending.delete(reply.id);
        pendingBytes -= request.imageBytes;
        if (reply.ok) request.resolve(freeze(reply.value));
        else request.reject(failure(reply.error?.code || 'FACE_MODEL_INFERENCE_FAILED',
          reply.error?.message || 'The local CPU model failed.', reply.error?.details));
      });
      worker.on('error', error => rejectPending(failure('FACE_MODEL_WORKER_FAILED',
        'The local CPU model thread failed.', { causeCode: error.code || 'WORKER_ERROR' })));
      worker.on('exit', code => {
        if (!closed || pending.size) rejectPending(failure('FACE_MODEL_WORKER_FAILED',
          'The local CPU model thread stopped before completing its requests.', { exitCode: code }));
      });
    }
    return worker;
  }

  function send(kind, value, transferList = []) {
    return new Promise((resolve, reject) => {
      let activeWorker;
      try { activeWorker = ensureWorker(); }
      catch (error) { reject(error); return; }
      const imageBytes = value?.bytes?.byteLength || 0;
      // Shutdown has its own control slot and remains admissible when the data queue is full.
      if (kind !== 'close' && (pending.size >= MAX_PENDING || pendingBytes + imageBytes > MAX_PENDING_BYTES)) {
        reject(failure('FACE_MODEL_BUSY', 'The bounded local CPU model queue is full.')); return;
      }
      const id = ++sequence;
      pending.set(id, { resolve, reject, imageBytes });
      pendingBytes += imageBytes;
      try { activeWorker.postMessage({ id, kind, ...value }, transferList); }
      catch (error) {
        rejectPending(failure('FACE_MODEL_WORKER_FAILED', 'The local CPU model request could not be sent.', { causeCode: error.code || 'WORKER_MESSAGE_FAILED' }));
        void activeWorker.terminate().catch(() => {});
      }
    });
  }

  function available() {
    if (closed || closing) throw failure('FACE_MODEL_CLOSED', 'The local CPU model has been closed.');
    if (fatal) throw fatal;
  }

  return Object.freeze({
    modelRef: manifest.modelRef,
    manifest,
    async load() {
      available();
      if (!loading) loading = send('load');
      await loading;
    },
    async analyzeImage(bytes, { requireSingleFace = false } = {}) {
      available();
      if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > 16 * 1024 * 1024) {
        throw failure('FACE_IMAGE_INVALID', 'A bounded JPEG, PNG or WebP image is required.');
      }
      if (pending.size >= MAX_PENDING || pendingBytes + bytes.length > MAX_PENDING_BYTES) {
        throw failure('FACE_MODEL_BUSY', 'The bounded local CPU model queue is full.');
      }
      // Transfer an owned copy; pooled caller Buffers and their live contents stay intact.
      const owned = Uint8Array.from(bytes);
      return send('analyze', { bytes: owned, requireSingleFace: Boolean(requireSingleFace) }, [owned.buffer]);
    },
    close() {
      if (closing) return closing;
      if (closed) return Promise.resolve();
      if (!worker) { closed = true; return Promise.resolve(); }
      closing = (async () => {
        try { if (!fatal) await send('close'); }
        finally { closed = true; await worker.terminate(); }
      })();
      return closing;
    },
  });
}

module.exports = Object.freeze({ createLocalFaceModel, verifyModelPack });
