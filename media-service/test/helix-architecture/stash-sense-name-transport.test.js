'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { getEventListeners } = require('node:events');
const { POLICY, createStashSenseNameTransport } = require('../../src/helix/integrations/stash-sense-name-transport');
const { canonicalDigest } = require('../../src/helix/contracts/canonical-json');
const imageBytes = Buffer.from([255, 216, 255, 217]);
const imageRef = { artifactHandleId: 'frame-artifact', artifactRevision: 1,
  sha256: createHash('sha256').update(imageBytes).digest('hex'), sizeBytes: imageBytes.length };
const box = { x: 10, y: 20, width: 90, height: 100, confidence: 0.95 };
const match = (name = 'Skin Diamond', distance = 0.302587) => ({ name, distance, confidence: 1 - distance });
const response = matches => ({ face_count: 1, faces: [{ box, matches }] });
const request = overrides => ({ imageBytes, imageRef, timeoutMs: 1000, ...overrides });
const client = fetchImpl => createStashSenseNameTransport({ endpoint: 'http://recognizer:5000', configRevision: 3, fetchImpl });

test('Stash name observation binds exact Artifact bytes and projects names without external identity or image authority', async () => {
  let calls = 0;
  const transport = client(async (url, init) => {
    calls++;
    assert.equal(url, 'http://recognizer:5000/identify');
    assert.equal(init.method, 'POST'); assert.equal(init.redirect, 'manual');
    const body = JSON.parse(init.body);
    assert.equal(body.image_base64, imageBytes.toString('base64'));
    assert.equal(body.image_url, undefined);
    assert.equal(body.top_k, 5); assert.equal(body.max_distance, 0.6); assert.equal(body.min_face_confidence, 0.5);
    return Response.json(response([{ ...match(), original_name: 'Ｓｋｉｎ Diamond', stashdb_id: 'external-not-a-person-id',
      image_url: 'https://untrusted.test/not-fetched.jpg', linked_universal_ids: ['foreign:id'] }]));
  });
  const result = await transport.identify(request());
  assert.equal(calls, 1); assert.equal(result.resultKind, 'matched');
  assert.equal(result.matches[0].name, 'Skin Diamond');
  assert.deepEqual(result.matches[0].aliases, ['Ｓｋｉｎ Diamond']);
  assert.deepEqual(result.sourceImageRef, imageRef);
  assert.equal(result.observationDigest, canonicalDigest(Object.fromEntries(Object.entries(result).filter(([key]) => key !== 'observationDigest'))));
  assert.equal(JSON.stringify(result).includes('external-not-a-person-id'), false);
  assert.equal(JSON.stringify(result).includes('untrusted.test'), false);
  assert.equal(Object.isFrozen(result.matches[0].faceBox), true);
});

test('no face, no match or below-threshold evidence remains unmatched, while a tie or several faces cannot choose an actor', async () => {
  for (const [raw, expected] of [
    [{ face_count: 0, faces: [] }, 'unmatched'], [response([]), 'unmatched'],
    [response([match('Too Far', 0.7)]), 'unmatched'],
    [{ face_count: 1, faces: [{ box: { ...box, confidence: 0.4 }, matches: [match()] }] }, 'unmatched'],
    [response([match('One', 0.3), match('Two', 0.3)]), 'ambiguous'],
    [{ face_count: 2, faces: [{ box, matches: [match()] }, { box, matches: [] }] }, 'ambiguous'],
  ]) assert.equal((await client(async () => Response.json(raw)).identify(request())).resultKind, expected);
});

test('invalid geometry, names, candidate bounds and face counts fail as protocol errors rather than no match', async () => {
  for (const raw of [response([{ ...match(), name: '' }]), response([{ ...match(), name: 'Name\nInjected' }]),
    response([{ ...match(), distance: NaN }]), response(Array.from({ length: 6 }, () => match())),
    { face_count: 2, faces: [{ box, matches: [] }] },
    { face_count: 1, faces: [{ box: { ...box, width: -1 }, matches: [] }] }])
    await assert.rejects(client(async () => Response.json(raw)).identify(request()), { code: 'STASH_SENSE_RESPONSE_INVALID' });
});

test('changed, missing or oversized input image facts are rejected before transport', async () => {
  let calls = 0; const transport = client(async () => { calls++; return Response.json(response([])); });
  for (const overrides of [{ imageRef: { ...imageRef, sha256: '0'.repeat(64) } }, { imageRef: { ...imageRef, url: 'http://other/image' } },
    { imageRef: { ...imageRef, artifactRevision: 0 } }, { imageBytes: Buffer.alloc(POLICY.maxImageBytes + 1) },
    { timeoutMs: 0 }]) await assert.rejects(transport.identify(request(overrides)));
  assert.equal(calls, 0);
});

test('HTTP errors, invalid JSON and oversized response preserve an explicit bounded transport failure without copying bodies', async () => {
  for (const fetchImpl of [async () => new Response('private-response-body', { status: 503 }),
    async () => new Response('invalid-json'),
    async () => new Response('oversized', { headers: { 'content-length': String(POLICY.maxResponseBytes + 1) } })]) {
    await assert.rejects(client(fetchImpl).identify(request()), error => {
      assert.equal(error.code, 'P5_PROVIDER_TRANSPORT_FAILED');
      assert.equal(JSON.stringify(error).includes('private-response-body'), false);
      assert.equal(String(error).includes('private-response-body'), false);
      return true;
    });
  }
});

test('caller capacity is bounded without a hidden queue and releases after both failure and success', async () => {
  let resolve, calls = 0;
  const transport = client(() => { calls++; return new Promise(value => { resolve = value; }); });
  const first = transport.identify(request());
  await assert.rejects(transport.identify(request()), { code: 'STASH_SENSE_CAPACITY_UNAVAILABLE' });
  assert.equal(calls, 1); resolve(new Response('down', { status: 503 }));
  await assert.rejects(first, { code: 'P5_PROVIDER_TRANSPORT_FAILED' });
  const second = transport.identify(request()); resolve(Response.json(response([match()])));
  assert.equal((await second).resultKind, 'matched'); assert.equal(calls, 2);
});

test('timeout and user cancellation release capacity and detach listeners without turning late results into success', async () => {
  const controller = new AbortController(); let calls = 0;
  const transport = client((url, init) => {
    calls++;
    return new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('private-abort-detail')), { once: true }));
  });
  const cancelled = transport.identify(request({ signal: controller.signal })); controller.abort();
  await assert.rejects(cancelled, { code: 'STASH_SENSE_CANCELLED' });
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  // Keep the test event loop live; the production deadline intentionally uses unref.
  const timer = setTimeout(() => {}, 500);
  try { await assert.rejects(transport.identify(request({ timeoutMs: 100 })), { code: 'STASH_SENSE_TIMEOUT' }); }
  finally { clearTimeout(timer); }
  await assert.rejects(transport.identify(request({ signal: controller.signal })), { code: 'STASH_SENSE_CANCELLED' });
  assert.equal(calls, 2);
});
