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
  timeout: 90000,
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
    assert.fail('People image operation did not complete: ' + JSON.stringify({errorCount:errors.length,errors:errors.slice(0,10)}));
  }
  const body = { idempotencyKey: 'create-us-actor', libraryKind: 'us_adult', canonicalName: 'Test Actor', aliases: ['Test Alias','test actor','test alias'],
    image: { kind: 'upload', bytesBase64: fs.readFileSync(process.env.SHELFDECK_FACE_TEST_IMAGE).toString('base64') } };
  const started = await request('POST', '/v1/admin/people', body); assert.equal(started.statusCode, 202, started.body);
  const completed = await until(started.json().operationRef); assert.equal(completed.state, 'completed', JSON.stringify({ completed, errors }));
  const people = await request('GET', '/v1/admin/people?libraryKind=us_adult'); assert.equal(people.statusCode, 200, people.body);
  assert.equal(people.json().items.length, 1); assert.equal(people.json().items[0].canonicalName, 'Test Actor');
  assert.equal((await request('GET', '/v1/admin/people?libraryKind=normal')).json().items.length, 0);
  assert.deepEqual((await request('GET', '/v1/admin/people?libraryKind=jav')).json().items.map(item=>item.personId), ['person-jav-unknown-actor']);
  const avatar = await request('GET', '/v1/admin/people/' + completed.personId + '/avatar'); assert.equal(avatar.statusCode, 200, avatar.body);
  assert.deepEqual(avatar.rawPayload, fs.readFileSync(process.env.SHELFDECK_FACE_TEST_IMAGE));
  assert.deepEqual((await request('POST', '/v1/admin/people', body)).json(), started.json());
  const changed = await request('POST', '/v1/admin/people', { ...body, canonicalName: 'Different Actor' }); assert.equal(changed.statusCode, 409, changed.body);
  assert.equal((await request('POST', '/v1/admin/people', { ...body, libraryKind: 'normal' })).statusCode, 409);
  const editUrl='/v1/admin/people/'+completed.personId,edit={expectedPersonRevision:1,idempotencyKey:'edit-us-actor',canonicalName:'Revised Actor',aliases:['Known Alias','known alias']};
  const edited=await request('PATCH',editUrl,edit);assert.equal(edited.statusCode,200,edited.body);
  assert.equal(edited.json().receipt.resultRef.personRevision,2);assert.equal(edited.json().replayed,false);
  const editedPerson=(await request('GET','/v1/admin/people?libraryKind=us_adult')).json().items[0];
  assert.equal(editedPerson.canonicalName,'Revised Actor');assert.deepEqual(editedPerson.aliases.sort(),['Known Alias','Revised Actor']);
  assert.equal(editedPerson.currentReferenceRevision,1);
  const staleEdit=await request('PATCH',editUrl,{...edit,idempotencyKey:'edit-stale'});assert.equal(staleEdit.statusCode,409,staleEdit.body);
  const conflictEdit=await request('PATCH',editUrl,{...edit,canonicalName:'Other Actor'});assert.equal(conflictEdit.statusCode,409,conflictEdit.body);
  const addImage={idempotencyKey:'add-reference',expectedPersonRevision:2,expectedReferenceRevision:1,
    image:{kind:'upload',bytesBase64:(await sharp(process.env.SHELFDECK_FACE_TEST_IMAGE).resize(420).jpeg().toBuffer()).toString('base64')}};
  const added=await request('POST',editUrl+'/reference-assets',addImage);assert.equal(added.statusCode,202,added.body);
  const addedResult=await until(added.json().operationRef);assert.equal(addedResult.state,'completed',JSON.stringify({addedResult,errors}));
  assert.equal((await request('GET','/v1/admin/people?libraryKind=us_adult')).json().items[0].currentReferenceRevision,2);
  assert.deepEqual((await request('POST',editUrl+'/reference-assets',addImage)).json(),added.json());
  const duplicateImage=await request('POST',editUrl+'/reference-assets',{...addImage,idempotencyKey:'duplicate-reference',expectedReferenceRevision:2,image:body.image});
  assert.equal(duplicateImage.statusCode,409,duplicateImage.body);assert.equal(duplicateImage.json().error.code,'PEOPLE_REFERENCE_IMAGE_EXISTS');
  const gallery=(await request('GET',editUrl)).json();assert.equal(gallery.referenceImages.length,2);
  const old=gallery.referenceImages[0].referenceAssetId,release={idempotencyKey:'release-reference',expectedPersonRevision:2,expectedReferenceRevision:2},
    removed=await request('DELETE',editUrl+'/reference-assets/'+old,release);
  assert.equal(removed.statusCode,202,removed.body);assert.equal((await until(removed.json().operationRef)).state,'completed');
  assert.deepEqual((await request('DELETE',editUrl+'/reference-assets/'+old,release)).json(),removed.json());
  const remaining=(await request('GET',editUrl)).json();assert.equal(remaining.currentReferenceRevision,3);assert.equal(remaining.referenceImages.length,1);
  assert.notEqual((await request('GET',editUrl+'/avatar?assetId='+old+'&revision=3')).statusCode,200);
  const last=remaining.referenceImages[0].referenceAssetId,
    forbidden=await request('DELETE',editUrl+'/reference-assets/'+last,{...release,idempotencyKey:'last-reference',expectedReferenceRevision:3});
  assert.equal(forbidden.statusCode,409,forbidden.body);assert.equal(forbidden.json().error.code,'PEOPLE_LAST_REFERENCE_REQUIRED');
  const replace={...addImage,idempotencyKey:'replace-reference',expectedReferenceRevision:3,replaceAssetId:last,
    image:{kind:'upload',bytesBase64:(await sharp(process.env.SHELFDECK_FACE_TEST_IMAGE).resize(400).jpeg().toBuffer()).toString('base64')}},
    replacement=await request('POST',editUrl+'/reference-assets',replace);
  assert.equal(replacement.statusCode,202,replacement.body);assert.equal((await until(replacement.json().operationRef)).state,'completed');
  const replaced=(await request('GET',editUrl)).json();assert.equal(replaced.currentReferenceRevision,4);assert.equal(replaced.referenceImages.length,1);
  assert.notEqual(replaced.referenceImages[0].referenceAssetId,last);
  assert.equal((await request('GET',editUrl+'/avatar?assetId='+replaced.referenceImages[0].referenceAssetId+'&revision=4')).statusCode,200);
  assert.notEqual((await request('GET',editUrl+'/avatar?assetId='+last+'&revision=4')).statusCode,200);
  await host.close(); host = null; host = await create();
  assert.deepEqual((await request('POST',editUrl+'/reference-assets',replace)).json(),replacement.json());
  assert.equal((await request('GET',editUrl)).json().currentReferenceRevision,4);
  const replayedEdit=await request('PATCH',editUrl,edit);assert.equal(replayedEdit.statusCode,200,replayedEdit.body);
  assert.equal(replayedEdit.json().replayed,true);assert.deepEqual(replayedEdit.json().receipt,edited.json().receipt);
  assert.deepEqual((await request('GET', '/v1/admin/people/operations/' + completed.operationRef)).json(), completed);
  assert.deepEqual((await request('POST', '/v1/admin/people', body)).json(), started.json());
  const blank = await sharp({ create: { width: 640, height: 640, channels: 3, background: '#808080' } }).png().toBuffer();
  const badReplacement=await request('POST',editUrl+'/reference-assets',{...replace,idempotencyKey:'invalid-replacement',expectedReferenceRevision:4,
    replaceAssetId:replaced.referenceImages[0].referenceAssetId,image:{kind:'upload',bytesBase64:blank.toString('base64')}});
  assert.equal(badReplacement.statusCode,202,badReplacement.body);assert.equal((await until(badReplacement.json().operationRef)).state,'failed');
  const preserved=(await request('GET',editUrl)).json();assert.equal(preserved.currentReferenceRevision,4);
  assert.deepEqual(preserved.referenceImages,replaced.referenceImages);
  const failed = await request('POST', '/v1/admin/people', { ...body, idempotencyKey: 'blank-actor', image: { kind: 'upload', bytesBase64: blank.toString('base64') } });
  assert.equal(failed.statusCode, 202, failed.body);
  const rejected = await until(failed.json().operationRef); assert.equal(rejected.state, 'failed', JSON.stringify({ rejected, errors }));
  assert.equal(rejected.personId, null); assert.equal(rejected.failureCode, 'FACE_REFERENCE_SINGLE_FACE_REQUIRED');
  assert.equal((await request('GET', '/v1/admin/people?libraryKind=us_adult')).json().items.length, 1);
  assert.deepEqual(errors, []);
});
