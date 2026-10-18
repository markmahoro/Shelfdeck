'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const sharp = require('sharp');
const { initializeCleanData } = require('../../scripts/helix-operational-safety');
const { createCleanServiceHost } = require('../../src/clean-service-host');

test('formal Host publishes a US actor only after real CPU preparation and preserves registration replay across restart', {
  timeout: 45000,
  skip: !process.env.SHELFDECK_FACE_MODEL_ROOT || !process.env.SHELFDECK_FACE_TEST_IMAGE ? 'Explicit pinned models and non-production reference image are required.' : false,
}, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'us-people-host-')), dataDir = path.join(root, 'data'), adminDistDir = path.join(root, 'admin');
  fs.mkdirSync(adminDistDir); fs.writeFileSync(path.join(adminDistDir, 'index.html'), '<div id="root"></div>');
  const secretRoot = 'isolated-us-people-host-test-secret-root-0123456789', errors = [];
  const initialized = initializeCleanData({ dataDir, secretRoot, confirmation: 'INITIALIZE_HELIX_CLEAN_V1' });
  let host;
  const create = () => createCleanServiceHost({ dataDir, adminDistDir, secretRoot, faceModelRoot: process.env.SHELFDECK_FACE_MODEL_ROOT,
    now: () => Date.parse('2026-10-25T12:00:00+08:00'), onExecutionRuntimeError: error => errors.push({ code: error.code, message: error.message }) });
  t.after(async () => { await host?.close(); assert.equal(path.dirname(root), path.resolve(os.tmpdir())); fs.rmSync(root, { recursive: true, force: true }); });
  host = await create();
  const request = (method, url, payload) => host.inject({ method, url, payload, headers: { 'x-api-key': initialized.adminApiKey } });
  async function until(operationRef) {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const response = await request('GET', '/v1/admin/people/operations/' + operationRef); assert.equal(response.statusCode, 200, response.body);
      const result = response.json(); if (result.state !== 'preparing') return result;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.fail('People image operation did not complete: ' + JSON.stringify(errors));
  }
  const body = { idempotencyKey: 'create-us-actor', libraryKind: 'us_adult', canonicalName: 'Test Actor', aliases: ['Test Alias'],
    image: { kind: 'upload', bytesBase64: fs.readFileSync(process.env.SHELFDECK_FACE_TEST_IMAGE).toString('base64') } };
  const started = await request('POST', '/v1/admin/people', body); assert.equal(started.statusCode, 202, started.body);
  const completed = await until(started.json().operationRef); assert.equal(completed.state, 'completed', JSON.stringify({ completed, errors }));
  const people = await request('GET', '/v1/admin/people?libraryKind=us_adult'); assert.equal(people.statusCode, 200, people.body);
  assert.equal(people.json().items.length, 1); assert.equal(people.json().items[0].canonicalName, 'Test Actor');
  assert.equal((await request('GET', '/v1/admin/people?libraryKind=normal')).json().items.length, 0);
  assert.equal((await request('GET', '/v1/admin/people?libraryKind=jav')).json().items.length, 0);
  const avatar = await request('GET', '/v1/admin/people/' + completed.personId + '/avatar'); assert.equal(avatar.statusCode, 200, avatar.body);
  assert.deepEqual(avatar.rawPayload, fs.readFileSync(process.env.SHELFDECK_FACE_TEST_IMAGE));
  assert.deepEqual((await request('POST', '/v1/admin/people', body)).json(), started.json());
  const changed = await request('POST', '/v1/admin/people', { ...body, canonicalName: 'Different Actor' }); assert.equal(changed.statusCode, 409, changed.body);
  assert.equal((await request('POST', '/v1/admin/people', { ...body, libraryKind: 'normal' })).statusCode, 409);
  await host.close(); host = null; host = await create();
  assert.deepEqual((await request('GET', '/v1/admin/people/operations/' + completed.operationRef)).json(), completed);
  assert.deepEqual((await request('POST', '/v1/admin/people', body)).json(), started.json());
  const blank = await sharp({ create: { width: 640, height: 640, channels: 3, background: '#808080' } }).png().toBuffer();
  const failed = await request('POST', '/v1/admin/people', { ...body, idempotencyKey: 'blank-actor', image: { kind: 'upload', bytesBase64: blank.toString('base64') } });
  assert.equal(failed.statusCode, 202, failed.body);
  const rejected = await until(failed.json().operationRef); assert.equal(rejected.state, 'failed', JSON.stringify({ rejected, errors }));
  assert.equal(rejected.personId, null); assert.equal(rejected.failureCode, 'FACE_REFERENCE_SINGLE_FACE_REQUIRED');
  assert.equal((await request('GET', '/v1/admin/people?libraryKind=us_adult')).json().items.length, 1);
  assert.deepEqual(errors, []);
});
