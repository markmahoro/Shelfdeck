'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('http');

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address()));
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

test('western local AI creates a reference face through the embedding worker', async () => {
  let seenRequest = null;
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk.toString(); });
    req.on('end', () => {
      seenRequest = JSON.parse(raw || '{}');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        faces: [{
          faceId: 'detected-1',
          imageIndex: 0,
          bbox: [0, 0, 10, 20],
          detectionScore: 0.98,
          embedding: [1, 0, 0],
          sampleImageBase64: 'sample-face',
        }],
      }));
    });
  });

  const address = await listen(server);
  const oldUrl = process.env.FACE_EMBEDDINGS_URL;
  process.env.FACE_EMBEDDINGS_URL = `http://${address.address}:${address.port}/v1/face/embeddings`;

  try {
    const service = require('../src/services/westernAdultLocalAiService');
    const face = await service.createReferenceFace({
      western: { faceTimeoutSec: 5 },
      referenceId: 'ref-1',
      imageBase64: Buffer.from('fake-image').toString('base64'),
    });

    assert.strictEqual(face.faceId, 'ref-1');
    assert.deepStrictEqual(face.embedding, [1, 0, 0]);
    assert.strictEqual(face.faceCount, 1);
    assert.strictEqual(face.sampleImageBase64, 'sample-face');
    assert.strictEqual(seenRequest.images.length, 1);
    assert.ok(seenRequest.images[0].data);
  } finally {
    if (oldUrl === undefined) delete process.env.FACE_EMBEDDINGS_URL;
    else process.env.FACE_EMBEDDINGS_URL = oldUrl;
    await close(server);
  }
});
