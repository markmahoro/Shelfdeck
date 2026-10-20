'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const sharp = require('sharp');
const { normalizeVector, cosineSimilarity, bestActorMatch } = require('../../src/helix/integrations/local-face-math');
const { createLocalFaceModel } = require('../../src/helix/integrations/local-face-model');

test('chooses one highest valid actor across frames and resolves exact ties deterministically', () => {
  const references = [{ libraryKind: 'us_adult', personId: 'actor-z', referenceRevision: 1, vector: [1, 0] },
    { libraryKind: 'us_adult', personId: 'actor-a', referenceRevision: 2, vector: [1, 0] },
    { libraryKind: 'us_adult', personId: 'actor-b', referenceRevision: 1, vector: [0, 1] }];
  const result = bestActorMatch([[0.4, 0.6], [1, 0]], references);
  assert.equal(result.personId, 'actor-a'); assert.equal(result.vectorIndex, 1); assert.equal(result.referenceRevision, 2);
  assert.equal(bestActorMatch([], references), null);
  assert.equal(bestActorMatch([[1, 0]], []), null);
  assert.equal(bestActorMatch([[-1, 0]], references), null);
  assert.throws(() => bestActorMatch([[1, 0]], [{ ...references[0], libraryKind: 'normal' }]), { code: 'FACE_REFERENCE_LIBRARY_INVALID' });
  assert.throws(() => normalizeVector([0, 0]), { code: 'FACE_VECTOR_INVALID' });
  assert.throws(() => cosineSimilarity([1, NaN], [1, 0]), { code: 'FACE_VECTOR_INVALID' });
  assert.throws(() => cosineSimilarity([1], [1, 0]), { code: 'FACE_VECTOR_INVALID' });
});

const modelRoot = process.env.SHELFDECK_FACE_MODEL_ROOT, sampleImage = process.env.SHELFDECK_FACE_TEST_IMAGE;
test('real pinned CPU models recognize a resized image and reject blank and multiple-face reference images', {
  skip: !modelRoot || !sampleImage ? 'Explicit pinned models and a non-production reference image are required.' : false,
}, async () => {
  const model = createLocalFaceModel({ modelRoot });
  try {
    const original = fs.readFileSync(sampleImage), first = await model.analyzeImage(original, { requireSingleFace: true });
    const native = require('../../src/helix/integrations/local-face-model-native').createNativeLocalFaceModel({ modelRoot });
    try {
      const baseline = await native.analyzeImage(original, { requireSingleFace: true });
      assert.deepEqual(first, baseline, 'Thread transport must preserve pinned preprocessing and every model output exactly.');
    } finally { await native.close(); }
    const second = await model.analyzeImage(await sharp(original).resize(400, 400).png().toBuffer(), { requireSingleFace: true });
    assert.equal(first.detectedFaceCount, 1); assert.equal(second.detectedFaceCount, 1);
    assert.equal(first.faces[0].vector.length, 128);
    assert.ok(cosineSimilarity(first.faces[0].vector, second.faces[0].vector) > 0.9);
    const blank = await sharp({ create: { width: 640, height: 640, channels: 3, background: '#808080' } }).png().toBuffer();
    assert.equal((await model.analyzeImage(blank)).detectedFaceCount, 0);
    await assert.rejects(model.analyzeImage(blank, { requireSingleFace: true }), { code: 'FACE_REFERENCE_SINGLE_FACE_REQUIRED' });
    const tile = await sharp(original).resize(400, 400).toBuffer();
    const pair = await sharp({ create: { width: 800, height: 400, channels: 3, background: '#000000' } })
      .composite([{ input: tile, left: 0, top: 0 }, { input: tile, left: 400, top: 0 }]).png().toBuffer();
    await assert.rejects(model.analyzeImage(pair, { requireSingleFace: true }), error =>
      error.code === 'FACE_REFERENCE_SINGLE_FACE_REQUIRED' && error.details.detectedFaceCount === 2);
  } finally { await model.close(); }
});
