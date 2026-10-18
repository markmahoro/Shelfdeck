'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const sharp = require('sharp');
const manifest = require('../contracts/us-adult-face-model-pack.json');
const { normalizeVector, decodeYuNet, alignRgb } = require('./local-face-math');

function fail(code, message, details) {
  throw Object.assign(new Error(message), { code, details });
}

function verifyModelPack(modelRoot, licenseRoot = path.resolve(__dirname, '../../../resources/face-models')) {
  for (const license of manifest.licenses) {
    const file = path.join(licenseRoot, license.file), stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== license.sha256) {
      fail('FACE_MODEL_LICENSE_INVALID', 'The local face model license does not match the pinned distribution.');
    }
  }
  return Object.fromEntries(manifest.models.map(model => {
    const file = path.join(modelRoot, model.file);
    let stat;
    try { stat = fs.lstatSync(file); }
    catch (error) {
      if (error.code === 'ENOENT') fail('FACE_MODEL_PACK_MISSING', 'The pinned local face model pack is not installed.', { model: model.role });
      throw error;
    }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== model.size ||
        createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== model.sha256) {
      fail('FACE_MODEL_PACK_INVALID', 'The local face model does not match its pinned checksum.', { model: model.role });
    }
    return [model.role, file];
  }));
}

function createLocalFaceModel(options = {}) {
  const modelRoot = options.modelRoot || path.resolve(__dirname, '../../../resources/face-models');
  let loading = null;
  async function load() {
    if (!loading) loading = (async () => {
      const files = verifyModelPack(modelRoot);
      const ort = options.ort || require('onnxruntime-node');
      if (ort.env?.versions?.node !== manifest.runtimeVersion) fail('FACE_MODEL_RUNTIME_VERSION_INVALID', 'The local face runtime does not match the pinned model contract.');
      const sessionOptions = { executionProviders: ['cpu'], intraOpNumThreads: 2, interOpNumThreads: 1, logSeverityLevel: 3 };
      const detector = await ort.InferenceSession.create(files.detector, sessionOptions);
      let recognizer;
      try { recognizer = await ort.InferenceSession.create(files.recognizer, sessionOptions); }
      catch (error) { await detector.release(); throw error; }
      return { ort, detector, recognizer };
    })();
    return loading;
  }

  async function analyzeImage(bytes, { requireSingleFace = false } = {}) {
    if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > 16 * 1024 * 1024) {
      fail('FACE_IMAGE_INVALID', 'A bounded JPEG, PNG or WebP image is required.');
    }
    const image = sharp(bytes, { limitInputPixels: 16 * 1024 * 1024 });
    const metadata = await image.metadata().catch(() => fail('FACE_IMAGE_INVALID', 'The selected image cannot be decoded.'));
    if (!['jpeg', 'png', 'webp'].includes(metadata.format) || (metadata.pages || 1) !== 1) {
      fail('FACE_IMAGE_INVALID', 'A single JPEG, PNG or WebP image is required.');
    }
    const { data, info } = await image.rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#000000' }).toColourspace('srgb').removeAlpha().raw().toBuffer({ resolveWithObject: true })
      .catch(() => fail('FACE_IMAGE_INVALID', 'The selected image cannot be decoded.'));
    if (info.channels !== 3) fail('FACE_IMAGE_INVALID', 'The image cannot be decoded into RGB.');
    const { ort, detector, recognizer } = await load();
    const scale = Math.min(manifest.detectorSize / info.width, manifest.detectorSize / info.height);
    const resizedWidth = Math.max(1, Math.round(info.width * scale)), resizedHeight = Math.max(1, Math.round(info.height * scale));
    const scaled = await sharp(data, { raw: info }).resize(resizedWidth, resizedHeight, { fit: 'fill' })
      .extend({ top: 0, left: 0, right: manifest.detectorSize - resizedWidth, bottom: manifest.detectorSize - resizedHeight, background: '#000000' })
      .raw().toBuffer();
    const planeSize = manifest.detectorSize * manifest.detectorSize, input = new Float32Array(planeSize * 3);
    // YuNet consumes BGR at the original 0..255 scale. SFace consumes RGB at that same scale.
    for (let i = 0; i < planeSize; i++) for (let channel = 0; channel < 3; channel++) input[channel * planeSize + i] = scaled[i * 3 + 2 - channel];
    const output = await detector.run({ [detector.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, manifest.detectorSize, manifest.detectorSize]) });
    const faces = decodeYuNet(output, manifest.detectorSize, manifest.detectionThreshold)
      .filter(face => face.x + face.width / 2 < resizedWidth && face.y + face.height / 2 < resizedHeight)
      .map(face => ({ ...face, x: face.x * info.width / resizedWidth, y: face.y * info.height / resizedHeight,
        width: face.width * info.width / resizedWidth, height: face.height * info.height / resizedHeight,
        landmarks: face.landmarks.map(([x, y]) => [x * info.width / resizedWidth, y * info.height / resizedHeight]) }));
    if (requireSingleFace && faces.length !== 1) fail('FACE_REFERENCE_SINGLE_FACE_REQUIRED',
      'A reference image must contain exactly one identifiable face.', { detectedFaceCount: faces.length });
    const descriptors = [];
    for (const face of faces) {
      const aligned = alignRgb(data, info.width, info.height, face.landmarks);
      const result = await recognizer.run({ [recognizer.inputNames[0]]: new ort.Tensor('float32', aligned, [1, 3, 112, 112]) });
      const feature = result[recognizer.outputNames[0]];
      if (feature?.data?.length !== manifest.dimension) fail('FACE_MODEL_OUTPUT_INVALID', 'The recognizer returned an unexpected vector dimension.');
      descriptors.push(Object.freeze({ x: face.x, y: face.y, width: face.width, height: face.height,
        confidence: face.score, landmarks: face.landmarks, vector: Object.freeze(normalizeVector(feature.data)) }));
    }
    return Object.freeze({ modelRef: manifest.modelRef, width: info.width, height: info.height,
      detectedFaceCount: descriptors.length, faces: Object.freeze(descriptors) });
  }

  return Object.freeze({ modelRef: manifest.modelRef, manifest, load, analyzeImage,
    async close() {
      if (!loading) return;
      const loaded = await loading.then(value => value, () => null); loading = null;
      if (loaded) { await loaded.recognizer.release(); await loaded.detector.release(); }
    },
  });
}

module.exports = Object.freeze({ createLocalFaceModel, verifyModelPack });
